"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";

/* Scenario planning — live levers over the Operate forecast aggregates.
   Linearity: sales' = s×(1+sp); variable' = v×(1+vp)×(1+sp); fixed' = f×(1+fp). */

const SCOPES = [["STORES", "Company stores"], ["HEAD_OFFICE", "Head office"], ["FRANCHISE", "Franchise"]];

async function post(body) {
  const res = await fetch("/api/forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function flex(m, sp, vp, fp) {
  const sales = m.sales * (1 + sp);
  const variable = m.variable * (1 + vp) * (1 + sp);
  const fixed = m.fixed * (1 + fp);
  return { sales, variable, fixed, ebitda: sales - variable - fixed };
}

export default function ScenariosUI({ data, ready, scenarios, canManage }) {
  const router = useRouter();
  const [sp, setSp] = useState(0);
  const [vp, setVp] = useState(0);
  const [fp, setFp] = useState(0);
  const [name, setName] = useState("");
  const [state, setState] = useState("");

  const flexed = useMemo(() => {
    if (!data) return null;
    const months = data.months;
    const perMonth = {}, totals = { sales: 0, variable: 0, fixed: 0, ebitda: 0 };
    const baseTotals = { sales: 0, variable: 0, fixed: 0, ebitda: 0 };
    for (const ym of months) {
      const b = { sales: 0, variable: 0, fixed: 0 };
      for (const [key] of SCOPES) {
        const m = data.byScope[key].months[ym];
        b.sales += m.sales; b.variable += m.variable; b.fixed += m.fixed;
      }
      const f = flex(b, sp, vp, fp);
      perMonth[ym] = f;
      for (const k of Object.keys(totals)) totals[k] += f[k];
      const be = b.sales - b.variable - b.fixed;
      baseTotals.sales += b.sales; baseTotals.variable += b.variable; baseTotals.fixed += b.fixed; baseTotals.ebitda += be;
    }
    return { months, perMonth, totals, baseTotals };
  }, [data, sp, vp, fp]);

  if (!ready) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)" }}>
      Run migration <span style={{ fontFamily: "var(--mono)" }}>013_forecast_inputs.sql</span> to enable scenario planning.
    </div>;
  }
  if (!data) {
    return <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)" }}>
      No forecast inputs loaded yet — populate them under <a href="/operate/forecast" style={{ color: "var(--accent)" }}>Operate → Forecast inputs</a> first.
    </div>;
  }

  const delta = flexed.totals.ebitda - flexed.baseTotals.ebitda;

  async function save() {
    if (!name.trim()) { setState("Give the scenario a name."); return; }
    setState("Saving…");
    try {
      await post({ action: "scenario", name, sales_pct: sp, variable_pct: vp, fixed_pct: fp });
      setState(`Saved “${name}”.`); router.refresh();
    } catch (x) { setState(x.message); }
  }

  return (
    <>
      {/* saved scenarios */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {scenarios.map((s) => {
          const on = Number(s.sales_pct) === sp && Number(s.variable_pct) === vp && Number(s.fixed_pct) === fp;
          return (
            <button key={s.scenario_id} onClick={() => { setSp(Number(s.sales_pct)); setVp(Number(s.variable_pct)); setFp(Number(s.fixed_pct)); }}
              className="fos-btn-ghost" style={on ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-bg)" } : undefined}
              title={s.notes || ""}>
              {s.name}
            </button>
          );
        })}
      </div>

      {/* levers */}
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 26 }}>
        <Lever label="Forecast sales" hint="all scopes" value={sp} onChange={setSp} />
        <Lever label="Variable rates" hint="rate × flexed sales" value={vp} onChange={setVp} />
        <Lever label="Fixed costs" hint="schedules & modelled lines" value={fp} onChange={setFp} />
        <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>EBITDA vs base</div>
          <div className="fos-num" style={{ fontSize: 27, fontWeight: 650, lineHeight: 1, letterSpacing: "-.025em", color: delta >= 0 ? "var(--green)" : "var(--red)" }}>
            {delta >= 0 ? "+" : ""}{money(delta, { compact: true })}
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{money(flexed.totals.ebitda, { compact: true })} scenario · {money(flexed.baseTotals.ebitda, { compact: true })} base</div>
        </div>
      </div>

      {/* monthly table */}
      <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 20 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
          <thead><tr>
            <th style={TH}>Group scenario</th>
            {flexed.months.map((m) => <th key={m} style={{ ...TH, textAlign: "right" }}>{m}</th>)}
            <th style={{ ...TH, textAlign: "right" }}>FY</th>
          </tr></thead>
          <tbody>
            {[["Sales", "sales"], ["Variable costs", "variable"], ["Fixed costs", "fixed"], ["EBITDA", "ebitda"]].map(([label, key]) => (
              <tr key={key}>
                <td style={{ ...TD, fontWeight: key === "ebitda" ? 650 : 400 }}>{label}</td>
                {flexed.months.map((m) => {
                  const v = flexed.perMonth[m][key];
                  return <td key={m} className="fos-num" style={{ ...TD, textAlign: "right", fontWeight: key === "ebitda" ? 650 : 400, color: key === "ebitda" ? (v >= 0 ? "var(--green)" : "var(--red)") : "var(--ink)" }}>{money(v, { compact: true })}</td>;
                })}
                <td className="fos-num" style={{ ...TD, textAlign: "right", fontWeight: 650, color: key === "ebitda" ? (flexed.totals[key] >= 0 ? "var(--green)" : "var(--red)") : "var(--ink)" }}>{money(flexed.totals[key], { compact: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
          <input className="fos-input" style={{ width: 220, height: 34, fontSize: 13 }} placeholder="Scenario name…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="fos-btn-ghost" onClick={save}>Save scenario</button>
          <span>Saved scenarios are shared — the group plans against them.</span>
          {state && <span style={{ color: "var(--muted)" }}>{state}</span>}
        </div>
      )}
    </>
  );
}

const TH = { textAlign: "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const TD = { padding: "8.5px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)" };

function Lever({ label, hint, value, onChange }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="range" min={-30} max={30} step={1} value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          style={{ flex: 1, accentColor: "var(--accent)" }} aria-label={`${label} percent`} />
        <span className="fos-num" style={{ fontSize: 18, fontWeight: 650, width: 62, textAlign: "right", color: value === 0 ? "var(--ink)" : value > 0 ? "var(--green)" : "var(--red)" }}>
          {value > 0 ? "+" : ""}{Math.round(value * 100)}%
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 7 }}>{hint}</div>
    </div>
  );
}
