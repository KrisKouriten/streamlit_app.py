import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestForecastCsv, ingestForecastWorkbook, setForecastLine, saveScenario } from "../../../lib/forecast";
import { SCOPES } from "../../../lib/forecast-rules.js";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Forecast inputs require ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "upload") {
      if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
      const r = await ingestForecastCsv(body.csv, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "workbook") {
      if (!body.file) return NextResponse.json({ error: "No workbook content" }, { status: 400 });
      const buffer = Buffer.from(body.file, "base64");
      const r = await ingestForecastWorkbook(buffer, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "set") {
      const { scope, unit, line_label, cost_type, ym, value } = body;
      if (!Object.keys(SCOPES).includes(scope) || !line_label || !["SALES", "VARIABLE_RATE", "FIXED"].includes(cost_type) || !Number.isFinite(Number(value))) {
        return NextResponse.json({ error: "scope, line, cost type and a numeric value are required" }, { status: 400 });
      }
      if (cost_type !== "VARIABLE_RATE" && !/^\d{4}-\d{2}$/.test(ym || "")) {
        return NextResponse.json({ error: "SALES/FIXED lines need a month (YYYY-MM)" }, { status: 400 });
      }
      await setForecastLine({ scope, unit, line_label, cost_type, ym, value: Number(value) }, actor);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "scenario") {
      const { name, sales_pct, variable_pct, fixed_pct, notes } = body;
      if (!name?.trim()) return NextResponse.json({ error: "Scenario name required" }, { status: 400 });
      for (const v of [sales_pct, variable_pct, fixed_pct]) {
        if (v != null && (!Number.isFinite(Number(v)) || Math.abs(Number(v)) > 1)) {
          return NextResponse.json({ error: "Levers are decimals between -1 and 1 (e.g. 0.05 = +5%)" }, { status: 400 });
        }
      }
      await saveScenario({ name: name.trim(), sales_pct: Number(sales_pct) || 0, variable_pct: Number(variable_pct) || 0, fixed_pct: Number(fixed_pct) || 0, notes }, actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("forecast API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
