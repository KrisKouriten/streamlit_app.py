"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/* Capex Investment workspace — client. Reads the decorated project rows, the
   portfolio consolidation, the capital position and (when ?p is set) a single
   project's 10-year model from the server page, and drives /api/capex (create,
   set-allocation) and /api/capex/<project_id> (patch, delete). House style:
   inline styles on CSS variables, no framework. All appraisal maths is computed
   server-side (lib/capex-rules) and arrives on each project's `model`; this file
   only presents. Rates are fractions (0.234 → "23.4%"); the % form inputs are
   whole numbers, converted ÷100 before POSTing and ×100 for display. */

const money = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : "£" + Math.round(Number(n)).toLocaleString("en-GB"));
const num = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : Math.round(Number(n)).toLocaleString("en-GB"));
const pct = (n, dp = 1) => (n == null ? "—" : (Number(n) * 100).toFixed(dp) + "%");
const yrs = (n, dp = 1) => (n == null ? "—" : Number(n).toFixed(dp) + " yrs");

// Investment types — hardcoded for the type select (do NOT import from lib).
const INVESTMENT_TYPES = ["NEW_STORE", "REFURBISHMENT", "WAREHOUSE", "OFFICE", "IT", "DISTRIBUTION", "FRANCHISE", "ACQUISITION", "OTHER"];
// The investment components, with humanised labels for the input grid.
const INVESTMENT_COMPONENTS = ["fit_out", "fixtures", "it", "inventory", "professional_fees", "marketing", "working_capital", "rent", "business_rates", "service_charge", "contingency", "other"];
const COMPONENT_LABEL = {
  fit_out: "Fit-out", fixtures: "Fixtures", it: "IT", inventory: "Inventory",
  professional_fees: "Professional fees", marketing: "Marketing",
  working_capital: "Working capital", rent: "Rent", business_rates: "Business rates",
  service_charge: "Service charge", contingency: "Contingency", other: "Other",
};
const STATUSES = ["PLANNED", "APPROVED", "COMMITTED", "ON_HOLD", "COMPLETE"];

const typeLabel = (t) => (t === "IT" ? "IT" : t ? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

const TONE_FG = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", muted: "var(--muted)" };
const TONE_BG = { green: "var(--green-bg)", amber: "var(--amber-bg)", red: "var(--red-bg)", muted: "var(--raise)" };

// Status → pill tone. PLANNED/COMPLETE muted, APPROVED/COMMITTED green, ON_HOLD amber.
const STATUS_TONE = { PLANNED: "muted", APPROVED: "green", COMMITTED: "green", ON_HOLD: "amber", COMPLETE: "muted" };

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || "muted";
  return (
    <span style={{ display: "inline-block", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: TONE_FG[tone], background: TONE_BG[tone], border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", lineHeight: 1.2 }}>
      {status || "—"}
    </span>
  );
}

function FlagBadge({ children }) {
  return (
    <span style={{ display: "inline-block", fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--red)", background: "var(--red-bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap", lineHeight: 1.3 }}>
      {children}
    </span>
  );
}

function HurdleBadge({ clears }) {
  const tone = clears == null ? "muted" : clears ? "green" : "red";
  const label = clears == null ? "n/a" : clears ? "Clears hurdle" : "Below hurdle";
  return (
    <span style={{ display: "inline-block", fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: TONE_FG[tone], background: TONE_BG[tone], border: "1px solid var(--line)", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap", lineHeight: 1.3 }}>
      {label}
    </span>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div className="fos-card" style={{ padding: "14px 16px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 23, fontWeight: 650, lineHeight: 1, letterSpacing: "-.02em", color: tone ? TONE_FG[tone] : "var(--ink)" }}>{value}</div>
    </div>
  );
}

const EMPTY_PROJECT = {
  name: "", investment_type: "NEW_STORE", region: "", owner: "", status: "PLANNED", priority: "",
  fit_out: "", fixtures: "", it: "", inventory: "", professional_fees: "", marketing: "",
  working_capital: "", rent: "", business_rates: "", service_charge: "", contingency: "", other: "",
  year1_revenue: "", revenue_growth_pct: "", gross_margin_pct: "", payroll_pct: "", opex_pct: "",
  years: "10", depreciation_years: "7", tax_rate: "25", discount_rate: "10",
  committed_amount: "", spent_amount: "",
};

export default function CapexWorkspace({ projects = [], portfolio = null, allocation = null, selected = null, view = "portfolio", scenario = "BASE", fiscalYear = 2026, canManage = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const [showNew, setShowNew] = useState(false);
  const [np, setNp] = useState(EMPTY_PROJECT);

  const port = portfolio?.portfolio || {};
  const alloc = portfolio?.allocation || null;
  const rows = portfolio?.projects || [];
  const hurdleRate = portfolio?.hurdleRate ?? null;

  // One POST helper: on !ok surface {error}; on ok refresh the server data.
  async function post(url, body, { onOk } = {}) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Action failed");
      if (onOk) onOk(j);
      else router.refresh();
      return j;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }

  const base = `/plan/capex?scenario=${encodeURIComponent(scenario)}&year=${fiscalYear}`;
  const goPortfolio = () => router.push(base);
  const goAllocation = () => router.push(`${base}&view=allocation`);
  const goYear = (y) => router.push(`/plan/capex?scenario=${encodeURIComponent(scenario)}&year=${y}${view === "allocation" ? "&view=allocation" : ""}`);
  const openProject = (id) => router.push(`${base}&p=${id}`);

  const setNpK = (k) => (e) => setNp((s) => ({ ...s, [k]: e.target.value }));

  // Percentage form fields → fractions; blank → omitted.
  const PCT_FIELDS = ["revenue_growth_pct", "gross_margin_pct", "payroll_pct", "opex_pct", "tax_rate", "discount_rate"];
  const NUM_FIELDS = ["priority", "year1_revenue", "years", "depreciation_years", "committed_amount", "spent_amount", ...INVESTMENT_COMPONENTS];

  function createProject() {
    if (!np.name.trim()) { setError("Give the project a name."); return; }
    const body = { name: np.name.trim(), investment_type: np.investment_type, region: np.region, owner: np.owner, status: np.status };
    for (const k of NUM_FIELDS) if (np[k] !== "" && np[k] != null) body[k] = Number(np[k]);
    for (const k of PCT_FIELDS) if (np[k] !== "" && np[k] != null) body[k] = Number(np[k]) / 100;
    post("/api/capex", body, {
      onOk: (j) => {
        setMsg(`Project “${np.name.trim()}” created.`);
        setNp(EMPTY_PROJECT); setShowNew(false);
        if (j.projectId) router.push(`/plan/capex?p=${j.projectId}`);
        else router.refresh();
      },
    });
  }

  function deleteProject(p) {
    if (!window.confirm(`Delete project ${p.name}? This removes its appraisal and cannot be undone.`)) return;
    post(`/api/capex/${p.project_id}`, { op: "delete" });
  }

  return (
    <div>
      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* ---- Top controls: view toggle + scenario/year ---- */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
          {[["portfolio", "Portfolio", goPortfolio], ["allocation", "Capital Allocation", goAllocation]].map(([k, label, go]) => {
            const on = view === k;
            return (
              <button key={k} onClick={go} style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 13px", borderRadius: 7, cursor: "pointer",
                background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong,var(--line))" : "transparent"}`,
                color: on ? "var(--ink)" : "var(--muted)" }}>{label}</button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={field}><span style={labelSt}>Scenario</span><span style={{ fontSize: 13.5, fontWeight: 600, padding: "6px 0" }}>{scenario}</span></div>
          <label style={field}><span style={labelSt}>Fiscal year</span>
            <input type="number" step="1" style={{ ...inputSt, width: 110 }} defaultValue={fiscalYear}
              onKeyDown={(e) => { if (e.key === "Enter") goYear(Number(e.currentTarget.value)); }}
              onBlur={(e) => { const v = Number(e.currentTarget.value); if (v && v !== fiscalYear) goYear(v); }} />
          </label>
        </div>
      </div>

      {/* ================= SELECTED PROJECT DRILL ================= */}
      {selected ? (
        <ProjectDrill selected={selected} base={base} goBack={goPortfolio} canManage={canManage} post={post} busy={busy} />
      ) : view === "allocation" ? (
        /* ================= CAPITAL ALLOCATION VIEW ================= */
        <AllocationView port={port} alloc={alloc} rows={rows} allocation={allocation} fiscalYear={fiscalYear} canManage={canManage} post={post} busy={busy} />
      ) : (
        /* ================= PORTFOLIO VIEW ================= */
        <>
          {/* KPI cards */}
          <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
            <Kpi label="Total investment" value={money(port.totalInvestment)} />
            <Kpi label="Projects" value={port.projects ?? 0} />
            <Kpi label="Portfolio NPV" value={money(port.npv)} tone={port.npv == null ? null : port.npv > 0 ? "green" : port.npv < 0 ? "red" : null} />
            <Kpi label="Portfolio IRR" value={pct(port.irr)} />
            <Kpi label="Avg IRR" value={pct(port.avgIrr)} />
            <Kpi label="Portfolio payback" value={yrs(port.payback)} />
            <Kpi label="Avg EBITDA margin" value={pct(port.avgEbitdaMargin)} />
          </div>

          {/* Hurdle line */}
          <div style={{ ...card, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
            <span style={{ ...labelSt, marginRight: 8 }}>Hurdle rate</span>
            <strong style={{ color: "var(--ink)" }}>{hurdleRate == null ? "—" : pct(hurdleRate)}</strong>
            <span style={{ color: "var(--faint)" }}> · projects clearing the hurdle IRR are <span style={{ color: "var(--green)" }}>green</span>, those below are <span style={{ color: "var(--red)" }}>red</span>.</span>
          </div>

          {/* New project */}
          {canManage && (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showNew ? 12 : 0, gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 15, fontWeight: 650 }}>New project</div>
                <button style={ghost} onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "Add project"}</button>
              </div>
              {showNew && (
                <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--line))", background: "var(--accent-bg)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
                    <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Name *</span><input style={inputSt} value={np.name} onChange={setNpK("name")} placeholder="e.g. Manchester Arndale store" /></label>
                    <label style={field}><span style={labelSt}>Investment type</span>
                      <select style={inputSt} value={np.investment_type} onChange={setNpK("investment_type")}>
                        {INVESTMENT_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
                      </select>
                    </label>
                    <label style={field}><span style={labelSt}>Region</span><input style={inputSt} value={np.region} onChange={setNpK("region")} /></label>
                    <label style={field}><span style={labelSt}>Owner</span><input style={inputSt} value={np.owner} onChange={setNpK("owner")} /></label>
                    <label style={field}><span style={labelSt}>Status</span>
                      <select style={inputSt} value={np.status} onChange={setNpK("status")}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label style={field}><span style={labelSt}>Priority</span><input type="number" step="1" style={inputSt} value={np.priority} onChange={setNpK("priority")} /></label>
                  </div>

                  <div style={{ ...labelSt, margin: "16px 0 8px" }}>Investment components (£)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                    {INVESTMENT_COMPONENTS.map((k) => (
                      <label key={k} style={field}><span style={labelSt}>{COMPONENT_LABEL[k]}</span><input type="number" step="1" style={inputSt} value={np[k]} onChange={setNpK(k)} /></label>
                    ))}
                  </div>

                  <div style={{ ...labelSt, margin: "16px 0 8px" }}>Model assumptions</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                    <label style={field}><span style={labelSt}>Year 1 revenue (£)</span><input type="number" step="1" style={inputSt} value={np.year1_revenue} onChange={setNpK("year1_revenue")} /></label>
                    <label style={field}><span style={labelSt}>Revenue growth (%)</span><input type="number" step="0.1" style={inputSt} value={np.revenue_growth_pct} onChange={setNpK("revenue_growth_pct")} /></label>
                    <label style={field}><span style={labelSt}>Gross margin (%)</span><input type="number" step="0.1" style={inputSt} value={np.gross_margin_pct} onChange={setNpK("gross_margin_pct")} /></label>
                    <label style={field}><span style={labelSt}>Payroll (%)</span><input type="number" step="0.1" style={inputSt} value={np.payroll_pct} onChange={setNpK("payroll_pct")} /></label>
                    <label style={field}><span style={labelSt}>Opex (%)</span><input type="number" step="0.1" style={inputSt} value={np.opex_pct} onChange={setNpK("opex_pct")} /></label>
                    <label style={field}><span style={labelSt}>Years</span><input type="number" step="1" style={inputSt} value={np.years} onChange={setNpK("years")} /></label>
                    <label style={field}><span style={labelSt}>Depreciation years</span><input type="number" step="1" style={inputSt} value={np.depreciation_years} onChange={setNpK("depreciation_years")} /></label>
                    <label style={field}><span style={labelSt}>Tax rate (%)</span><input type="number" step="0.1" style={inputSt} value={np.tax_rate} onChange={setNpK("tax_rate")} /></label>
                    <label style={field}><span style={labelSt}>Discount rate (%)</span><input type="number" step="0.1" style={inputSt} value={np.discount_rate} onChange={setNpK("discount_rate")} /></label>
                  </div>

                  <div style={{ ...labelSt, margin: "16px 0 8px" }}>Delivery (£)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                    <label style={field}><span style={labelSt}>Committed amount</span><input type="number" step="1" style={inputSt} value={np.committed_amount} onChange={setNpK("committed_amount")} /></label>
                    <label style={field}><span style={labelSt}>Spent amount</span><input type="number" step="1" style={inputSt} value={np.spent_amount} onChange={setNpK("spent_amount")} /></label>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button style={btn("var(--accent)")} disabled={busy || !np.name.trim()} onClick={createProject}>{busy ? "Working…" : "Create project"}</button>
                    <button style={ghost} onClick={() => { setShowNew(false); setNp(EMPTY_PROJECT); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Project grid */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Projects <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {rows.length}</span></div>
            {!rows.length ? (
              <div style={{ fontSize: 13, color: "var(--faint)" }}>No projects in this scenario yet.{canManage ? " Add one above to start appraising." : ""}</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1080 }}>
                  <thead><tr>
                    {["Name", "Type", "Region", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}
                    {["Total investment", "IRR", "NPV", "Payback", "Avg EBITDA margin"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
                    <th style={th}>Flags</th>
                    <th style={{ ...th, textAlign: "right" }}>Committed</th>
                    {canManage && <th style={th}></th>}
                  </tr></thead>
                  <tbody>
                    {rows.map((p) => {
                      const irrTone = p.clearsHurdle == null ? null : p.clearsHurdle ? "green" : "red";
                      return (
                        <tr key={p.project_id}>
                          <td style={{ ...td, fontWeight: 600, cursor: "pointer", color: "var(--accent)" }} onClick={() => openProject(p.project_id)}>{p.name}</td>
                          <td style={td}>{typeLabel(p.investment_type)}</td>
                          <td style={td}>{p.region || "—"}</td>
                          <td style={td}><StatusPill status={p.status} /></td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(p.totalInvestment)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right", color: irrTone ? TONE_FG[irrTone] : "var(--ink)" }}>{pct(p.irr)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right", color: p.npv == null ? "var(--ink)" : p.npv > 0 ? "var(--green)" : p.npv < 0 ? "var(--red)" : "var(--ink)" }}>{money(p.npv)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{yrs(p.payback)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{pct(p.avgEbitdaMargin)}</td>
                          <td style={{ ...td, whiteSpace: "normal" }}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {p.behind_schedule && <FlagBadge>⚠ Behind</FlagBadge>}
                              {p.over_budget && <FlagBadge>⚠ Over-budget</FlagBadge>}
                            </div>
                          </td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(p.committed_amount)}</td>
                          {canManage && (
                            <td style={{ ...td, textAlign: "center" }}>
                              <button title="Delete project" style={{ ...ghost, padding: "4px 9px", color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, var(--line))" }} onClick={() => deleteProject(p)}>×</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Selected project drill ---------------- */
function ProjectDrill({ selected, base, goBack, canManage, post, busy }) {
  const model = selected.model || {};
  const summary = model.summary || {};
  const modelRows = model.rows || [];
  const cumulative = model.cumulative || [];
  // Payback year = first year cumulative FCF crosses ≥ 0.
  const paybackIdx = cumulative.findIndex((c) => c != null && Number(c) >= 0);

  const [edit, setEdit] = useState(() => ({
    year1_revenue: selected.year1_revenue ?? "",
    revenue_growth_pct: selected.revenue_growth_pct == null ? "" : String(Number(selected.revenue_growth_pct) * 100),
    gross_margin_pct: selected.gross_margin_pct == null ? "" : String(Number(selected.gross_margin_pct) * 100),
    payroll_pct: selected.payroll_pct == null ? "" : String(Number(selected.payroll_pct) * 100),
    opex_pct: selected.opex_pct == null ? "" : String(Number(selected.opex_pct) * 100),
    tax_rate: selected.tax_rate == null ? "" : String(Number(selected.tax_rate) * 100),
    discount_rate: selected.discount_rate == null ? "" : String(Number(selected.discount_rate) * 100),
    status: selected.status || "PLANNED",
  }));
  const [showEdit, setShowEdit] = useState(false);
  const setEK = (k) => (e) => setEdit((s) => ({ ...s, [k]: e.target.value }));

  function saveAssumptions() {
    const patch = { status: edit.status };
    if (edit.year1_revenue !== "") patch.year1_revenue = Number(edit.year1_revenue);
    for (const k of ["revenue_growth_pct", "gross_margin_pct", "payroll_pct", "opex_pct", "tax_rate", "discount_rate"]) {
      if (edit[k] !== "") patch[k] = Number(edit[k]) / 100;
    }
    post(`/api/capex/${selected.project_id}`, { patch });
  }

  const MODEL_COLS = ["Revenue", "Gross profit", "Payroll", "Opex", "EBITDA", "EBITDA margin", "Depreciation", "EBIT", "Tax", "Profit", "FCF", "Cumulative FCF"];

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <button style={ghost} onClick={goBack}>← Back to portfolio</button>
      </div>

      {/* Header */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 650, display: "flex", alignItems: "center", gap: 10 }}>{selected.name} <StatusPill status={selected.status} /></div>
            <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 3 }}>
              {typeLabel(selected.investment_type)}{selected.region ? ` · ${selected.region}` : ""}{selected.owner ? ` · ${selected.owner}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {selected.behind_schedule && <FlagBadge>⚠ Behind</FlagBadge>}
            {selected.over_budget && <FlagBadge>⚠ Over-budget</FlagBadge>}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
        <Kpi label="Total investment" value={money(summary.totalInvestment)} />
        <Kpi label="NPV" value={money(summary.npv)} tone={summary.npv == null ? null : summary.npv > 0 ? "green" : summary.npv < 0 ? "red" : null} />
        <Kpi label="IRR" value={pct(summary.irr)} />
        <Kpi label="Payback" value={yrs(summary.payback)} />
        <Kpi label="Avg EBITDA margin" value={pct(summary.avgEbitdaMargin)} />
        <Kpi label="ROCE (year 1)" value={pct(summary.roceYear1)} />
      </div>

      {/* 10-year model */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>10-year model
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}> · discount rate {pct(summary.discountRate)}{paybackIdx >= 0 && modelRows[paybackIdx] ? ` · payback in year ${modelRows[paybackIdx].year}` : ""}</span>
        </div>
        {!modelRows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No model rows for this project.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1180 }}>
              <thead><tr>
                <th style={th}>Year</th>
                {MODEL_COLS.map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {modelRows.map((r, i) => {
                  const cum = cumulative[i];
                  const isPayback = i === paybackIdx;
                  return (
                    <tr key={r.year ?? i}>
                      <td style={{ ...td, fontFamily: "var(--mono)", fontWeight: 600 }}>{r.year ?? i + 1}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.revenue)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.grossProfit)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.payroll)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.opex)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.ebitda)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{pct(r.ebitdaMargin)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.depreciation)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.ebit)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.tax)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)" }}>{money(r.profit)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)", color: r.fcf == null ? "var(--ink)" : r.fcf < 0 ? "var(--red)" : "var(--ink)" }}>{money(r.fcf)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", fontFamily: "var(--mono)",
                        background: isPayback ? "var(--green-bg)" : "transparent",
                        color: cum == null ? "var(--ink)" : isPayback ? "var(--green)" : cum < 0 ? "var(--red)" : "var(--ink)", fontWeight: isPayback ? 700 : 500 }}>{money(cum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit assumptions */}
      {canManage && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showEdit ? 12 : 0, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>Edit assumptions</div>
            <button style={ghost} onClick={() => setShowEdit((v) => !v)}>{showEdit ? "Cancel" : "Edit"}</button>
          </div>
          {showEdit && (
            <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--line))", background: "var(--accent-bg)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                <label style={field}><span style={labelSt}>Year 1 revenue (£)</span><input type="number" step="1" style={inputSt} value={edit.year1_revenue} onChange={setEK("year1_revenue")} /></label>
                <label style={field}><span style={labelSt}>Revenue growth (%)</span><input type="number" step="0.1" style={inputSt} value={edit.revenue_growth_pct} onChange={setEK("revenue_growth_pct")} /></label>
                <label style={field}><span style={labelSt}>Gross margin (%)</span><input type="number" step="0.1" style={inputSt} value={edit.gross_margin_pct} onChange={setEK("gross_margin_pct")} /></label>
                <label style={field}><span style={labelSt}>Payroll (%)</span><input type="number" step="0.1" style={inputSt} value={edit.payroll_pct} onChange={setEK("payroll_pct")} /></label>
                <label style={field}><span style={labelSt}>Opex (%)</span><input type="number" step="0.1" style={inputSt} value={edit.opex_pct} onChange={setEK("opex_pct")} /></label>
                <label style={field}><span style={labelSt}>Tax rate (%)</span><input type="number" step="0.1" style={inputSt} value={edit.tax_rate} onChange={setEK("tax_rate")} /></label>
                <label style={field}><span style={labelSt}>Discount rate (%)</span><input type="number" step="0.1" style={inputSt} value={edit.discount_rate} onChange={setEK("discount_rate")} /></label>
                <label style={field}><span style={labelSt}>Status</span>
                  <select style={inputSt} value={edit.status} onChange={setEK("status")}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button style={btn("var(--accent)")} disabled={busy} onClick={saveAssumptions}>{busy ? "Working…" : "Save assumptions"}</button>
                <button style={ghost} onClick={() => setShowEdit(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ---------------- Capital allocation view ---------------- */
function AllocationView({ port, alloc, rows, allocation, fiscalYear, canManage, post, busy }) {
  const [form, setForm] = useState(() => ({
    fiscal_year: String(allocation?.fiscal_year ?? fiscalYear),
    capital_available: allocation?.capital_available ?? "",
    cash_available: allocation?.cash_available ?? "",
    hurdle_rate: allocation?.hurdle_rate == null ? "15" : String(Number(allocation.hurdle_rate) * 100),
    notes: allocation?.notes ?? "",
  }));
  const setFK = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  function saveAllocation() {
    const body = { op: "set-allocation", fiscal_year: Number(form.fiscal_year), notes: form.notes };
    if (form.capital_available !== "") body.capital_available = Number(form.capital_available);
    if (form.cash_available !== "") body.cash_available = Number(form.cash_available);
    if (form.hurdle_rate !== "") body.hurdle_rate = Number(form.hurdle_rate) / 100;
    post("/api/capex", body);
  }

  return (
    <>
      {alloc ? (
        <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
          <Kpi label="Capital available" value={money(alloc.capitalAvailable)} />
          <Kpi label="Committed" value={money(alloc.committed)} />
          <Kpi label="Remaining" value={money(alloc.remaining)} tone={alloc.remaining == null ? null : alloc.remaining < 0 ? "red" : "green"} />
          <Kpi label="Cash available" value={money(alloc.cashAvailable)} />
          <Kpi label="Funding required" value={money(alloc.fundingRequired)} tone={alloc.fundingRequired == null ? null : alloc.fundingRequired > 0 ? "red" : null} />
          <Kpi label="Projects" value={alloc.projects ?? 0} />
          <Kpi label="Avg IRR" value={pct(alloc.avgIrr)} />
          <Kpi label="Avg payback" value={yrs(alloc.avgPayback)} />
        </div>
      ) : (
        <div style={{ ...card, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>
          No capital position set for FY{fiscalYear} yet.{canManage ? " Set the capital available, cash and hurdle rate below to see the allocation." : ""}
        </div>
      )}

      {/* Set allocation */}
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>Set capital allocation</div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14 }}>Set the annual capital available, free cash and the IRR hurdle every project is measured against.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            <label style={field}><span style={labelSt}>Fiscal year</span><input type="number" step="1" style={inputSt} value={form.fiscal_year} onChange={setFK("fiscal_year")} /></label>
            <label style={field}><span style={labelSt}>Capital available (£)</span><input type="number" step="1" style={inputSt} value={form.capital_available} onChange={setFK("capital_available")} /></label>
            <label style={field}><span style={labelSt}>Cash available (£)</span><input type="number" step="1" style={inputSt} value={form.cash_available} onChange={setFK("cash_available")} /></label>
            <label style={field}><span style={labelSt}>Hurdle rate (%)</span><input type="number" step="0.1" style={inputSt} value={form.hurdle_rate} onChange={setFK("hurdle_rate")} /></label>
            <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Notes</span><input style={inputSt} value={form.notes} onChange={setFK("notes")} /></label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button style={btn("var(--accent)")} disabled={busy} onClick={saveAllocation}>{busy ? "Working…" : "Save allocation"}</button>
          </div>
        </div>
      )}

      {/* Commitments table */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Commitments <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {rows.length} project{rows.length === 1 ? "" : "s"}</span></div>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No projects to allocate against yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
              <thead><tr>
                {["Name", "Type", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}
                {["Total investment", "Committed", "Spent", "IRR"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
                <th style={th}>Hurdle</th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.project_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                    <td style={td}>{typeLabel(p.investment_type)}</td>
                    <td style={td}><StatusPill status={p.status} /></td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(p.totalInvestment)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(p.committed_amount)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(p.spent_amount)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right", color: p.clearsHurdle == null ? "var(--ink)" : p.clearsHurdle ? "var(--green)" : "var(--red)" }}>{pct(p.irr)}</td>
                    <td style={td}><HurdleBadge clears={p.clearsHurdle} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
