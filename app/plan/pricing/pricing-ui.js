"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/* Pricing Review workspace — client. Reads the decorated SKU rows + dashboard
   KPIs from the server page and drives /api/pricing (ingest, upsert) and
   /api/pricing/<price_id> (whatif, delete). House style: inline styles on CSS
   variables, no framework. All pricing maths is computed server-side (lib/
   pricing-rules) and arrives on each row's `view`; this file only presents. */

const money = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : "£" + Math.round(Number(n)).toLocaleString("en-GB"));
const pct = (n, dp = 1) => (n == null ? "—" : (Number(n) * 100).toFixed(dp) + "%");
const mult = (n, dp = 2) => (n == null ? "—" : Number(n).toFixed(dp) + "×");

const CHANNEL_LABEL = { MINISO_MDS: "Miniso MDS", LOCAL_PURCHASE: "Local Purchase" };
const channelName = (c) => CHANNEL_LABEL[c] || c || "—";

const TONE_FG = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };
const TONE_BG = { green: "var(--green-bg)", amber: "var(--amber-bg)", red: "var(--red-bg)" };

// Alerts, most severe first — drives both the row chips and the summary order.
const ALERT_ORDER = ["NEGATIVE_MARGIN", "PRICE_BELOW_COST", "BELOW_TARGET", "HIGH_FREIGHT", "FX_EXPOSURE", "AIR_FREIGHT_USED"];
const ALERT_LABEL = {
  NEGATIVE_MARGIN: "Negative margin",
  PRICE_BELOW_COST: "Price below cost",
  BELOW_TARGET: "Below target GP",
  HIGH_FREIGHT: "High freight burden",
  FX_EXPOSURE: "FX exposure",
  AIR_FREIGHT_USED: "Air freight used",
};
const ALERT_TONE = {
  NEGATIVE_MARGIN: "red", PRICE_BELOW_COST: "red", BELOW_TARGET: "amber",
  HIGH_FREIGHT: "amber", FX_EXPOSURE: "amber", AIR_FREIGHT_USED: "amber",
};

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };

const EMPTY_SKU = {
  sku_code: "", channel_code: "MINISO_MDS", description: "", category: "",
  rmb_cost: "", fx_rate: "", wholesale_margin_pct: "", distributor_margin_pct: "",
  retail_vat_pct: "", actual_retail_price: "", target_gp_pct: "",
};

function AlertChip({ code }) {
  const tone = ALERT_TONE[code] || "amber";
  return (
    <span style={{ display: "inline-block", fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: TONE_FG[tone], background: TONE_BG[tone], border: "1px solid var(--line)", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap", lineHeight: 1.3 }}>
      {ALERT_LABEL[code] || code}
    </span>
  );
}

function HealthBadge({ health }) {
  const h = health || {};
  const tone = h.band?.tone || "amber";
  const label = h.band?.label || "—";
  const score = h.score == null ? "—" : h.score;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: TONE_FG[tone], background: TONE_BG[tone], border: "1px solid var(--line)", borderRadius: 7, padding: "3px 8px", whiteSpace: "nowrap" }}>
      <span className="fos-num" style={{ fontWeight: 700 }}>{score}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </span>
  );
}

export default function PricingWorkspace({ skus = [], dashboard = { ready: false }, categories = [], filters = {}, canManage = false }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  // Upload + Add SKU form state
  const [csv, setCsv] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newSku, setNewSku] = useState(EMPTY_SKU);

  // What-if local state (a read — never refreshes the page)
  const [wf, setWf] = useState({ fxTo: "", freightPct: "", discountTo: "", targetGpPct: "" });
  const [wfResult, setWfResult] = useState(null);
  const [wfBusy, setWfBusy] = useState(false);

  const selected = useMemo(() => skus.find((s) => s.price_id === selectedId) || null, [skus, selectedId]);

  // Filters navigation — rebuild the query string from the current filters.
  function navigate(next) {
    const f = { ...filters, ...next };
    const params = new URLSearchParams();
    if (f.channel) params.set("channel", f.channel);
    if (f.category) params.set("category", f.category);
    if (f.status) params.set("status", f.status);
    if (f.q) params.set("q", f.q);
    const qs = params.toString();
    router.push(`/plan/pricing${qs ? `?${qs}` : ""}`);
  }

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

  function uploadCsv() {
    if (!csv.trim()) { setError("Paste or choose a CSV first."); return; }
    post("/api/pricing", { op: "ingest", csv }, {
      onOk: (j) => { setMsg(`Uploaded ${j.rows} SKU${j.rows === 1 ? "" : "s"}.${j.warnings?.length ? ` ${j.warnings.length} row(s) skipped.` : ""}`); setCsv(""); router.refresh(); },
    });
  }

  function addSku() {
    post("/api/pricing", newSku, {
      onOk: () => { setMsg(`Saved ${newSku.sku_code}.`); setNewSku(EMPTY_SKU); setShowAdd(false); router.refresh(); },
    });
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  }

  function openRow(s) {
    if (selectedId === s.price_id) { setSelectedId(null); return; }
    setSelectedId(s.price_id);
    setWfResult(null);
    setWf({ fxTo: "", freightPct: "", discountTo: "", targetGpPct: s.target_gp_pct ? String((Number(s.target_gp_pct) * 100)) : "" });
  }

  async function runWhatIf() {
    if (!selected) return;
    setWfBusy(true); setError(null);
    try {
      const overrides = {};
      if (wf.fxTo !== "") overrides.fxTo = Number(wf.fxTo);
      if (wf.freightPct !== "") overrides.freightPct = Number(wf.freightPct) / 100; // ± % → fraction
      if (wf.discountTo !== "") overrides.discountTo = Number(wf.discountTo) / 100;  // % → fraction
      const body = { op: "whatif", overrides };
      if (wf.targetGpPct !== "") body.targetGpPct = Number(wf.targetGpPct) / 100;
      const res = await fetch(`/api/pricing/${selected.price_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "What-if failed");
      setWfResult(j); // { result:{build,margin}, target:{sellingExVat,rrpInclVat} }
    } catch (e) { setError(e.message); }
    finally { setWfBusy(false); }
  }

  function deleteSku(s) {
    if (!window.confirm(`Delete pricing for ${s.sku_code}? This removes its cost build and cannot be undone.`)) return;
    post(`/api/pricing/${s.price_id}`, { op: "delete" }, { onOk: () => { setSelectedId(null); router.refresh(); } });
  }

  const setNs = (k) => (e) => setNewSku((s) => ({ ...s, [k]: e.target.value }));
  const setWfK = (k) => (e) => setWf((s) => ({ ...s, [k]: e.target.value }));

  const d = dashboard || {};

  // SKUs carrying any alert, grouped by type in severity order.
  const alertGroups = useMemo(() => {
    return ALERT_ORDER.map((code) => ({ code, skus: skus.filter((s) => (s.alerts || []).includes(code)) })).filter((g) => g.skus.length);
  }, [skus]);

  return (
    <div>
      {/* ---- 1. KPI cards ---- */}
      {d.ready ? (
        <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 22 }}>
          <Kpi label="Avg GP %" value={pct(d.avgGpPct)} tone={d.avgGpPct != null && d.avgGpPct < 0 ? "red" : null} />
          <Kpi label="Avg Mark-up" value={mult(d.avgMarkup)} />
          <Kpi label="Cash Invested" value={money(d.cashInvested)} />
          <Kpi label="Margin Opportunity" value={money(d.marginOpportunity)} tone="amber" />
          <Kpi label="SKUs below target" value={d.skusBelowTarget ?? 0} tone={d.skusBelowTarget ? "red" : null} />
          <Kpi label="SKUs above target" value={d.skusAboveTarget ?? 0} tone={d.skusAboveTarget ? "green" : null} />
          <Kpi label="Air Freight Cost" value={money(d.airFreightCost)} tone={d.airFreightCost ? "amber" : null} />
          <Kpi label="Freight %" value={pct(d.avgFreightBurden)} />
          <Kpi label="FX Exposed" value={d.fxExposed ?? 0} tone={d.fxExposed ? "amber" : null} />
          <Kpi label="Negative Margin" value={d.negativeMargin ?? 0} tone={d.negativeMargin ? "red" : null} />
        </div>
      ) : (
        <div style={{ ...card, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>
          No priced SKUs yet. Upload a cost build or add a SKU to see the pricing dashboard.
        </div>
      )}

      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* ---- 2. Filters ---- */}
      <div style={{ ...card, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={field}><span style={labelSt}>Channel</span>
          <select style={inputSt} value={filters.channel || ""} onChange={(e) => navigate({ channel: e.target.value })}>
            <option value="">All channels</option>
            <option value="MINISO_MDS">Miniso MDS</option>
            <option value="LOCAL_PURCHASE">Local Purchase</option>
          </select>
        </label>
        <label style={field}><span style={labelSt}>Category</span>
          <select style={inputSt} value={filters.category || ""} onChange={(e) => navigate({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={field}><span style={labelSt}>Status</span>
          <select style={inputSt} value={filters.status || ""} onChange={(e) => navigate({ status: e.target.value })}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="DISCONTINUED">Discontinued</option>
          </select>
        </label>
        <label style={{ ...field, flex: 1, minWidth: 180 }}><span style={labelSt}>Search</span>
          <input style={inputSt} placeholder="SKU or description" defaultValue={filters.q || ""}
            onKeyDown={(e) => { if (e.key === "Enter") navigate({ q: e.currentTarget.value }); }} />
        </label>
        {(filters.channel || filters.category || filters.status || filters.q) && (
          <button style={ghost} onClick={() => router.push("/plan/pricing")}>Clear</button>
        )}
      </div>

      {/* ---- 3. Upload + Add SKU (canManage) ---- */}
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>Add pricing data</div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14 }}>Upload a cost-build CSV, or add a single SKU inline. Every valid row is upserted on SKU + channel.</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
            <div>
              <div style={{ ...labelSt, marginBottom: 6 }}>Cost-build CSV</div>
              <textarea rows={4} style={{ ...inputSt, width: "100%", fontFamily: "var(--mono)", fontSize: 12 }} placeholder="Paste CSV, or choose a file below" value={csv} onChange={(e) => setCsv(e.target.value)} />
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} style={{ fontSize: 12 }} />
                <button style={btn("var(--accent)")} disabled={busy} onClick={uploadCsv}>{busy ? "Working…" : "Upload cost build"}</button>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>
                Columns: SKU, Channel, Description, Category, RMB Cost, Discount, FX, Sea Freight, Air Freight, Duty, Insurance, Port Charges, Customs, Other Import, Goods In, Goods Out, Warehouse Storage, Warehouse Admin, Handling, Other Logistics, Wholesale Margin, Distributor Margin, Retail VAT, Actual Retail Price, Target GP.
              </div>
            </div>

            <div>
              <button style={ghost} onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Hide add-SKU form" : "Add SKU"}</button>
              {showAdd && (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <label style={field}><span style={labelSt}>SKU *</span><input style={inputSt} value={newSku.sku_code} onChange={setNs("sku_code")} /></label>
                  <label style={field}><span style={labelSt}>Channel *</span>
                    <select style={inputSt} value={newSku.channel_code} onChange={setNs("channel_code")}>
                      <option value="MINISO_MDS">Miniso MDS</option>
                      <option value="LOCAL_PURCHASE">Local Purchase</option>
                    </select>
                  </label>
                  <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Description</span><input style={inputSt} value={newSku.description} onChange={setNs("description")} /></label>
                  <label style={field}><span style={labelSt}>Category</span><input style={inputSt} value={newSku.category} onChange={setNs("category")} /></label>
                  <label style={field}><span style={labelSt}>RMB Cost</span><input type="number" step="0.01" style={inputSt} value={newSku.rmb_cost} onChange={setNs("rmb_cost")} /></label>
                  <label style={field}><span style={labelSt}>FX (RMB/GBP)</span><input type="number" step="0.0001" style={inputSt} value={newSku.fx_rate} onChange={setNs("fx_rate")} /></label>
                  <label style={field}><span style={labelSt}>Wholesale margin</span><input type="number" step="0.001" placeholder="e.g. 0.4" style={inputSt} value={newSku.wholesale_margin_pct} onChange={setNs("wholesale_margin_pct")} /></label>
                  <label style={field}><span style={labelSt}>Distributor margin</span><input type="number" step="0.001" placeholder="e.g. 0.15" style={inputSt} value={newSku.distributor_margin_pct} onChange={setNs("distributor_margin_pct")} /></label>
                  <label style={field}><span style={labelSt}>Retail VAT</span><input type="number" step="0.001" placeholder="e.g. 0.2" style={inputSt} value={newSku.retail_vat_pct} onChange={setNs("retail_vat_pct")} /></label>
                  <label style={field}><span style={labelSt}>Actual retail price</span><input type="number" step="0.01" style={inputSt} value={newSku.actual_retail_price} onChange={setNs("actual_retail_price")} /></label>
                  <label style={field}><span style={labelSt}>Target GP</span><input type="number" step="0.001" placeholder="e.g. 0.5" style={inputSt} value={newSku.target_gp_pct} onChange={setNs("target_gp_pct")} /></label>
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, marginTop: 4 }}>
                    <button style={btn("var(--accent)")} disabled={busy || !newSku.sku_code} onClick={addSku}>{busy ? "Working…" : "Save SKU"}</button>
                    <button style={ghost} onClick={() => { setShowAdd(false); setNewSku(EMPTY_SKU); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- 4. SKU grid ---- */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>SKU pricing <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {skus.length} shown</span></div>
        {!skus.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No SKUs match these filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
              <thead><tr>
                {["SKU", "Description", "Channel"].map((h) => <th key={h} style={th}>{h}</th>)}
                {["Landed", "Total Cost", "Wholesale", "RRP", "Current Sell", "Margin %", "Margin £"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
                {["Health", "Alerts"].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {skus.map((s) => {
                  const v = s.view || {};
                  const b = v.build || {}; const ch = v.chain || {}; const m = v.margin || {};
                  const on = selectedId === s.price_id;
                  return (
                    <tr key={s.price_id} onClick={() => openRow(s)} style={{ cursor: "pointer", background: on ? "var(--bg)" : "transparent" }}>
                      <td style={{ ...td, fontFamily: "var(--mono)", fontWeight: 600 }}>{s.sku_code}</td>
                      <td style={{ ...td, whiteSpace: "normal", maxWidth: 240 }}>{s.description || "—"}</td>
                      <td style={td}>{channelName(s.channel_code)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(b.landed)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(b.totalCost)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(ch.wholesale)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(ch.rrpInclVat)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(s.actual_retail_price)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", color: m.gpPct != null && m.gpPct < 0 ? "var(--red)" : "var(--ink)" }}>{pct(m.gpPct)}</td>
                      <td className="fos-num" style={{ ...td, textAlign: "right", color: m.gp != null && m.gp < 0 ? "var(--red)" : "var(--ink)" }}>{money(m.gp)}</td>
                      <td style={td}><HealthBadge health={v.health} /></td>
                      <td style={{ ...td, whiteSpace: "normal" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(s.alerts || []).slice().sort((a, b2) => ALERT_ORDER.indexOf(a) - ALERT_ORDER.indexOf(b2)).map((a) => <AlertChip key={a} code={a} />)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- 5. Detail panel ---- */}
      {selected && (
        <DetailPanel
          s={selected} wf={wf} setWfK={setWfK} runWhatIf={runWhatIf} wfBusy={wfBusy} wfResult={wfResult}
          canManage={canManage} onDelete={() => deleteSku(selected)} onClose={() => setSelectedId(null)}
        />
      )}

      {/* ---- 6. Alerts summary ---- */}
      {alertGroups.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>Pricing alerts</div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14 }}>SKUs carrying a pricing flag, grouped by issue — most severe first.</div>
          {alertGroups.map((g) => (
            <div key={g.code} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <AlertChip code={g.code} />
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{g.skus.length} SKU{g.skus.length === 1 ? "" : "s"}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {g.skus.map((s) => (
                  <button key={s.price_id} onClick={() => openRow(s)}
                    style={{ ...ghost, fontFamily: "var(--mono)", fontSize: 11.5, padding: "4px 9px" }}
                    title={s.description || s.sku_code}>
                    {s.sku_code}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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

// A labelled build/chain line: label left, value right.
function Line({ label, value, note, strong, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--hairline)" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{label}{note && <span style={{ fontSize: 10.5, color: "var(--faint)" }}> · {note}</span>}</span>
      <span className="fos-num" style={{ fontSize: 13.5, fontWeight: strong ? 700 : 500, color: tone ? TONE_FG[tone] : "var(--ink)", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function DetailPanel({ s, wf, setWfK, runWhatIf, wfBusy, wfResult, canManage, onDelete, onClose }) {
  const v = s.view || {};
  const b = v.build || {}; const ch = v.chain || {}; const m = v.margin || {};
  const health = v.health || {};
  const alerts = (s.alerts || []).slice().sort((a, b2) => ALERT_ORDER.indexOf(a) - ALERT_ORDER.indexOf(b2));

  return (
    <div style={{ ...card, borderColor: "color-mix(in srgb, var(--accent) 30%, var(--line))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 650 }}><span style={{ fontFamily: "var(--mono)" }}>{s.sku_code}</span> <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)" }}>· {channelName(s.channel_code)}</span></div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 2 }}>{s.description || "—"}{s.category ? ` · ${s.category}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <HealthBadge health={health} />
          <button style={ghost} onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
        {/* Cost build + price chain */}
        <div>
          <div style={{ ...labelSt, marginBottom: 6 }}>Cost build</div>
          <Line label="Net RMB" value={b.netRmb == null ? "—" : b.netRmb.toLocaleString("en-GB") + " RMB"} />
          <Line label="GBP FOB" value={money(b.gbpFob)} />
          <Line label="Total Freight" note="incl air freight" value={money(b.freight)} />
          <Line label="Landed" value={money(b.landed)} strong />
          <Line label="Distribution" value={money(b.distribution)} />
          <Line label="Total Cost" value={money(b.totalCost)} strong />

          <div style={{ ...labelSt, margin: "16px 0 6px" }}>Price chain</div>
          <Line label="Wholesale" value={money(ch.wholesale)} />
          <Line label="Distributor" value={money(ch.distributor)} />
          <Line label="Retail ex-VAT" value={money(ch.retailExVat)} />
          <Line label="RRP incl VAT" value={money(ch.rrpInclVat)} strong />
        </div>

        {/* Margin + freight + health */}
        <div>
          <div style={{ ...labelSt, marginBottom: 6 }}>Margin</div>
          <Line label="Current sell (ex-VAT)" value={money(m.sellingExVat)} />
          <Line label="Gross profit £" value={money(m.gp)} strong tone={m.gp != null && m.gp < 0 ? "red" : null} />
          <Line label="GP %" value={pct(m.gpPct)} tone={m.gpPct != null && m.gpPct < 0 ? "red" : null} />
          <Line label="Mark-up" value={mult(m.markup)} />
          <Line label="Freight burden" value={pct(v.freightBurden)} tone={v.freightBurden != null && v.freightBurden > 0.3 ? "amber" : null} />

          <div style={{ ...labelSt, margin: "16px 0 8px" }}>Health {health.score != null ? `· ${health.score}/100 ${health.band?.label || ""}` : "· n/a"}</div>
          {(health.factors || []).length ? (health.factors || []).map((fac) => (
            <div key={fac.key} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
                <span style={{ textTransform: "capitalize" }}>{fac.key} <span style={{ color: "var(--faint)" }}>· w{Math.round(fac.weight * 100)}%</span></span>
                <span className="fos-num">{Math.round(fac.score)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: "var(--raise, var(--bg))", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, fac.score))}%`, background: fac.score >= 65 ? "var(--green)" : fac.score >= 45 ? "var(--amber)" : "var(--red)" }} />
              </div>
            </div>
          )) : <div style={{ fontSize: 12, color: "var(--faint)" }}>Not enough data to score.</div>}
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
          <div style={{ ...labelSt, marginBottom: 8 }}>Alerts</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{alerts.map((a) => <AlertChip key={a} code={a} />)}</div>
        </div>
      )}

      {/* What-if */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
        <div style={{ ...labelSt, marginBottom: 8 }}>What-if</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, alignItems: "flex-end" }}>
          <label style={field}><span style={labelSt}>FX to (RMB/GBP)</span><input type="number" step="0.0001" style={inputSt} placeholder={s.fx_rate ?? ""} value={wf.fxTo} onChange={setWfK("fxTo")} /></label>
          <label style={field}><span style={labelSt}>Freight ± %</span><input type="number" step="1" style={inputSt} placeholder="e.g. 10 or -5" value={wf.freightPct} onChange={setWfK("freightPct")} /></label>
          <label style={field}><span style={labelSt}>Discount to %</span><input type="number" step="1" style={inputSt} placeholder="e.g. 12" value={wf.discountTo} onChange={setWfK("discountTo")} /></label>
          <label style={field}><span style={labelSt}>Target GP %</span><input type="number" step="1" style={inputSt} placeholder="e.g. 50" value={wf.targetGpPct} onChange={setWfK("targetGpPct")} /></label>
          <button style={btn("var(--accent)")} disabled={wfBusy} onClick={runWhatIf}>{wfBusy ? "Running…" : "Run"}</button>
        </div>
        {wfResult && (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ ...labelSt, marginBottom: 8 }}>Under scenario</div>
              <Line label="Total Cost" value={money(wfResult.result?.build?.totalCost)} strong />
              <Line label="GP %" value={pct(wfResult.result?.margin?.gpPct)} tone={wfResult.result?.margin?.gpPct != null && wfResult.result.margin.gpPct < 0 ? "red" : null} />
            </div>
            {wfResult.target && (
              <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ ...labelSt, marginBottom: 8 }}>Price for target GP</div>
                <Line label="Selling ex-VAT" value={money(wfResult.target.sellingExVat)} strong />
                <Line label="RRP incl VAT" value={money(wfResult.target.rrpInclVat)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete */}
      {canManage && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)", display: "flex", justifyContent: "flex-end" }}>
          <button style={{ ...ghost, color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, var(--line))" }} onClick={onDelete}>Delete SKU</button>
        </div>
      )}
    </div>
  );
}
