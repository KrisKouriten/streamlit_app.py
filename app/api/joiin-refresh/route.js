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

// Joiin calls are independent, so we fetch them through a bounded concurrency
// pool rather than one-at-a-time. This is the single biggest speed lever: the
// wall-clock drops by roughly the pool size. DB writes stay sequential (ordered,
// modest volume); it's the network round-trips that dominate.
const CONCURRENCY = 6;
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Routine refresh = just the current month (fast). Full-year backfill is opt-in
// (the `full` flag / the monthly cron) since re-pulling every month each time is
// what made a refresh slow.
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

async function refresh(months) {
  // Per-entity standalone P&L → joiin_pl_entity. Per month, all companies are
  // fetched in parallel; then the month is written in one pass. A company that
  // errors is recorded and skipped, and the month is only cleared when at least
  // one company returned, so one bad call never wipes good data.
  const entityMap = await getEntityMap();
  const names = Object.keys(entityMap);
  let entityRows = 0;
  const errors = [];
  for (const ym of months) {
    const fetched = await mapPool(names, CONCURRENCY, async (name) => {
      try { return { name, json: await profitAndLoss({ companies: [name], startDate: ym, endDate: ym, currency: "GBP" }) }; }
      catch (e) { return { name, error: e.message }; }
    });
    const upserts = [];
    let ok = 0;
    for (const r of fetched) {
      if (r.error) { if (errors.length < 12) errors.push(`P&L ${r.name} ${ym}: ${r.error}`); continue; }
      ok++;
      for (const row of mapReportRows(r.json)) {
        if (!row.value) continue;
        upserts.push([entityMap[r.name], r.name, row.section, row.account, ym, row.value]);
      }
    }
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
  }
  return { months, entityRows, entityErrors: errors };
}

// The four Joiin board packs (Store / Head Office / Franchise / Consolidated) →
// finance.joiin_boardpack. All scope×month reports are fetched in parallel, then
// written. Best-effort: a pack that fails is reported without failing the run.
async function refreshBoardPacks(months, actor) {
  const companies = Object.keys(await getEntityMap());
  const jobs = [];
  for (const [scope, customReportId] of Object.entries(BOARDPACK_REPORTS)) {
    for (const ym of months) jobs.push({ scope, customReportId, ym });
  }
  const fetched = await mapPool(jobs, CONCURRENCY, async (j) => {
    try { return { ...j, parsed: mapBoardPackRows(await customReport({ customReportId: j.customReportId, companies, startDate: j.ym, endDate: j.ym, currency: "GBP" }), j.ym) }; }
    catch (e) { return { ...j, error: e.message }; }
  });
  const errors = [];
  let packs = 0;
  for (const f of fetched) {
    if (f.error) { errors.push(`${f.scope} ${f.ym}: ${f.error}`); continue; }
    if (f.parsed.rows.length) { await upsertBoardPack(f.scope, f.parsed, actor || "joiin-api"); packs++; }
    else errors.push(`${f.scope} ${f.ym}: empty board pack`);
  }
  return { packs, errors };
}

// Consolidated (eliminated) balance sheet, as at each month end →
// finance.joiin_bs. Months fetched in parallel, then written. A month is only
// cleared when Joiin returns rows; degrades cleanly if migration 036 is absent.
async function refreshBalanceSheet(months, actor) {
  const companies = Object.keys(await getEntityMap());
  const fetched = await mapPool(months, CONCURRENCY, async (ym) => {
    try { return { ym, rows: mapReportRows(await balanceSheet({ companies, startDate: ym, endDate: ym, currency: "GBP", elimination: "eliminate" })).filter((r) => r.value) }; }
    catch (e) { return { ym, error: e.message }; }
  });
  const errors = [];
  let bsRows = 0;
  for (const f of fetched) {
    if (f.error) { if (errors.length < 12) errors.push(`BS ${f.ym}: ${f.error}`); continue; }
    if (!f.rows.length) { errors.push(`BS ${f.ym}: empty balance sheet`); continue; }
    try {
      await query(`DELETE FROM finance.joiin_bs WHERE ym = $1`, [f.ym]);
      for (const r of f.rows) {
        await query(
          `INSERT INTO finance.joiin_bs (section, account, ym, value, updated_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (section, account, ym) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
          [r.section, r.account, f.ym, r.value, actor || "joiin-api"]
        );
        bsRows++;
      }
    } catch (e) {
      if (errors.length < 12) errors.push(`BS ${f.ym}: ${e.message}`);
    }
  }
  return { bsRows, bsErrors: errors };
}

async function runRefresh(months, actor) {
  const r = await refresh(months);
  const bp = await refreshBoardPacks(months, actor);
  const bs = await refreshBalanceSheet(months, actor);
  await audit({ actor, eventType: "joiin_api.refresh", objectType: "joiin_pl_entity", objectRef: months.join(","), detail: { ...r, boardPacks: bp, balanceSheet: bs } });
  return { r, bp, bs };
}

async function handle(request, actor) {
  if (!joiinConfigured()) {
    return NextResponse.json({ error: "JOIIN_API_KEY is not set — add it as an environment secret to enable the direct Joiin connection." }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  // Explicit months win; otherwise `full` pulls the year to date, and the
  // default is just the current month for a fast routine refresh.
  const months = Array.isArray(body.months) && body.months.length ? body.months : body.full ? fullYearMonths() : currentMonth();
  try {
    const { r, bp, bs } = await runRefresh(months, actor);
    // Nothing landed and both phases errored → report it as a failure so the UI
    // shows Joiin's actual message rather than a silent "0 rows".
    if (r.entityRows === 0 && bp.packs === 0) {
      const eErr = (r.entityErrors || [])[0];
      const bErr = (bp.errors || [])[0];
      const why = [eErr && `P&L → ${eErr}`, bErr && `board pack → ${bErr}`].filter(Boolean).join(" · ") || "no data returned";
      return NextResponse.json({ error: `Joiin refresh returned nothing — ${why}`, ...r, boardPacks: bp, balanceSheet: bs }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ...r, boardPacks: bp, balanceSheet: bs });
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

// Vercel Cron issues GET with the Authorization bearer. The monthly cron does a
// full year-to-date backfill (off-peak, once a month) to keep every month fresh.
export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!joiinConfigured()) return NextResponse.json({ error: "JOIIN_API_KEY not set" }, { status: 400 });
  try {
    const { r, bp, bs } = await runRefresh(fullYearMonths(), "joiin-cron");
    return NextResponse.json({ ok: true, ...r, boardPacks: bp, balanceSheet: bs });
  } catch (e) {
    return NextResponse.json({ error: `Joiin refresh failed: ${e.message}` }, { status: 502 });
  }
}
