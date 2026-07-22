import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { joiinConfigured, profitAndLoss, customReport } from "../../../lib/joiin-api";
import { mapReportRows, mapBoardPackRows } from "../../../lib/joiin-api-map";
import { ENTITY_ID } from "../../../lib/entity-map";
import { BOARDPACK_REPORTS } from "../../../lib/joiin-reports";
import { upsertBoardPack } from "../../../lib/joiin-boardpack";
import { query } from "../../../lib/db";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Default target months: current calendar month + the prior one (YYYY-MM).
function defaultMonths() {
  const now = new Date();
  const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [ym(prev), ym(now)];
}

async function refresh(months) {
  // Per-entity standalone P&L: one call per company per month → joiin_pl_entity.
  const names = Object.keys(ENTITY_ID);
  let entityRows = 0;
  for (const ym of months) {
    const upserts = [];
    for (const name of names) {
      let json;
      try { json = await profitAndLoss({ companies: [name], startDate: ym, endDate: ym, currency: "GBP" }); }
      catch (e) { throw new Error(`Joiin P&L for ${name} ${ym}: ${e.message}`); }
      for (const r of mapReportRows(json)) {
        if (!r.value) continue;
        upserts.push([ENTITY_ID[name], name, r.section, r.account, ym, r.value]);
      }
    }
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
  return { months, entityRows };
}

// Pull the four Joiin board packs (Store / Head Office / Franchise /
// Consolidated) by customReportId → finance.joiin_boardpack. Joiin lays out and
// consolidates each pack (wholesale intercompany eliminated), so we store its
// output verbatim. Additive to the per-entity refresh and best-effort: a board
// pack that fails is reported in `errors` without failing the whole refresh.
async function refreshBoardPacks(months, actor) {
  const companies = Object.keys(ENTITY_ID);
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
  const r = await refresh(months);
  const bp = await refreshBoardPacks(months, actor);
  await audit({ actor, eventType: "joiin_api.refresh", objectType: "joiin_pl_entity", objectRef: months.join(","), detail: { ...r, boardPacks: bp } });
  return NextResponse.json({ ok: true, ...r, boardPacks: bp });
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
  const r = await refresh(months);
  const bp = await refreshBoardPacks(months, "joiin-cron");
  await audit({ actor: "joiin-cron", eventType: "joiin_api.refresh", objectType: "joiin_pl_entity", objectRef: r.months.join(","), detail: { ...r, boardPacks: bp } });
  return NextResponse.json({ ok: true, ...r, boardPacks: bp });
}
