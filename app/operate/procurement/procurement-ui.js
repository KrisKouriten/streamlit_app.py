"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, pct, Badge, IllustrativeBanner } from "../../finance-os/ui";

/* Procurement UI: two sections (Miniso / Local). Each shows the monthly cash
   budget vs committed spend (bucketed by supplier payment terms) and the
   supplier list with terms. CSV upload + inline monthly budget entry. */

const SECTIONS = [["MINISO", "Miniso purchases"], ["LOCAL", "Local purchases"]];
const CSV_TEMPLATE = "Source,Supplier,Category,Order Month,Amount,Terms (days),Status,Reference\nMiniso,MINISO HQ,Core range,2026-07,420000,60,Committed,PO-1\nLocal,Design360,Fixtures,2026-07,42000,30,Committed,PO-2\n";
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };

async function post(body) {
  const res = await fetch("/api/procurement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

export default function ProcurementUI({ data, ready, loaded, illustrative, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("MINISO");
  const [err, setErr] = useState("");

  if (!ready) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 6 }}>One migration to run</div>
      This module needs migration <span style={{ fontFamily: "var(--mono)" }}>016_procurement.sql</span> (idempotent). Run it, refresh, then upload purchases.
    </div>;
  }

  const s = data[tab];

  async function saveBudget(ym, value) {
    setErr("");
    try { await post({ action: "budget", source: tab, ym, budget: Number(value) }); router.refresh(); }
    catch (x) { setErr(x.message); }
  }

  return (
    <>
      {illustrative && <IllustrativeBanner>These purchases are illustrative — upload the merch team's PO/purchase extract (with supplier payment terms) and the real cash-budget control replaces them.</IllustrativeBanner>}

      <div style={{ display: "inline-flex", gap: 3, marginBottom: 20, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
        {SECTIONS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize: 12.5, fontWeight: tab === key ? 600 : 500, padding: "6px 14px", borderRadius: 7, border: `1px solid ${tab === key ? "var(--line-strong)" : "transparent"}`,
            background: tab === key ? "var(--surface)" : "transparent", boxShadow: tab === key ? "var(--shadow-1)" : "none", color: tab === key ? "var(--ink)" : "var(--muted)",
          }}>{label}</button>
        ))}
      </div>

      {err && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{err}</div>}

      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 24 }}>
        <Tile label="Committed spend" value={money(s.totalCommitted, { compact: true })} sub="all months" />
        <Tile label="Cash budget" value={money(s.totalBudget, { compact: true })} sub="sum of monthly budgets" />
        <Tile label="Over-budget months" value={s.months.filter((m) => m.overBudget).length} tone={s.months.some((m) => m.overBudget) ? "var(--red)" : "var(--green)"} sub="cash-out basis" />
        <Tile label="Suppliers" value={s.suppliers.length} sub="with orders" />
      </div>

      <Panel title="Monthly cash budget vs committed" note="committed spend lands in the month it falls due (order month-end + supplier terms)">
        {s.months.length === 0 ? <Empty>No purchases or budgets for this section yet.</Empty> : (
          <Table head={["Cash-out month", "Committed", "Budget", "Variance", "", "Status"]} align={[0, 1, 1, 1, 1, 0]}>
            {s.months.map((m) => (
              <tr key={m.ym}>
                <Td>{monthLabel(m.ym)}</Td>
                <Td r>{money(m.committed)}</Td>
                <Td r>{canManage ? (
                  <input defaultValue={m.budget ?? ""} placeholder="—" onBlur={(e) => { if (e.target.value !== String(m.budget ?? "")) saveBudget(m.ym, e.target.value || 0); }}
                    style={{ width: 100, textAlign: "right", height: 26, fontSize: 12.5, padding: "0 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" }} className="fos-num" />
                ) : (m.budget == null ? "—" : money(m.budget))}</Td>
                <Td r tone={m.variance == null ? undefined : m.variance < 0 ? "var(--red)" : "var(--green)"}>{m.variance == null ? "—" : money(m.variance)}</Td>
                <Td r>{m.budget ? <Bar value={m.committed} max={m.budget} over={m.overBudget} /> : null}</Td>
                <Td>{m.budget == null ? <span style={{ color: "var(--faint)" }}>no budget</span> : <Badge tone={m.overBudget ? "red" : "green"}>{m.overBudget ? "Over" : "Within"}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Suppliers" note="payment terms drive the cash-out month">
        {s.suppliers.length === 0 ? <Empty>No suppliers yet.</Empty> : (
          <Table head={["Supplier", "Orders", "Terms", "Committed"]} align={[0, 1, 1, 1]}>
            {s.suppliers.map((sup) => (
              <tr key={sup.supplier}>
                <Td>{sup.supplier}</Td>
                <Td r>{sup.orders}</Td>
                <Td r>{sup.terms_days} days</Td>
                <Td r>{money(sup.committed)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {canManage && <Upload onDone={() => router.refresh()} />}
    </>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 26, fontWeight: 650, lineHeight: 1, color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}
function Panel({ title, note, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: 14.5, fontWeight: 650 }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {note}</span>}
      </div>
      {children}
    </section>
  );
}
function Table({ head, align, children }) {
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 560 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: align[i] ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, r, tone }) {
  return <td className={r ? "fos-num" : undefined} style={{ textAlign: r ? "right" : "left", padding: "9px 14px", borderBottom: "1px solid var(--hairline)", color: tone || "var(--ink)", whiteSpace: "nowrap" }}>{children}</td>;
}
function Bar({ value, max, over }) {
  const w = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <span style={{ display: "inline-block", width: 80, height: 7, background: "var(--raise)", borderRadius: 4, overflow: "hidden", verticalAlign: "middle" }}>
    <span style={{ display: "block", width: `${w}%`, height: "100%", borderRadius: 4, background: over ? "var(--red)" : "linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))" }} />
  </span>;
}
function Empty({ children }) { return <div className="fos-card" style={{ padding: "14px 18px", fontSize: 13, color: "var(--faint)" }}>{children}</div>; }

function Upload({ onDone }) {
  const fileRef = useRef(null);
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setState("Loading…");
    try { const csv = await f.text(); const r = await post({ action: "upload", csv }); setState(`Loaded ${r.loaded} purchases${r.errors?.length ? ` · ${r.errors.length} skipped` : ""}.`); onDone(); }
    catch (x) { setState(x.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
      <button className="fos-btn-ghost" onClick={() => fileRef.current?.click()}>Upload purchases (CSV)</button>
      <a className="fos-btn-ghost" style={{ textDecoration: "none" }} href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="procurement-template.csv">Template</a>
      <span>Source · Supplier · Category · Order Month · Amount · Terms (days) · Status · Reference.</span>
      {state && <span style={{ color: "var(--muted)" }}>{state}</span>}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
    </div>
  );
}
