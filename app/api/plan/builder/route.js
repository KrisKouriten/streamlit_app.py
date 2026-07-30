import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import {
  upsertSalesDriverInput,
  upsertCostRule, deleteCostRule,
  upsertPayrollRule, deletePayrollRule,
  computeStoreSalesForVersion,
  computeCostsForVersion,
  computePayrollForVersion,
} from "../../../../lib/planning";

// Budget/Forecast Builder mutations over the planning engine.
//   saveSales — upsert a store's monthly sales-driver rows for a version/scenario
//   compute   — (re)compute sales + costs + payroll → plan_line for a version
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Planning requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const versionId = Number(body.versionId);
  if (!versionId) return NextResponse.json({ error: "A version is required" }, { status: 400 });
  const scenario = body.scenario || "BASE";

  try {
    if (body.action === "saveSales") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      let saved = 0;
      for (const r of rows) {
        if (!r.store_code || !r.period) continue;
        // Skip an untouched row (no method chosen and every value blank).
        const blank = ["footfall", "conversion", "atv", "direct_sales", "adjustment_amount", "adjustment_pct", "trading_days"]
          .every((k) => r[k] == null || r[k] === "");
        if (blank && !r.method) continue;
        await upsertSalesDriverInput({
          version_id: versionId,
          scenario_code: scenario,
          scope: r.scope || "COMPANY_STORE",
          store_code: r.store_code,
          period: r.period,
          method: r.method || "CORE",
          footfall: num(r.footfall),
          conversion: num(r.conversion),
          atv: num(r.atv),
          direct_sales: num(r.direct_sales),
          adjustment_amount: num(r.adjustment_amount),
          adjustment_pct: num(r.adjustment_pct),
          trading_days: num(r.trading_days),
          commentary: r.commentary || null,
        }, session);
        saved++;
      }
      return NextResponse.json({ ok: true, saved });
    }

    if (body.action === "saveCostRule") {
      const r = body.rule || {};
      const { ruleId } = await upsertCostRule({
        rule_id: r.rule_id || null,
        version_id: versionId,
        scenario_code: scenario,
        scope: r.scope || "COMPANY_STORE",
        store_code: r.store_code || null,
        nominal: r.nominal,
        behaviour: r.behaviour,
        monthly_amount: num(r.monthly_amount),
        annual_increase_pct: num(r.annual_increase_pct),
        rate: r.rate == null || r.rate === "" ? null : Number(r.rate) / 100, // UI enters a %
        sales_base: r.sales_base || "ST: Sales",
        start_period: r.start_period || null,
        end_period: r.end_period || null,
        commentary: r.commentary || null,
      }, session);
      return NextResponse.json({ ok: true, ruleId });
    }

    if (body.action === "deleteCostRule") {
      if (!body.ruleId) return NextResponse.json({ error: "ruleId required" }, { status: 400 });
      await deleteCostRule(Number(body.ruleId), session);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "savePayrollRule") {
      const r = body.rule || {};
      const { ruleId } = await upsertPayrollRule({
        rule_id: r.rule_id || null,
        version_id: versionId,
        scenario_code: scenario,
        scope: r.scope || "COMPANY_STORE",
        store_code: r.store_code || null,
        monthly_basic: num(r.monthly_basic),
        annual_increase_pct: num(r.annual_increase_pct),
        start_period: r.start_period,
        end_period: r.end_period,
        holiday_pct: pct(r.holiday_pct),
        pension_pct: pct(r.pension_pct),
        er_ni_pct: pct(r.er_ni_pct),
        ni_threshold_monthly: num(r.ni_threshold_monthly),
        commentary: r.commentary || null,
      }, session);
      return NextResponse.json({ ok: true, ruleId });
    }

    if (body.action === "deletePayrollRule") {
      if (!body.ruleId) return NextResponse.json({ error: "ruleId required" }, { status: 400 });
      await deletePayrollRule(Number(body.ruleId), session);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "compute") {
      const opts = { scenario, storeCode: body.storeCode || null };
      const sales = await computeStoreSalesForVersion(versionId, opts, session);
      const costs = await computeCostsForVersion(versionId, opts, session);
      const payroll = await computePayrollForVersion(versionId, opts, session);
      return NextResponse.json({ ok: true, sales, costs, payroll });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("plan builder API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// A percentage entered in the UI (e.g. 12.07) → fraction (0.1207). Null stays null.
function pct(v) {
  const n = num(v);
  return n == null ? null : n / 100;
}
