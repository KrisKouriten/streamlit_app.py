import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { joiinConfigured, profitAndLoss, customReport, balanceSheet } from "../../../lib/joiin-api";
import { mapReportRows, mapBoardPackRows } from "../../../lib/joiin-api-map";
import { getEntityMap } from "../../../lib/joiin-entity-map";
import { BOARDPACK_REPORTS } from "../../../lib/joiin-reports";
import { upsertBoardPack } from "../../../lib/joiin-boardpack";
import { query } from "../../../lib/db";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Joiin refresh. The manual UI drives this in small CHUNKS (one phase — and for
 * board packs one scope — per HTTP request) so no single serverless invocation
 * runs long enough to hit the function time limit. The client asks for a
 * `plan`, then POSTs each chunk in turn. The monthly cron still runs a full
 * pass in one invocation (off-peak; give it headroom via the Vercel function
 * max duration).
 */

const CONCURRENCY = 6;
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function currentMonth() {
  const now = new Date();
  return [`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`];
}
function fullYearMonths() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const months = [];
  for (let m = 1; m <= now.getUTCMonth() + 1; m++) months.push(`${year}-${String(m).padStart(2, "0")}`);
  return months;
}

// The ordered list of chunks for a set of months: per month, the per-entity P&L,
// then one board pack per scope, then the balance sheet. Each is a small unit
// the client runs as its own request.
function buildChunks(months) {
  const scopes = Object.keys(BOARDPACK_REPORTS);
  const chunks = [];
  for (const m of months) {
    chunks.push({ phase: "pnl", month: m });
    for (const s of scopes) chunks.push({ phase: "boardpack", month: m, scope: s });
    chunks.push({ phase: "bs", month: m });
  }
  return chunks;
}

// --- per-chunk workers -------------------------------------------------------

// Per-entity standalone P&L for one month → joiin_pl_entity (26 light calls).
async function refreshPnlMonth(ym) {
  const entityMap = await getEntityMap();
  const names = Object.keys(entityMap);
  const fetched = await mapPool(names, CONCURRENCY, async (name) => {
    try { return { name, json: await profitAndLoss({ companies: [name], startDate: ym, endDate: ym, currency: "GBP" }) }; }
    catch (e) { return { name, error: e.message }; }
  });
  const upserts = [];
  const errors = [];
  let ok = 0;
  for (const r of fetched) {
    if (r.error) { if (errors.length < 12) errors.push(`P&L ${r.name} ${ym}: ${r.error}`); continue; }
    ok++;
    for (const row of mapReportRows(r.json)) {
      if (!row.value) continue;
      upserts.push([entityMap[r.name], r.name, row.section, row.account, ym, row.value]);
    }
  }
  let entityRows = 0;
  if (ok > 0) {
    await query(`DELETE FROM finance.joiin_pl_entity WHERE ym = $1`, [ym]);
    for (const u of upserts) {
      await query(
        `INSERT INTO finance.joiin_pl_entity (entity_id, entity_name, section, account, ym, value, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,'joiin-api')
         ON CONFLICT (entity_id, section, account, ym) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
        u
      );
      entityRows++;
    }
  }
  return { entityRows, errors };
}

// One board pack (a single scope) for one month → joiin_boardpack (1 heavy call).
async function refreshBoardPackOne(scope, ym, actor) {
  const customReportId = BOARDPACK_REPORTS[scope];
  if (!customReportId) return { packs: 0, errors: [`unknown scope ${scope}`] };
  const companies = Object.keys(await getEntityMap());
  try {
    const parsed = mapBoardPackRows(await customReport({ customReportId, companies, startDate: ym, endDate: ym, currency: "GBP" }), ym);
    if (parsed.rows.length) { await upsertBoardPack(scope, parsed, actor || "joiin-api"); return { packs: 1, errors: [] }; }
    return { packs: 0, errors: [`${scope} ${ym}: empty board pack`] };
  } catch (e) {
    return { packs: 0, errors: [`${scope} ${ym}: ${e.message}`] };
  }
}

// Consolidated balance sheet for one month → joiin_bs (1 heavy call).
async function refreshBsMonth(ym, actor) {
  const companies = Object.keys(await getEntityMap());
  let rows;
  try { rows = mapReportRows(await balanceSheet({ companies, startDate: ym, endDate: ym, currency: "GBP", elimination: "eliminate" })).filter((r) => r.value); }
  catch (e) { return { bsRows: 0, errors: [`BS ${ym}: ${e.message}`] }; }
  if (!rows.length) return { bsRows: 0, errors: [`BS ${ym}: empty balance sheet`] };
  let bsRows = 0;
  try {
    await query(`DELETE FROM finance.joiin_bs WHERE ym = $1`, [ym]);
    for (const r of rows) {
      await query(
        `INSERT INTO finance.joiin_bs (section, account, ym, value, updated_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (section, account, ym) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
        [r.section, r.account, ym, r.value, actor || "joiin-api"]
      );
      bsRows++;
    }
  } catch (e) { return { bsRows, errors: [`BS ${ym}: ${e.message}`] }; }
  return { bsRows, errors: [] };
}

// Run one chunk and return its small result.
async function runChunk(chunk, actor) {
  if (chunk.phase === "pnl") return { phase: "pnl", month: chunk.month, ...(await refreshPnlMonth(chunk.month)) };
  if (chunk.phase === "boardpack") return { phase: "boardpack", month: chunk.month, scope: chunk.scope, ...(await refreshBoardPackOne(chunk.scope, chunk.month, actor)) };
  if (chunk.phase === "bs") return { phase: "bs", month: chunk.month, ...(await refreshBsMonth(chunk.month, actor)) };
  return { error: `unknown phase ${chunk.phase}` };
}

// Whole-pass run in one invocation (cron). Chunks run sequentially.
async function runAll(months, actor) {
  let entityRows = 0, packs = 0, bsRows = 0;
  const errors = [];
  for (const c of buildChunks(months)) {
    const r = await runChunk(c, actor);
    entityRows += r.entityRows || 0; packs += r.packs || 0; bsRows += r.bsRows || 0;
    if (r.errors?.length) errors.push(...r.errors);
  }
  await audit({ actor, eventType: "joiin_api.refresh", objectType: "joiin_pl_entity", objectRef: months.join(","), detail: { entityRows, packs, bsRows, errorCount: errors.length } });
  return { months, entityRows, boardPacks: { packs, errors: [] }, balanceSheet: { bsRows }, entityErrors: errors };
}

async function handle(request, actor) {
  if (!joiinConfigured()) {
    return NextResponse.json({ error: "JOIIN_API_KEY is not set — add it as an environment secret to enable the direct Joiin connection." }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));

  // 1. Plan request — return the chunk list for the client to execute. Instant.
  if (body.plan) {
    const months = Array.isArray(body.months) && body.months.length ? body.months : body.full ? fullYearMonths() : currentMonth();
    return NextResponse.json({ months, chunks: buildChunks(months) });
  }

  // 2. Single chunk — the client drives these one at a time.
  if (body.phase) {
    try {
      const r = await runChunk(body, actor);
      await audit({ actor, eventType: "joiin_api.refresh_chunk", objectType: "joiin_pl_entity", objectRef: `${body.phase}·${body.month}${body.scope ? `·${body.scope}` : ""}`, detail: r });
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      return NextResponse.json({ error: `Joiin ${body.phase} ${body.month || ""} failed: ${e.message}` }, { status: 502 });
    }
  }

  // 3. Legacy whole-pass (no phase / no plan). Kept for compatibility; heavy.
  try {
    const months = Array.isArray(body.months) && body.months.length ? body.months : body.full ? fullYearMonths() : currentMonth();
    return NextResponse.json({ ok: true, ...(await runAll(months, actor)) });
  } catch (e) {
    return NextResponse.json({ error: `Joiin refresh failed: ${e.message}` }, { status: 502 });
  }
}

// Manual refresh (ADMIN/FINANCE) or Vercel Cron (Authorization: Bearer CRON_SECRET).
export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  const cronOk = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Refreshing from Joiin requires ADMIN or FINANCE" }, { status: 403 });
    return handle(request, session.email || session.name);
  }
  return handle(request, "joiin-cron");
}

// Vercel Cron issues GET with the Authorization bearer. Full year-to-date pass
// in one invocation — give the function adequate max duration in Vercel.
export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!joiinConfigured()) return NextResponse.json({ error: "JOIIN_API_KEY not set" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await runAll(fullYearMonths(), "joiin-cron")) });
  } catch (e) {
    return NextResponse.json({ error: `Joiin refresh failed: ${e.message}` }, { status: 502 });
  }
}
