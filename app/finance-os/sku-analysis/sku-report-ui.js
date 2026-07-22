"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/*
 * SKU Analysis Dashboard UI — Top 80 / Bottom 20 and Dormant tabs. Renders the
 * ingested workbook tables in the shape of the distributed decks: executive
 * KPIs, licence/brand split, per-store scorecards (colour-coded) and zero
 * sellers. Upload re-ingests each period's workbook.
 */

const gbp = (v) => { const n = Number(v); if (!isFinite(n)) return "—"; const a = Math.abs(n); const s = a >= 1e6 ? `£${(n / 1e6).toFixed(1)}m` : a >= 1e3 ? `£${(n / 1e3).toFixed(0)}k` : `£${Math.round(n).toLocaleString()}`; return s; };
const gbpFull = (v) => { const n = Number(v); return isFinite(n) ? `£${Math.round(n).toLocaleString()}` : "—"; };
const pct = (v) => { const n = Number(v); return isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—"; };
const num = (v) => { const n = Number(v); return isFinite(n) ? Math.round(n).toLocaleString() : (v ?? "—"); };

function classifyMetric(label, value) {
  const l = String(label).toLowerCase();
  if (typeof value === "number" && value <= 1 && /gm|margin|mix|%/.test(l)) return "pct";
  if (/sales|cost|cash|value|stock|price|retail|£/.test(l)) return "money";
  return "num";
}
const fmtMetric = (label, value) => { const t = classifyMetric(label, value); return t === "pct" ? pct(value) : t === "money" ? gbp(value) : num(value); };

export default function SkuReportUI({ tab, top80, canManage }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const go = (t) => { const sp = new URLSearchParams(params); sp.set("tab", t); router.replace(`${pathname}?${sp.toString()}`, { scroll: false }); };

  async function upload(file, action) {
    if (!file) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      // Parse the workbook in the browser and send only the extracted sheets —
      // the raw .xlsb can be several MB and would exceed the request-body limit.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
      const NEEDED = ["Executive Summary", "Top 80% Store", "Bottom 20% Store", "Licence Analysis", "Zero Sellers"];
      const sheets = {};
      for (const n of NEEDED) if (wb.Sheets[n]) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: null });
      if (!Object.keys(sheets).length) throw new Error(`No recognised sheets found. Expected: ${NEEDED.join(", ")}.`);
      const res = await fetch("/api/sku-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sheets }) });
      const text = await res.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { throw new Error(`Upload failed (HTTP ${res.status})`); }
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setMsg(`Loaded ${j.storeCount} stores, ${j.licenceCount} brands, ${j.zeroCount?.toLocaleString?.() ?? j.zeroCount} zero-sellers.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const tabBtn = (active) => ({ padding: "8px 14px", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "var(--ink)" : "var(--faint)", background: "none", border: "none", borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1, cursor: "pointer" });

  return (
    <div>
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)", marginBottom: 16, flexWrap: "wrap" }}>
        <button style={tabBtn(tab === "top80")} onClick={() => go("top80")}>Top 80 / Bottom 20</button>
        <button style={tabBtn(tab === "dormant")} onClick={() => go("dormant")}>Dormant Stock</button>
      </div>

      {msg && <div style={{ fontSize: 12.5, color: "var(--green)", marginBottom: 12 }}>{msg}</div>}
      {err && <div className="fos-card" style={{ borderColor: "var(--red)", color: "var(--red)", padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>{err}</div>}

      {tab === "top80" ? <Top80 data={top80} canManage={canManage} busy={busy} upload={upload} /> : <Dormant />}
    </div>
  );
}

function UploadBtn({ label, action, accept, upload, busy }) {
  return (
    <label className="fos-btn" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontSize: 13 }}>
      {busy ? "Uploading…" : label}
      <input type="file" accept={accept} disabled={busy} style={{ display: "none" }} onChange={(e) => upload(e.target.files?.[0], action)} />
    </label>
  );
}

function Top80({ data, canManage, busy, upload }) {
  if (!data.ready) return <Notice>Run migration <Mono>025</Mono>, then upload the Top 80 / Bottom 20 workbook.{canManage && <div style={{ marginTop: 12 }}><UploadBtn label="Upload Top 80 / Bottom 20 workbook" action="top80" accept=".xlsx,.xlsb,.xls" upload={upload} busy={busy} /></div>}</Notice>;
  if (!data.loaded) return <Notice>No Top 80 / Bottom 20 data loaded yet — upload the distributed workbook (.xlsb / .xlsx).{canManage && <div style={{ marginTop: 12 }}><UploadBtn label="Upload Top 80 / Bottom 20 workbook" action="top80" accept=".xlsx,.xlsb,.xls" upload={upload} busy={busy} /></div>}</Notice>;

  return (
    <div style={{ display: "grid", gap: 22 }}>
      {canManage && <div><UploadBtn label="Re-upload workbook" action="top80" accept=".xlsx,.xlsb,.xls" upload={upload} busy={busy} /></div>}

      {data.exec.length > 0 && (
        <section>
          <Eyebrow>Executive summary</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            {data.exec.map((m, i) => (
              <div key={i} className="fos-card" style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmtMetric(m.label, m.value)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.licence.length > 0 && (
        <Section title="Licence / brand split" caption="How each brand splits between winners and slow sellers.">
          <Table rows={data.licence} cols={[
            { k: "Licence", t: "text" }, { k: "Total SKUs", t: "num" }, { k: "Total Sales", t: "money" }, { k: "GM %", t: "pct" },
            { k: "Winner SKUs", t: "num" }, { k: "Winner Sales", t: "money" }, { k: "Winner Mix", t: "pct" }, { k: "Slow SKUs", t: "num" }, { k: "Slow Sales", t: "money" },
          ]} />
        </Section>
      )}

      {data.top80Store.length > 0 && (
        <Section title="Top 80% — store scorecard" caption="Ranked by winner sales · green ≥65% / amber 50–65% / red <50% winner coverage in stock.">
          <Table rows={data.top80Store} cols={[
            { k: "Store", t: "text" }, { k: "Total Sales", t: "money" }, { k: "Winner Sales", t: "money" }, { k: "Winner %", t: "pct" },
            { k: "Products Sold", t: "num" }, { k: "Winners in Stock %", t: "pct", tone: (v) => (v >= 0.65 ? "green" : v >= 0.5 ? "amber" : "red") },
            { k: "Winners Run Out", t: "num" }, { k: "Sales/Product", t: "money" }, { k: "Winner Stock Cost", t: "money" },
          ]} />
        </Section>
      )}

      {data.bottom20Store.length > 0 && (
        <Section title="Bottom 20% — store scorecard" caption="Ranked by slow stock as % of total · red = over half the stock is slow sellers.">
          <Table rows={data.bottom20Store} cols={[
            { k: "Store", t: "text" }, { k: "Total Sales", t: "money" }, { k: "Slow Sales", t: "money" }, { k: "Slow Products", t: "num" },
            { k: "Slow Stock Cost", t: "money" }, { k: "Slow Stock %", t: "pct", tone: (v) => (v > 0.5 ? "red" : v > 0.4 ? "amber" : "green") },
            { k: "Sales/Product", t: "money" }, { k: "Total Stock Cost", t: "money" },
          ]} />
        </Section>
      )}

      {data.zeroSellers.length > 0 && (
        <Section title="Zero sellers" caption={`Products in stock with no sales in the period${data.zeroCount ? ` — ${data.zeroCount.toLocaleString()} in total` : ""}. Top ${data.zeroSellers.length} by stock cost.`}>
          <Table rows={data.zeroSellers} cols={[
            { k: "SKU", t: "text" }, { k: "Description", t: "text" }, { k: "Category", t: "text" }, { k: "Retail", t: "money" },
            { k: "Stores Stocked", t: "num" }, { k: "SOH Units", t: "num" }, { k: "SOH Cost", t: "money" }, { k: "Warehouse Units", t: "num" },
          ]} />
        </Section>
      )}
    </div>
  );
}

function Dormant() {
  return <Notice>The Dormant Stock view awaits the computed dormant summary workbook (store scorecard with quadrants, category ranking and aging buckets). Once that&rsquo;s shared it&rsquo;ll render here, mirroring the dormant deck.</Notice>;
}

/* ---- primitives ---- */
const Eyebrow = ({ children }) => <div className="fos-eyebrow" style={{ margin: "0 0 10px" }}>{children}</div>;
const Mono = ({ children }) => <span style={{ fontFamily: "var(--mono)" }}>{children}</span>;
const Notice = ({ children }) => <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", maxWidth: "70ch", lineHeight: 1.6 }}>{children}</div>;
const Section = ({ title, caption, children }) => (
  <section>
    <Eyebrow>{title}</Eyebrow>
    {caption && <p style={{ fontSize: 12, color: "var(--faint)", margin: "-6px 0 10px", maxWidth: "80ch" }}>{caption}</p>}
    {children}
  </section>
);

function Table({ rows, cols }) {
  const toneColor = { green: "var(--green)", amber: "var(--amber, #b8860b)", red: "var(--red)" };
  const fmt = (v, t) => (t === "money" ? gbpFull(v) : t === "pct" ? pct(v) : t === "num" ? num(v) : (v ?? "—"));
  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "8px 10px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".05em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", position: r ? undefined : "sticky", left: r ? undefined : 0, background: "var(--surface)" });
  const td = (r, tone) => ({ textAlign: r ? "right" : "left", padding: "7px 10px", borderBottom: "1px solid var(--hairline)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: tone ? toneColor[tone] : undefined, fontWeight: tone ? 650 : 400, position: r ? undefined : "sticky", left: r ? undefined : 0, background: "var(--surface)", maxWidth: r ? undefined : 260, overflow: "hidden", textOverflow: "ellipsis" });
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", padding: 0 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640, width: "100%" }}>
        <thead><tr>{cols.map((c, i) => <th key={c.k} style={th(i > 0)}>{c.k}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{cols.map((c, ci) => { const tone = c.tone ? c.tone(Number(row[c.k])) : null; return <td key={c.k} style={td(ci > 0, tone)}>{fmt(row[c.k], c.t)}</td>; })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
