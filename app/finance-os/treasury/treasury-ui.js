"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money, pct, StatRow, Stat, Badge } from "../ui";
import { SALES_STREAMS, LC_STAGES, cashReconVariance, cashReconStatus } from "../../../lib/treasury-rules";

/*
 * Treasury desk. Six tabs: an overview, the seeded HSBC bank trade facility, the
 * bank term loan register, FX hedging, sales income streams and store cash
 * reconciliations. Finance manages every register except the trade facility, which
 * is a read-only seeded feed.
 */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)", width: "100%" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };
const tdR = { ...td, textAlign: "right" };
const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 650, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };

const TABS = [
  ["overview", "Overview"],
  ["facility", "Bank trade facility"],
  ["loans", "Bank term loan"],
  ["hedging", "Hedging"],
  ["sales", "Sales income"],
  ["recon", "Store cash rec."],
];
const LC_TONE = Object.fromEntries(LC_STAGES.map((s) => [s.code, s.tone]));
const mLabel = (m) => {
  if (!m) return "—";
  const s = typeof m === "string" ? m : (m instanceof Date ? m.toISOString() : String(m));
  const x = /^(\d{4})-(\d{2})/.exec(s);
  return x ? new Date(Date.UTC(+x[1], +x[2] - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—";
};
const dLabel = (d) => { if (!d) return "—"; const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const dash = (v) => (v == null || v === "" ? "—" : v);
// LC amounts are held in the order's own currency — render with the right symbol/code.
const CCY_SYM = { GBP: "£", USD: "$", EUR: "€", CNY: "¥", RMB: "¥", HKD: "HK$", JPY: "¥" };
const ccyMoney = (n, ccy) => {
  if (n == null || n === "") return "—";
  const code = String(ccy || "").toUpperCase();
  const sym = CCY_SYM[code];
  const v = Math.round(Number(n)).toLocaleString("en-GB");
  return sym ? `${sym}${v}` : `${v}${code ? ` ${code}` : ""}`;
};

export default function TreasuryUI({ data, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function op(body, ok) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await fetch("/api/treasury", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Action failed"); return null; }
      setMessage(ok); router.refresh(); return j;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }

  return (
    <div>
      {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: "var(--green)", fontSize: 12.5, marginBottom: 12 }}>{message}</div>}

      <div style={{ ...card, display: "flex", gap: 3, padding: 4, background: "var(--raise)", flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => {
          const on = k === tab;
          return (
            <button key={k} onClick={() => setTab(k)} style={{
              fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "6px 13px", borderRadius: 7, cursor: "pointer",
              background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
              color: on ? "var(--ink)" : "var(--muted)",
            }}>{l}</button>
          );
        })}
      </div>

      {tab === "overview" && <Overview data={data} />}
      {tab === "facility" && <Facility facility={data.facility} position={data.position} lifecycle={data.lifecycle} />}
      {tab === "loans" && <TermLoans loans={data.loans} canManage={canManage} busy={busy} op={op} />}
      {tab === "hedging" && <Hedging hedging={data.hedging} canManage={canManage} busy={busy} op={op} />}
      {tab === "sales" && <SalesIncome sales={data.sales} canManage={canManage} busy={busy} op={op} />}
      {tab === "recon" && <CashRecon recon={data.recon} canManage={canManage} busy={busy} op={op} />}
    </div>
  );
}

function Overview({ data }) {
  const f = data.facility.summary || {};
  const l = data.loans.summary || {};
  const h = data.hedging.summary || {};
  const s = data.sales.summary || {};
  const r = data.recon.summary || {};
  return (
    <div>
      <StatRow>
        <Stat label="Trade facility drawn" value={money(f.totalGbp || 0, { compact: true })} sub={`${f.drawings || 0} drawings`} />
        <Stat label="Term loan balance" value={money(l.balance || 0, { compact: true })} sub={l.count ? `${l.count} facilities · ${l.weightedRate}%` : "none recorded"} />
        <Stat label="Hedging net MtM" value={money(h.netMtmGbp || 0, { compact: true })} sub={`${h.openCount || 0} open`} tone={(h.netMtmGbp || 0) < 0 ? "red" : undefined} />
        <Stat label="Sales income invoiced" value={money(s.invoiced || 0, { compact: true })} sub={`${money(s.outstanding || 0, { compact: true })} outstanding`} />
        <Stat label="Cash rec. variance" value={money(r.variance || 0, { compact: true })} sub={`${r.exceptions || 0} exceptions`} tone={(r.exceptions || 0) > 0 ? "red" : undefined} />
      </StatRow>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>Trade facility settlement calendar</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14 }}>GBP cash-out from the HSBC facility, by settlement month.</div>
        {!f.byMonth?.length ? <div style={{ fontSize: 13, color: "var(--faint)" }}>No facility drawings loaded.</div> : (
          <MonthBars months={f.byMonth} />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
        <SplitCard title="By cost driver" rows={f.byCostDriver} />
        <SplitCard title="By product" rows={f.byProduct} />
      </div>
    </div>
  );
}

function MonthBars({ months }) {
  const max = Math.max(1, ...months.map((m) => m.gbp));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {months.map((m) => (
        <div key={m.month} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 64, fontSize: 12.5, color: "var(--muted)" }}>{mLabel(m.month)}</div>
          <div style={{ flex: 1, background: "var(--raise)", borderRadius: 6, height: 22, overflow: "hidden" }}>
            <div style={{ width: `${(m.gbp / max) * 100}%`, height: "100%", background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))", borderRadius: 6 }} />
          </div>
          <div className="fos-num" style={{ width: 110, textAlign: "right", fontSize: 12.5 }}>{money(m.gbp)}</div>
          <div style={{ width: 44, textAlign: "right", fontSize: 11, color: "var(--faint)" }}>{m.count}</div>
        </div>
      ))}
    </div>
  );
}

function SplitCard({ title, rows = [] }) {
  const total = rows.reduce((t, r) => t + r.gbp, 0) || 1;
  return (
    <div style={card}>
      <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 12 }}>{title}</div>
      {!rows.length ? <div style={{ fontSize: 13, color: "var(--faint)" }}>—</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ ...td, borderBottom: "1px solid var(--hairline)" }}>{r.key}</td>
                <td style={{ ...tdR, borderBottom: "1px solid var(--hairline)" }}>{money(r.gbp)}</td>
                <td style={{ ...tdR, borderBottom: "1px solid var(--hairline)", color: "var(--faint)", width: 54 }}>{Math.round((r.gbp / total) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Bank trade facility (read-only) ----
function Facility({ facility, position, lifecycle }) {
  const rows = facility.rows || [];
  const s = facility.summary || {};
  const [driver, setDriver] = useState("");
  const [product, setProduct] = useState("");
  const filtered = useMemo(() => rows.filter((r) => (!driver || r.cost_driver === driver) && (!product || r.product_type === product)), [rows, driver, product]);
  const drivers = [...new Set(rows.map((r) => r.cost_driver).filter(Boolean))];
  const products = [...new Set(rows.map((r) => r.product_type).filter(Boolean))];

  function download() {
    const head = ["Reference", "Beneficiary", "Currency", "Payment amount", "Facility GBP", "Product", "Cost driver", "Start", "Due", "Days", "Settlement month", "Status"];
    const esc = (v) => { const x = v == null ? "" : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const lines = [head.join(",")];
    for (const r of filtered) lines.push([r.reference, r.beneficiary, r.payment_currency, r.payment_amount, r.facility_payment_gbp, r.product_type, r.cost_driver, r.loan_start_date, r.due_date, r.loan_period_days, r.payment_month, r.status].map(esc).join(","));
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
    a.download = `bank-trade-facility-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div>
      <StatRow>
        <Stat label="Drawings" value={s.drawings || 0} />
        <Stat label="Facility drawn (GBP)" value={money(s.totalGbp || 0, { compact: true })} />
        <Stat label="Outstanding (GBP)" value={money(s.outstandingGbp || 0, { compact: true })} />
        <Stat label="Peak month" value={s.peakMonth ? mLabel(s.peakMonth.month) : "—"} sub={s.peakMonth ? money(s.peakMonth.gbp, { compact: true }) : ""} />
      </StatRow>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>Settlement calendar</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14 }}>When facility drawings fall due, GBP-equivalent.</div>
        <MonthBars months={s.byMonth || []} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
        <SplitCard title="By cost driver" rows={s.byCostDriver} />
        <SplitCard title="By product" rows={s.byProduct} />
        <SplitCard title="By currency" rows={s.byCurrency} />
      </div>

      <FacilityPosition position={position} />
      <FacilityLifecycle lifecycle={lifecycle} />

      <div style={card}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 650 }}>Drawings</span>
          <select style={{ ...inputSt, width: "auto" }} value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">All cost drivers</option>{drivers.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <select style={{ ...inputSt, width: "auto" }} value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All products</option>{products.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{filtered.length} row{filtered.length === 1 ? "" : "s"}</span>
            <button style={ghost} disabled={!filtered.length} onClick={download}>Download (CSV)</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 980 }}>
            <thead><tr>
              {["Reference", "Beneficiary", "Product", "Cost driver", "Ccy", "Payment", "Facility GBP", "Start", "Due", "Days", "Settle"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i >= 5 && i <= 6 ? "right" : "left" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.reference}</td>
                  <td style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{r.beneficiary}</td>
                  <td style={td}>{r.product_type === "Post-shipment buyer loan" ? <Badge tone="accent">Buyer loan</Badge> : <Badge tone="muted">TradePay</Badge>}</td>
                  <td style={td}>{r.cost_driver}</td>
                  <td style={td}>{r.payment_currency}</td>
                  <td style={tdR}>{money(r.payment_amount)}</td>
                  <td style={tdR}>{money(r.facility_payment_gbp)}</td>
                  <td style={td}>{dLabel(r.loan_start_date)}</td>
                  <td style={td}>{dLabel(r.due_date)}</td>
                  <td style={tdR}>{r.loan_period_days}</td>
                  <td style={td}>{mLabel(r.payment_month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// HSBC facility limit vs total GBP drawings — headroom & utilisation.
function FacilityPosition({ position }) {
  const p = position || {};
  const hasLimit = p.limit != null;
  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 650 }}>HSBC facility position</span>
        {p.over && <Badge tone="red">Over facility limit</Badge>}
        {!p.over && p.near && <Badge tone="amber">Near limit</Badge>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>Limit vs total GBP drawings</span>
      </div>
      <StatRow>
        <Stat label="Facility limit" value={hasLimit ? money(p.limit, { compact: true }) : "Not set"} sub={hasLimit ? "HSBC ceiling" : "Set it on Suppliers & Credit"} />
        <Stat label="Drawn" value={money(p.exposure || 0, { compact: true })} sub="GBP-equivalent drawings" />
        <Stat label="Headroom" value={hasLimit ? money(p.headroom, { compact: true }) : "—"} tone={p.over ? "red" : undefined} sub={p.over ? "over limit" : hasLimit ? "available" : ""} />
        <Stat label="Utilisation" value={p.utilisation != null ? pct(p.utilisation) : "—"} tone={p.over ? "red" : p.near ? "amber" : undefined} />
      </StatRow>
      {!hasLimit && (
        <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: -14 }}>
          No HSBC facility limit set yet — set it on <Link href="/operate/suppliers" style={{ color: "var(--accent)" }}>Suppliers &amp; Credit</Link> to see headroom.
        </div>
      )}
    </div>
  );
}

// DC → LC → post-shipment loan lifecycle (Miniso imports), read-only.
function FacilityLifecycle({ lifecycle }) {
  const lc = lifecycle || {};
  const lcRows = lc.rows || [];
  const sum = lc.summary || {};
  const byStage = sum.byStage || {};
  const openByCcy = sum.openByCcy || {};
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>DC → LC → Loan lifecycle</div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14 }}>Import LCs from Procurement, by pipeline stage — from DC logged through to settled.</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {LC_STAGES.map((st) => (
          <Badge key={st.code} tone={st.tone}>{st.label} · {byStage[st.code] || 0}</Badge>
        ))}
        <span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 2px" }} />
        <Badge tone="muted">{sum.openCount || 0} open</Badge>
        <Badge tone="green">{sum.settledCount || 0} settled</Badge>
        {Object.entries(openByCcy).map(([ccy, amt]) => (
          <span key={ccy} style={{ fontSize: 12, color: "var(--muted)" }}>{ccyMoney(amt, ccy)} {ccy} open</span>
        ))}
      </div>

      {!lcRows.length ? (
        <div style={{ fontSize: 13, color: "var(--faint)" }}>No LCs logged yet — log them on Procurement Summary → Manage LC.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1040 }}>
            <thead><tr>
              {["Reference", "Supplier", "Bank", "Ccy", "LC amount", "Stage", "Confirmed", "Goods arrived", "Drawn", "Settled"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 4 ? "right" : "left" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {lcRows.map((r) => (
                <tr key={r.lc_id}>
                  <td style={td}>
                    <div>{dash(r.lc_reference)}</div>
                    {r.dc_reference && <div style={{ fontSize: 11, color: "var(--faint)" }}>DC: {r.dc_reference}</div>}
                  </td>
                  <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{dash(r.supplier)}</td>
                  <td style={td}>{dash(r.lc_bank)}</td>
                  <td style={td}>{dash(r.currency)}</td>
                  <td style={tdR}>{ccyMoney(r.lc_amount, r.currency)}</td>
                  <td style={td}><Badge tone={LC_TONE[r.stage] || "muted"}>{r.stageLabel}</Badge></td>
                  <td style={td}>{dash(r.lc_confirmed_date)}</td>
                  <td style={td}>{dash(r.goods_arrived_date)}</td>
                  <td style={td}>{dash(r.actual_payment_date)}</td>
                  <td style={td}>{r.lc_settled_date ? r.lc_settled_date : (r.lc_settled_amount != null ? ccyMoney(r.lc_settled_amount, r.currency) : "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// A labelled field.
function Field({ label, children }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={labelSt}>{label}</span>{children}</label>;
}

// ---- Bank term loans ----
function TermLoans({ loans, canManage, busy, op }) {
  const rows = loans.rows || [];
  const s = loans.summary || {};
  const empty = { lender: "", reference: "", facility_type: "Term loan", currency: "GBP", principal_gbp: "", balance_gbp: "", interest_rate: "", rate_basis: "", drawdown_date: "", maturity_date: "", repayment: "Amortising", notes: "" };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() { const j = await op({ op: "save-loan", row: f }, "Term loan saved."); if (j) setF(empty); }
  return (
    <div>
      <StatRow>
        <Stat label="Facilities" value={s.count || 0} />
        <Stat label="Principal" value={money(s.principal || 0, { compact: true })} />
        <Stat label="Balance" value={money(s.balance || 0, { compact: true })} />
        <Stat label="Weighted rate" value={`${s.weightedRate || 0}%`} />
      </StatRow>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Bank term loans</div>
        {!rows.length ? <div style={{ fontSize: 13, color: "var(--faint)" }}>No term loans recorded yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
              <thead><tr>{["Lender", "Reference", "Type", "Principal", "Balance", "Rate", "Basis", "Maturity", canManage ? "" : null].filter((x) => x !== null).map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 3 && i <= 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.lender}</td><td style={td}>{r.reference || "—"}</td><td style={td}>{r.facility_type || "—"}</td>
                    <td style={tdR}>{money(r.principal_gbp)}</td><td style={tdR}>{money(r.balance_gbp)}</td>
                    <td style={tdR}>{r.interest_rate == null ? "—" : `${r.interest_rate}%`}</td><td style={td}>{r.rate_basis || "—"}</td>
                    <td style={td}>{dLabel(r.maturity_date)}</td>
                    {canManage && <td style={td}><button style={ghost} disabled={busy} onClick={() => { if (window.confirm("Remove this loan?")) op({ op: "delete-loan", id: r.id }, "Removed."); }}>Remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Add / update a term loan</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Field label="Lender"><input style={inputSt} value={f.lender} onChange={set("lender")} placeholder="e.g. HSBC" /></Field>
            <Field label="Reference"><input style={inputSt} value={f.reference} onChange={set("reference")} /></Field>
            <Field label="Type"><select style={inputSt} value={f.facility_type} onChange={set("facility_type")}>{["Term loan", "RCF", "Overdraft", "Other"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Principal (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.principal_gbp} onChange={set("principal_gbp")} /></Field>
            <Field label="Balance (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.balance_gbp} onChange={set("balance_gbp")} /></Field>
            <Field label="Interest rate (%)"><input type="number" step="0.01" style={{ ...inputSt, textAlign: "right" }} value={f.interest_rate} onChange={set("interest_rate")} /></Field>
            <Field label="Rate basis"><input style={inputSt} value={f.rate_basis} onChange={set("rate_basis")} placeholder="Fixed / SONIA + 2.5%" /></Field>
            <Field label="Drawdown"><input type="date" style={inputSt} value={f.drawdown_date} onChange={set("drawdown_date")} /></Field>
            <Field label="Maturity"><input type="date" style={inputSt} value={f.maturity_date} onChange={set("maturity_date")} /></Field>
            <Field label="Repayment"><select style={inputSt} value={f.repayment} onChange={set("repayment")}>{["Amortising", "Bullet", "Interest-only"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <div style={{ marginTop: 12 }}><button style={btn("var(--accent)")} disabled={busy || !f.lender.trim()} onClick={save}>{busy ? "Saving…" : "Save term loan"}</button></div>
        </div>
      )}
    </div>
  );
}

// ---- Hedging ----
function Hedging({ hedging, canManage, busy, op }) {
  const rows = hedging.rows || [];
  const s = hedging.summary || {};
  const empty = { instrument: "FX Forward", pair: "GBPUSD", notional: "", notional_ccy: "USD", rate: "", trade_date: "", value_date: "", counterparty: "HSBC", purpose: "", mtm_gbp: "", status: "OPEN", notes: "" };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() { const j = await op({ op: "save-hedge", row: f }, "Hedge saved."); if (j) setF(empty); }
  return (
    <div>
      <StatRow>
        <Stat label="Contracts" value={s.count || 0} sub={`${s.openCount || 0} open`} />
        <Stat label="Net MtM" value={money(s.netMtmGbp || 0, { compact: true })} tone={(s.netMtmGbp || 0) < 0 ? "red" : undefined} />
        <Stat label="Pairs hedged" value={(s.byPair || []).length} sub={(s.byPair || []).map((p) => p.pair).slice(0, 3).join(" · ")} />
      </StatRow>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>FX hedging contracts</div>
        {!rows.length ? <div style={{ fontSize: 13, color: "var(--faint)" }}>No hedging contracts recorded yet — Miniso HQ / LC exposure is largely USD.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
              <thead><tr>{["Instrument", "Pair", "Notional", "Rate", "Trade", "Value", "Counterparty", "MtM", "Status", canManage ? "" : null].filter((x) => x !== null).map((h, i) => <th key={i} style={{ ...th, textAlign: i === 2 || i === 7 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.instrument}</td><td style={td}>{r.pair || "—"}</td>
                    <td style={tdR}>{money(r.notional)} {r.notional_ccy}</td><td style={td}>{r.rate ?? "—"}</td>
                    <td style={td}>{dLabel(r.trade_date)}</td><td style={td}>{dLabel(r.value_date)}</td><td style={td}>{r.counterparty || "—"}</td>
                    <td style={{ ...tdR, color: (r.mtm_gbp || 0) < 0 ? "var(--red)" : "var(--ink)" }}>{r.mtm_gbp == null ? "—" : money(r.mtm_gbp)}</td>
                    <td style={td}><Badge tone={r.status === "OPEN" ? "accent" : "muted"}>{r.status}</Badge></td>
                    {canManage && <td style={td}><button style={ghost} disabled={busy} onClick={() => { if (window.confirm("Remove this contract?")) op({ op: "delete-hedge", id: r.id }, "Removed."); }}>Remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Add / update a hedging contract</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Field label="Instrument"><select style={inputSt} value={f.instrument} onChange={set("instrument")}>{["FX Forward", "FX Option", "Swap"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Pair"><input style={inputSt} value={f.pair} onChange={set("pair")} placeholder="GBPUSD" /></Field>
            <Field label="Notional"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.notional} onChange={set("notional")} /></Field>
            <Field label="Notional ccy"><input style={inputSt} value={f.notional_ccy} onChange={set("notional_ccy")} /></Field>
            <Field label="Rate"><input type="number" step="0.0001" style={{ ...inputSt, textAlign: "right" }} value={f.rate} onChange={set("rate")} /></Field>
            <Field label="Trade date"><input type="date" style={inputSt} value={f.trade_date} onChange={set("trade_date")} /></Field>
            <Field label="Value date"><input type="date" style={inputSt} value={f.value_date} onChange={set("value_date")} /></Field>
            <Field label="Counterparty"><input style={inputSt} value={f.counterparty} onChange={set("counterparty")} /></Field>
            <Field label="Purpose"><input style={inputSt} value={f.purpose} onChange={set("purpose")} placeholder="e.g. Miniso LC USD" /></Field>
            <Field label="MtM (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.mtm_gbp} onChange={set("mtm_gbp")} /></Field>
            <Field label="Status"><select style={inputSt} value={f.status} onChange={set("status")}>{["OPEN", "SETTLED", "CANCELLED"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <div style={{ marginTop: 12 }}><button style={btn("var(--accent)")} disabled={busy || !f.instrument} onClick={save}>{busy ? "Saving…" : "Save contract"}</button></div>
        </div>
      )}
    </div>
  );
}

// ---- Sales income ----
function SalesIncome({ sales, canManage, busy, op }) {
  const s = sales.summary || {};
  const empty = { stream: "RETAIL", period: "", amount_gbp: "", received_gbp: "", notes: "" };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() { const j = await op({ op: "save-sales", row: f }, "Sales income saved."); if (j) setF(empty); }
  return (
    <div>
      <StatRow>
        {(s.streams || SALES_STREAMS.map((x) => ({ ...x, invoiced: 0, received: 0 }))).map((st) => (
          <Stat key={st.code} label={st.label} value={money(st.invoiced || 0, { compact: true })} sub={`${money(st.received || 0, { compact: true })} received`} />
        ))}
        <Stat label="Outstanding" value={money(s.outstanding || 0, { compact: true })} tone={(s.outstanding || 0) > 0 ? "amber" : undefined} />
      </StatRow>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Sales income by month</div>
        {!s.byMonth?.length ? <div style={{ fontSize: 13, color: "var(--faint)" }}>No sales income recorded yet — add a month below.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
              <thead><tr><th style={th}>Month</th><th style={{ ...th, textAlign: "right" }}>Retail</th><th style={{ ...th, textAlign: "right" }}>Wholesale</th><th style={{ ...th, textAlign: "right" }}>Franchise</th><th style={{ ...th, textAlign: "right" }}>Total</th></tr></thead>
              <tbody>
                {s.byMonth.map((m) => (
                  <tr key={m.month}><td style={td}>{mLabel(m.month)}</td><td style={tdR}>{money(m.RETAIL)}</td><td style={tdR}>{money(m.WHOLESALE)}</td><td style={tdR}>{money(m.FRANCHISE)}</td><td style={{ ...tdR, fontWeight: 600 }}>{money(m.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Add / update a month</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Field label="Stream"><select style={inputSt} value={f.stream} onChange={set("stream")}>{SALES_STREAMS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
            <Field label="Month"><input type="month" style={inputSt} value={f.period} onChange={set("period")} /></Field>
            <Field label="Invoiced (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.amount_gbp} onChange={set("amount_gbp")} /></Field>
            <Field label="Received (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.received_gbp} onChange={set("received_gbp")} /></Field>
            <Field label="Notes"><input style={inputSt} value={f.notes} onChange={set("notes")} /></Field>
          </div>
          <div style={{ marginTop: 12 }}><button style={btn("var(--accent)")} disabled={busy || !f.period} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
        </div>
      )}
    </div>
  );
}

// ---- Store cash reconciliation ----
function CashRecon({ recon, canManage, busy, op }) {
  const rows = recon.rows || [];
  const s = recon.summary || {};
  const empty = { store_code: "", store_name: "", period: "", expected_cash: "", banked_cash: "", status: "OPEN", notes: "" };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() { const j = await op({ op: "save-recon", row: f }, "Reconciliation saved."); if (j) setF(empty); }
  return (
    <div>
      <StatRow>
        <Stat label="Lines" value={s.count || 0} />
        <Stat label="Expected cash" value={money(s.expected || 0, { compact: true })} />
        <Stat label="Banked" value={money(s.banked || 0, { compact: true })} />
        <Stat label="Variance" value={money(s.variance || 0, { compact: true })} tone={(s.variance || 0) < 0 ? "red" : undefined} />
        <Stat label="Exceptions" value={s.exceptions || 0} tone={(s.exceptions || 0) > 0 ? "red" : undefined} />
      </StatRow>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Store cash reconciliations</div>
        {!rows.length ? <div style={{ fontSize: 13, color: "var(--faint)" }}>No reconciliations recorded yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
              <thead><tr>{["Store", "Month", "Expected", "Banked", "Variance", "Status"].map((h, i) => <th key={h} style={{ ...th, textAlign: i >= 2 && i <= 4 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => {
                  const v = cashReconVariance(r); const st = cashReconStatus(r);
                  return (
                    <tr key={r.id}>
                      <td style={td}>{r.store_code}{r.store_name ? ` · ${r.store_name}` : ""}</td>
                      <td style={td}>{mLabel(r.period)}</td>
                      <td style={tdR}>{money(r.expected_cash)}</td>
                      <td style={tdR}>{money(r.banked_cash)}</td>
                      <td style={{ ...tdR, color: v < 0 ? "var(--red)" : v > 0 ? "var(--amber)" : "var(--ink)" }}>{money(v)}</td>
                      <td style={td}><Badge tone={st.tone}>{st.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Add / update a reconciliation</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Field label="Store code"><input style={inputSt} value={f.store_code} onChange={set("store_code")} placeholder="e.g. ST001" /></Field>
            <Field label="Store name"><input style={inputSt} value={f.store_name} onChange={set("store_name")} /></Field>
            <Field label="Month"><input type="month" style={inputSt} value={f.period} onChange={set("period")} /></Field>
            <Field label="Expected (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.expected_cash} onChange={set("expected_cash")} /></Field>
            <Field label="Banked (£)"><input type="number" style={{ ...inputSt, textAlign: "right" }} value={f.banked_cash} onChange={set("banked_cash")} /></Field>
            <Field label="Status"><select style={inputSt} value={f.status} onChange={set("status")}>{["OPEN", "RECONCILED", "EXCEPTION"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <div style={{ marginTop: 12 }}><button style={btn("var(--accent)")} disabled={busy || !f.store_code.trim() || !f.period} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
        </div>
      )}
    </div>
  );
}
