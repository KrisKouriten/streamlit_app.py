import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { joiinConfigured, profitAndLoss, customReport } from "../../../lib/joiin-api";
import { mapReportRows, mapBoardPackRows } from "../../../lib/joiin-api-map";
import { getEntityMap } from "../../../lib/joiin-entity-map";
import { BOARDPACK_REPORTS } from "../../../lib/joiin-reports";
import { upsertBoardPack } from "../../../lib/joiin-boardpack";
import { query } from "../../../lib/db";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Default target months: the current calendar year to date (Jan → current
// month, YYYY-MM). This keeps the whole year loaded so the Management Accounts
// YTD view is complete; the monthly cron re-pulls it so every month stays fresh.
function defaultMonths() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const months = [];
  for (let m = 1; m <= now.getUTCMonth() + 1; m++) months.push(`${year}-${String(m).padStart(2, "0")}`);
  return months;
}

async function refresh(months) {
  // Per-entity standalone P&L: one call per company per month → joiin_pl_entity.
  // Resilient: a company that errors is recorded and skipped, so one bad call
  // doesn't lose the whole refresh (or the board packs that run after it).
  const entityMap = await getEntityMap();
  const names = Object.keys(entityMap);
  let entityRows = 0;
  const errors = [];
  for (const ym of months) {
    const upserts = [];
    let ok = 0;
    for (const name of names) {
      let json;
      try { json = await profitAndLoss({ companies: [name], startDate: ym, endDate: ym, currency: "GBP" }); }
      catch (e) { if (errors.length < 12) errors.push(`P&L ${name} ${ym}: ${e.message}`); continue; }
      ok++;
      for (const r of mapReportRows(json)) {
        if (!r.value) continue;
        upserts.push([entityMap[name], name, r.section, r.account, ym, r.value]);
      }
    }
    // Only clear the month if at least one company returned — never wipe good
    // data because every call failed (bad key, endpoint down).
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

// Pull the four Joiin board packs (Store / Head Office / Franchise /
// Consolidated) by customReportId → finance.joiin_boardpack. Joiin lays out and
// consolidates each pack (wholesale intercompany eliminated), so we store its
// output verbatim. Additive to the per-entity refresh and best-effort: a board
// pack that fails is reported in `errors` without failing the whole refresh.
async function refreshBoardPacks(months, actor) {
  const companies = Object.keys(await getEntityMap());
  const errors = [];
  let packs = 0;
  for (const [scope, customReportId] of Object.entries(BOARDPACK_REPORTS)) {
    for (const ym of months) {
      try {
        const json = await customReport({ customReportId, companies, startDate: ym, endDate: ym, currency: "GBP" });
        const parsed = mapBoardPackRows(json, ym);
        if (parsed.rows.length) { await upsertBoardPack(scope, parsed, actor || "joiin-api"); packs++; }
        else errors.push(`${scope} ${ym}: empty board pack`);
      } catch (e) {
        errors.push(`${scope} ${ym}: ${e.message}`);
      }
    }
  }
  return { packs, errors };
}

async function handle(request, actor) {
  if (!joiinConfigured()) {
    return NextResponse.json({ error: "JOIIN_API_KEY is not set — add it as an environment secret to enable the direct Joiin connection." }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const months = Array.isArray(body.months) && body.months.length ? body.months : defaultMonths();
  try {
    const r = await refresh(months);
    const bp = await refreshBoardPacks(months, actor);
    await audit({ actor, eventType: "joiin_api.refresh", objectType: "joiin_pl_entity", objectRef: months.join(","), detail: { ...r, boardPacks: bp } });
    // Nothing landed and both phases errored → report it as a failure so the UI
    // shows Joiin's actual message rather than a silent "0 rows".
    if (r.entityRows === 0 && bp.packs === 0) {
      const eErr = (r.entityErrors || [])[0];
      const bErr = (bp.errors || [])[0];
      const why = [eErr && `P&L → ${eErr}`, bErr && `board pack → ${bErr}`].filter(Boolean).join(" · ") || "no data returned";
      return NextResponse.json({ error: `Joiin refresh returned nothing — ${why}`, ...r, boardPacks: bp }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ...r, boardPacks: bp });
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

// Vercel Cron issues GET with the Authorization bearer.
export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!joiinConfigured()) return NextResponse.json({ error: "JOIIN_API_KEY not set" }, { status: 400 });
  const months = defaultMonths();
  try {
    const r = await refresh(months);
    const bp = await refreshBoardPacks(months, "joiin-cron");
    await audit({ actor: "joiin-cron", eventType: "joiin_api.refresh", objectType: "joiin_pl_entity", objectRef: r.months.join(","), detail: { ...r, boardPacks: bp } });
    return NextResponse.json({ ok: true, ...r, boardPacks: bp });
  } catch (e) {
    return NextResponse.json({ error: `Joiin refresh failed: ${e.message}` }, { status: 502 });
  }
}
