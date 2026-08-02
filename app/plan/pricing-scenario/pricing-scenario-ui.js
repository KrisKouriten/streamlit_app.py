"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/* Pricing Scenario workspace — client. Reads the decorated scenario lines +
   dashboard KPIs from the server page and drives /api/pricing-scenario (create)
   and /api/pricing-scenario/<id> (status, add-skus, save-line, delete-line).
   House style: inline styles on CSS variables, no framework. All scenario maths
   is computed server-side (lib/pricing-scenario-rules) and arrives on each line's
   `impact`/`shares` and the `blended`/`dashboard` blocks; this file only presents.
   Rates are fractions (0.4 → "40.0%"); margin-point movements are fractions too
   (0.023 → "2.30 pts"). */

const money = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : "£" + Math.round(Number(n)).toLocaleString("en-GB"));
const num = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : Math.round(Number(n)).toLocaleString("en-GB"));
const pct = (n, dp = 1) => (n == null ? "—" : (Number(n) * 100).toFixed(dp) + "%");
const pts = (n, dp = 2) => (n == null ? "—" : (Number(n) * 100).toFixed(dp) + " pts");

const CHANNEL_LABEL = { MINISO_MDS: "Miniso MDS", LOCAL_PURCHASE: "Local Purchase" };
const channelName = (c) => CHANNEL_LABEL[c] || c || "—";

const SCENARIO_TYPES = ["PROMOTION", "MARKDOWN", "PERMANENT", "CLEARANCE", "MULTI_BUY", "PREMIUM"];
const typeLabel = (t) => (t ? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

const TONE_FG = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", muted: "var(--muted)" };
const TONE_BG = { green: "var(--green-bg)", amber: "var(--amber-bg)", red: "var(--red-bg)", muted: "var(--raise)" };

// Status → pill tone. DRAFT/ARCHIVED muted, APPROVED green.
const STATUS_TONE = { DRAFT: "muted", APPROVED: "green", ARCHIVED: "muted" };

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

function Kpi({ label, value, tone }) {
  return (
    <div className="fos-card" style={{ padding: "14px 16px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 23, fontWeight: 650, lineHeight: 1, letterSpacing: "-.02em", color: tone ? TONE_FG[tone] : "var(--ink)" }}>{value}</div>
    </div>
  );
}

const EMPTY_SCENARIO = { name: "", scenario_type: "PROMOTION", period_start: "", period_end: "", company_sales: "" };

export default function PricingScenarioWorkspace({ scenarios = [], selected = null, skuOptions = [], canApprove = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  // New scenario form
  const [showNew, setShowNew] = useState(false);
  const [ns, setNs] = useState(EMPTY_SCENARIO);

  // Add-SKU picker
  const [skuQuery, setSkuQuery] = useState("");
  const [picked, setPicked] = useState([]); // [{sku_code, channel_code}]

  // Per-line edit buffer keyed by line_id → { new_rrp, expected_units }
  const [edits, setEdits] = useState({});

  const sc = selected?.scenario || null;
  const lines = selected?.lines || [];
  const blended = selected?.blended || {};
  const dashboard = selected?.dashboard || {};
  const isDraft = sc?.status === "DRAFT";

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

  function selectScenario(id) {
    router.push(`/plan/pricing-scenario?s=${id}`);
  }

  const setNsK = (k) => (e) => setNs((s) => ({ ...s, [k]: e.target.value }));

  function createScenario() {
    if (!ns.name.trim()) { setError("Give the scenario a name."); return; }
    post("/api/pricing-scenario", ns, {
      onOk: (j) => {
        setMsg(`Scenario “${ns.name}” created.`);
        setNs(EMPTY_SCENARIO); setShowNew(false);
        if (j.scenarioId) router.push(`/plan/pricing-scenario?s=${j.scenarioId}`);
        else router.refresh();
      },
    });
  }

  function setStatus(action) {
    post(`/api/pricing-scenario/${sc.scenario_id}`, { op: "status", action });
  }

  // Add-SKU picker — filter by typed text against sku_code/description/category.
  const pickedSet = useMemo(() => new Set(picked.map((p) => `${p.sku_code}::${p.channel_code}`)), [picked]);
  const filteredSkus = useMemo(() => {
    const q = skuQuery.trim().toLowerCase();
    const list = q
      ? skuOptions.filter((x) => [x.sku_code, x.description, x.category].some((v) => (v || "").toLowerCase().includes(q)))
      : skuOptions;
    return list.slice(0, 60);
  }, [skuOptions, skuQuery]);

  function togglePick(x, on) {
    const key = `${x.sku_code}::${x.channel_code}`;
    setPicked((cur) => on
      ? (cur.some((p) => `${p.sku_code}::${p.channel_code}` === key) ? cur : [...cur, { sku_code: x.sku_code, channel_code: x.channel_code }])
      : cur.filter((p) => `${p.sku_code}::${p.channel_code}` !== key));
  }

  function addSkus() {
    if (!picked.length) { setError("Pick at least one SKU to add."); return; }
    post(`/api/pricing-scenario/${sc.scenario_id}`, { op: "add-skus", selections: picked }, {
      onOk: (j) => { setMsg(`Added ${j.added ?? picked.length} SKU${(j.added ?? picked.length) === 1 ? "" : "s"} to the scenario.`); setPicked([]); setSkuQuery(""); router.refresh(); },
    });
  }

  const editVal = (line, k) => (edits[line.line_id]?.[k] !== undefined
    ? edits[line.line_id][k]
    : (k === "new_rrp" ? (line.new_rrp ?? "") : (line.expected_units ?? "")));
  const setEdit = (lineId, k) => (e) => setEdits((s) => ({ ...s, [lineId]: { ...s[lineId], [k]: e.target.value } }));
  const dirty = (lineId) => edits[lineId] && Object.keys(edits[lineId]).length > 0;

  function saveLine(line) {
    const buf = edits[line.line_id];
    if (!buf) return;
    const patch = {};
    if (buf.new_rrp !== undefined) patch.new_rrp = buf.new_rrp === "" ? null : Number(buf.new_rrp);
    if (buf.expected_units !== undefined) patch.expected_units = buf.expected_units === "" ? null : Number(buf.expected_units);
    post(`/api/pricing-scenario/${sc.scenario_id}`, { op: "save-line", lineId: line.line_id, patch }, {
      onOk: () => { setEdits((s) => { const n = { ...s }; delete n[line.line_id]; return n; }); router.refresh(); },
    });
  }

  function deleteLine(line) {
    if (!window.confirm(`Remove ${line.sku_code} from this scenario?`)) return;
    post(`/api/pricing-scenario/${sc.scenario_id}`, { op: "delete-line", lineId: line.line_id });
  }

  return (
    <div>
      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* ---- 1. Scenario list + New scenario ---- */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 650 }}>Scenarios <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {scenarios.length}</span></div>
          <button style={ghost} onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "New scenario"}</button>
        </div>

        {showNew && (
          <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--line))", background: "var(--accent-bg)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
              <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Name *</span><input style={inputSt} value={ns.name} onChange={setNsK("name")} placeholder="e.g. Autumn plush promotion" /></label>
              <label style={field}><span style={labelSt}>Scenario type</span>
                <select style={inputSt} value={ns.scenario_type} onChange={setNsK("scenario_type")}>
                  {SCENARIO_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
                </select>
              </label>
              <label style={field}><span style={labelSt}>Period start</span><input type="date" style={inputSt} value={ns.period_start} onChange={setNsK("period_start")} /></label>
              <label style={field}><span style={labelSt}>Period end</span><input type="date" style={inputSt} value={ns.period_end} onChange={setNsK("period_end")} /></label>
              <label style={field}><span style={labelSt}>Company sales (£)</span><input type="number" min="0" step="1" style={inputSt} value={ns.company_sales} onChange={setNsK("company_sales")} placeholder="for % of company sales" /></label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button style={btn("var(--accent)")} disabled={busy || !ns.name.trim()} onClick={createScenario}>{busy ? "Working…" : "Create scenario"}</button>
              <button style={ghost} onClick={() => { setShowNew(false); setNs(EMPTY_SCENARIO); }}>Cancel</button>
            </div>
          </div>
        )}

        {!scenarios.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No scenarios yet. Create one to start modelling a price change.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead><tr>
                {["Name", "Type", "Status", "Lines", "Period"].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {scenarios.map((s) => {
                  const on = sc && String(sc.scenario_id) === String(s.scenario_id);
                  return (
                    <tr key={s.scenario_id} onClick={() => selectScenario(s.scenario_id)} style={{ cursor: "pointer", background: on ? "var(--bg)" : "transparent" }}>
                      <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                      <td style={td}>{typeLabel(s.scenario_type)}</td>
                      <td style={td}><StatusPill status={s.status} /></td>
                      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{s.line_count ?? 0}</td>
                      <td style={{ ...td, color: "var(--muted)" }}>{s.period_start || "—"}{s.period_end ? ` → ${s.period_end}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- 2. Selected scenario ---- */}
      {sc && (
        <>
          {/* header + status controls */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 650, display: "flex", alignItems: "center", gap: 10 }}>{sc.name} <StatusPill status={sc.status} /></div>
                <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 3 }}>
                  {typeLabel(sc.scenario_type)}
                  {sc.period_start ? ` · ${sc.period_start}${sc.period_end ? ` → ${sc.period_end}` : ""}` : ""}
                  {sc.company_sales != null ? ` · company sales ${money(sc.company_sales)}` : ""}
                  {` · ${dashboard.lineCount ?? lines.length} line${(dashboard.lineCount ?? lines.length) === 1 ? "" : "s"}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {sc.status === "DRAFT" && canApprove && <button style={btn("var(--green)")} disabled={busy} onClick={() => setStatus("approve")}>Approve</button>}
                {sc.status !== "ARCHIVED" && <button style={ghost} disabled={busy} onClick={() => setStatus("archive")}>Archive</button>}
                {sc.status !== "DRAFT" && canApprove && <button style={ghost} disabled={busy} onClick={() => setStatus("reopen")}>Reopen</button>}
              </div>
            </div>
            {sc.notes && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{sc.notes}</div>}
          </div>

          {/* dashboard cards */}
          <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 22 }}>
            <Kpi label="Current blended GP" value={pct(blended.current)} />
            <Kpi label="Scenario blended GP" value={pct(blended.scenario)} />
            <Kpi label="Company margin impact" value={pts(blended.movement)} tone={blended.movement != null && blended.movement < 0 ? "red" : null} />
            <Kpi label="Margin lost" value={money(dashboard.marginLost)} tone={dashboard.marginLost < 0 ? "red" : null} />
            <Kpi label="Revenue movement" value={money(dashboard.revenueMovement)} tone={dashboard.revenueMovement > 0 ? "green" : dashboard.revenueMovement < 0 ? "red" : null} />
            <Kpi label="Units movement" value={num(dashboard.unitsMovement)} tone={dashboard.unitsMovement > 0 ? "green" : dashboard.unitsMovement < 0 ? "red" : null} />
            <Kpi label="Cash recovery" value={money(dashboard.cashRecovery)} />
          </div>

          {/* blended explainer */}
          <div style={{ ...card, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
            <span style={{ ...labelSt, marginRight: 8 }}>Blended margin</span>
            Current <strong style={{ color: "var(--ink)" }}>{pct(blended.current)}</strong> →
            Scenario <strong style={{ color: "var(--ink)" }}>{pct(blended.scenario)}</strong> →
            Movement <strong style={{ color: blended.movement != null && blended.movement < 0 ? "var(--red)" : "var(--ink)" }}>{pts(blended.movement)}</strong>
            <span style={{ color: "var(--faint)" }}> · weighted by sales value, not a simple average.</span>
          </div>

          {/* add SKUs */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>Add SKUs</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12 }}>Search the priced range and pick the SKUs to model in this scenario. Each SKU snapshots its current price, cost and baseline sales.</div>
            <input style={{ ...inputSt, width: "100%", marginBottom: 10 }} placeholder="Filter by SKU, description or category" value={skuQuery} onChange={(e) => setSkuQuery(e.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 4, maxHeight: 240, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
              {!filteredSkus.length ? (
                <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No SKUs match.</div>
              ) : filteredSkus.map((x) => {
                const key = `${x.sku_code}::${x.channel_code}`;
                const on = pickedSet.has(key);
                return (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" checked={on} onChange={(e) => togglePick(x, e.target.checked)} />
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{x.sku_code}</span>
                    <span style={{ color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.description || channelName(x.channel_code)}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
              <button style={btn("var(--accent)")} disabled={busy || !picked.length} onClick={addSkus}>{busy ? "Working…" : `Add to scenario${picked.length ? ` (${picked.length})` : ""}`}</button>
              {picked.length > 0 && <button style={ghost} onClick={() => setPicked([])}>Clear selection</button>}
            </div>
          </div>

          {/* line grid */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Scenario lines <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {lines.length}</span></div>
            {!lines.length ? (
              <div style={{ fontSize: 13, color: "var(--faint)" }}>No SKUs in this scenario yet. Add SKUs above to model a price change.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1120 }}>
                  <thead><tr>
                    {["SKU", "Description", "Category"].map((h) => <th key={h} style={th}>{h}</th>)}
                    {["Current RRP", "New RRP", "Current GP%", "New GP%", "Margin reduction", "% of company", "Company margin impact", "Expected units"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
                    <th style={th}></th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const imp = l.impact || {}; const cur = imp.current || {}; const pro = imp.proposed || {}; const sh = l.shares || {};
                      return (
                        <tr key={l.line_id}>
                          <td style={{ ...td, fontFamily: "var(--mono)", fontWeight: 600 }}>{l.sku_code}</td>
                          <td style={{ ...td, whiteSpace: "normal", maxWidth: 220 }}>{l.description || "—"}</td>
                          <td style={td}>{l.category || "—"}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(l.current_rrp)}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <input type="number" step="0.01" disabled={!isDraft} style={{ ...inputSt, width: 92, padding: "5px 7px", textAlign: "right" }}
                              value={editVal(l, "new_rrp")}
                              onChange={setEdit(l.line_id, "new_rrp")}
                              onBlur={() => dirty(l.line_id) && saveLine(l)} />
                          </td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{pct(cur.gpPct)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right", color: pro.gpPct != null && pro.gpPct < 0 ? "var(--red)" : "var(--ink)" }}>{pct(pro.gpPct)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right", color: imp.marginReductionPts != null && imp.marginReductionPts > 0 ? "var(--red)" : "var(--ink)" }}>{pts(imp.marginReductionPts)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right" }}>{pct(sh.companyPct)}</td>
                          <td className="fos-num" style={{ ...td, textAlign: "right", color: l.companyMarginImpact != null && l.companyMarginImpact < 0 ? "var(--red)" : "var(--ink)" }}>{pts(l.companyMarginImpact)}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <input type="number" step="1" disabled={!isDraft} style={{ ...inputSt, width: 92, padding: "5px 7px", textAlign: "right" }}
                              value={editVal(l, "expected_units")}
                              onChange={setEdit(l.line_id, "expected_units")}
                              onBlur={() => dirty(l.line_id) && saveLine(l)} />
                          </td>
                          <td style={{ ...td, textAlign: "center" }}>
                            {isDraft && (
                              <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                                {dirty(l.line_id) && <button style={{ ...ghost, padding: "4px 10px" }} disabled={busy} onClick={() => saveLine(l)}>Save</button>}
                                <button title="Remove SKU" style={{ ...ghost, padding: "4px 9px", color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, var(--line))" }} onClick={() => deleteLine(l)}>×</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!isDraft && lines.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>This scenario is {sc.status.toLowerCase()} — lines are read-only. Reopen it to edit.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
