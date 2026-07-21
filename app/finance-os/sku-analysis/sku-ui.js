"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, pct, num, Badge, Bar, IllustrativeBanner } from "../ui";

/* SKU analysis — three tabs: 80/20 sellers, new-SKU performance, dormant SKUs. */

const TABS = [["pareto", "80 / 20 sellers"], ["new", "New SKU performance"], ["dormant", "Dormant SKUs"]];
const CSV_TEMPLATE = "SKU,Description,Category,Launch Month,Last Sold Month,Units TTM,Revenue TTM,Margin %,Stock Value\nSKU-1001,Aroma Diffuser,Home,2024-03,2026-06,41200,618000,58,42000\n";

async function post(body) {
  const res = await fetch("/api/sku", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

export default function SkuUI({ data, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("pareto");

  if (!data.ready) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 6 }}>One migration to run</div>
      This dashboard needs migration <span style={{ fontFamily: "var(--mono)" }}>017_sku_analysis.sql</span> (idempotent). Run it, refresh, then upload SKU data.
    </div>;
  }
  if (!data.loaded) {
    return <div><div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)", marginBottom: 14 }}>No SKU data loaded yet — upload a per-SKU extract and the three analyses appear here.</div>{canManage && <Upload onDone={() => router.refresh()} />}</div>;
  }

  const p = data.pareto;

  return (
    <>
      {data.illustrative && <IllustrativeBanner>These SKUs are illustrative — upload a per-SKU sales & stock extract (TTM revenue/units, launch & last-sold month) and the real analysis replaces them.</IllustrativeBanner>}

      <div style={{ display: "inline-flex", gap: 3, marginBottom: 20, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize: 12.5, fontWeight: tab === key ? 600 : 500, padding: "6px 14px", borderRadius: 7, border: `1px solid ${tab === key ? "var(--line-strong)" : "transparent"}`,
            background: tab === key ? "var(--surface)" : "transparent", boxShadow: tab === key ? "var(--shadow-1)" : "none", color: tab === key ? "var(--ink)" : "var(--muted)",
          }}>{label}</button>
        ))}
      </div>

      {tab === "pareto" && (
        <>
          <TileRow tiles={[
            ["Class A SKUs", num(p.aCount), `drive ${pct(p.aRevPct, 0)} of revenue`, "var(--green)"],
            ["The long tail", num(p.tailCount), "B + C — the other ~20%", "var(--amber)"],
            ["TTM revenue", money(p.total, { compact: true }), "all selling SKUs"],
          ]} />
          <Table head={["#", "SKU", "Category", "Revenue TTM", "Share", "Cumulative", "Class"]} align={[1, 0, 0, 1, 1, 1, 0]}>
            {p.ranked.map((r) => (
              <tr key={r.sku}>
                <Td r mono>{r.rank}</Td>
                <Td><b style={{ fontWeight: 560 }}>{r.description || r.sku}</b><span style={{ color: "var(--faint)", marginLeft: 7, fontFamily: "var(--mono)", fontSize: 11 }}>{r.sku}</span></Td>
                <Td>{r.category || "—"}</Td>
                <Td r>{money(r.revenue_ttm)}</Td>
                <Td r>{pct(r.sharePct, 1)}</Td>
                <Td r><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Bar value={r.cumPct} max={1} tone={r.cls === "A" ? "green" : "amber"} width={60} />{pct(r.cumPct, 0)}</span></Td>
                <Td><Badge tone={r.cls === "A" ? "green" : r.cls === "B" ? "amber" : "muted"}>{r.cls}</Badge></Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {tab === "new" && (
        data.newSkus.length === 0 ? <Empty>No SKUs launched in the last 6 months.</Empty> : (
          <>
            <TileRow tiles={[
              ["New SKUs", num(data.newSkus.length), "launched ≤ 6 months"],
              ["Revenue TTM", money(data.newSkus.reduce((s, r) => s + r.revenue_ttm, 0), { compact: true }), "since launch"],
            ]} />
            <Table head={["SKU", "Category", "Months live", "Units TTM", "Revenue TTM", "Stock value"]} align={[0, 0, 1, 1, 1, 1]}>
              {data.newSkus.map((r) => (
                <tr key={r.sku}>
                  <Td><b style={{ fontWeight: 560 }}>{r.description || r.sku}</b><span style={{ color: "var(--faint)", marginLeft: 7, fontFamily: "var(--mono)", fontSize: 11 }}>{r.sku}</span></Td>
                  <Td>{r.category || "—"}</Td>
                  <Td r>{r.months_live}</Td>
                  <Td r>{num(r.units_ttm)}</Td>
                  <Td r>{money(r.revenue_ttm)}</Td>
                  <Td r>{money(r.stock_value)}</Td>
                </tr>
              ))}
            </Table>
          </>
        )
      )}

      {tab === "dormant" && (
        data.dormant.length === 0 ? <Empty>No dormant SKUs — everything has sold recently.</Empty> : (
          <>
            <TileRow tiles={[
              ["Dormant SKUs", num(data.dormant.length), "no sale in ≥ 6 months", "var(--amber)"],
              ["Stock at risk", money(data.dormant.reduce((s, r) => s + r.stock_value, 0), { compact: true }), "tied up in dormant lines", "var(--red)"],
            ]} />
            <Table head={["SKU", "Category", "Last sold", "Months since", "Revenue TTM", "Stock value"]} align={[0, 0, 0, 1, 1, 1]}>
              {data.dormant.map((r) => (
                <tr key={r.sku}>
                  <Td><b style={{ fontWeight: 560 }}>{r.description || r.sku}</b><span style={{ color: "var(--faint)", marginLeft: 7, fontFamily: "var(--mono)", fontSize: 11 }}>{r.sku}</span></Td>
                  <Td>{r.category || "—"}</Td>
                  <Td>{r.last_sold_ym || "never"}</Td>
                  <Td r>{r.months_since == null ? "—" : r.months_since}</Td>
                  <Td r>{money(r.revenue_ttm)}</Td>
                  <Td r tone="var(--red)">{money(r.stock_value)}</Td>
                </tr>
              ))}
            </Table>
          </>
        )
      )}

      <div style={{ marginTop: 18 }}>{canManage && <Upload onDone={() => router.refresh()} />}</div>
    </>
  );
}

function TileRow({ tiles }) {
  return (
    <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 22 }}>
      {tiles.map(([label, value, sub, tone]) => (
        <div key={label} className="fos-card" style={{ padding: "15px 17px 14px" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
          <div className="fos-num" style={{ fontSize: 26, fontWeight: 650, lineHeight: 1, color: tone || "var(--ink)" }}>{value}</div>
          {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}
function Table({ head, align, children }) {
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 640 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: align[i] ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, r, mono, tone }) {
  return <td className={r ? "fos-num" : undefined} style={{ textAlign: r ? "right" : "left", padding: "9px 14px", borderBottom: "1px solid var(--hairline)", color: tone || "var(--ink)", whiteSpace: "nowrap", fontFamily: mono ? "var(--mono)" : undefined }}>{children}</td>;
}
function Empty({ children }) { return <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13, color: "var(--faint)" }}>{children}</div>; }

function Upload({ onDone }) {
  const fileRef = useRef(null);
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setState("Loading…");
    try { const csv = await f.text(); const r = await post({ action: "upload", csv }); setState(`Loaded ${r.loaded} SKUs${r.errors?.length ? ` · ${r.errors.length} skipped` : ""}.`); onDone(); }
    catch (x) { setState(x.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
      <button className="fos-btn-ghost" onClick={() => fileRef.current?.click()}>Upload SKU data (CSV)</button>
      <a className="fos-btn-ghost" style={{ textDecoration: "none" }} href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="sku-template.csv">Template</a>
      <span>SKU · Description · Category · Launch · Last Sold · Units TTM · Revenue TTM · Margin % · Stock Value.</span>
      {state && <span style={{ color: "var(--muted)" }}>{state}</span>}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
    </div>
  );
}
