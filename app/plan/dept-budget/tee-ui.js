"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STAGE_LABEL } from "../../../lib/dept-budget-rules";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 16 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const ghost = { fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" };
const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString("en-GB")}`;
const TONE = { DRAFT: "var(--muted)", FINANCE_REVIEW: "var(--amber)", DEPT_APPROVAL: "var(--amber)", SLT_APPROVAL: "var(--amber)", LOCKED: "var(--green)" };

/*
 * Travel, Expenses & Entertainment — each department's budget for the year,
 * and how it is loaded: download the template (for the department, or per
 * employee), fill it in, upload it. The upload fills the department's draft;
 * the draft is then submitted and approved below like any other budget. Once
 * submitted, an upload leaves it alone — it has to be returned to draft, and
 * approved again, to change.
 */
export default function TeeBudgets({ year, years = [], rows = [], canUpload = false }) {
  const router = useRouter();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const tpl = (department, level) => `/api/plan/dept-budget/tee?year=${year}&department=${encodeURIComponent(department)}&level=${level}`;

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setMsg(`Reading ${f.name}…`);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const res = await fetch("/api/plan/dept-budget/tee", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: btoa(bin), filename: f.name }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || "Upload failed");
      const what = (b) => `${b.department} ${b.year} (${gbp(b.total)}${b.level === "EMPLOYEE" ? `, ${b.employees} employee${b.employees === 1 ? "" : "s"}` : ""})`;
      setMsg([
        r.created?.length ? `Created ${r.created.map(what).join(", ")}.` : "",
        r.updated?.length ? `Updated ${r.updated.map(what).join(", ")}.` : "",
        r.locked?.length ? `Not changed — ${r.locked.map((b) => `${b.department} ${b.year} is ${b.reason}`).join("; ")}.` : "",
        r.notYours?.length ? `Left out — not your department: ${r.notYours.join(", ")}.` : "",
        r.unknown?.length ? `Departments not recognised: ${r.unknown.join(", ")}.` : "",
        r.rowErrors?.length ? `${r.rowErrors.length} row${r.rowErrors.length === 1 ? "" : "s"} skipped — e.g. ${r.rowErrors[0]}` : "",
      ].filter(Boolean).join(" ") || "Nothing to load.");
      router.refresh();
    } catch (x) { setMsg(x.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 760 }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>Travel, Expenses &amp; Entertainment budgets · {year}</div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4, lineHeight: 1.55 }}>
            Download your department&rsquo;s template — for the department as a whole, or <strong>per employee</strong> to budget each reportee — fill in each line by month (net of VAT) and upload it.
            It fills the department&rsquo;s <strong>draft</strong>; open it below to review and submit for approval. Once submitted it can&rsquo;t be replaced by an upload — return it to draft first, and it will need approving again.
            Claims are read against the approved figures on Expense Claims.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {years.length > 1 && (
            <select defaultValue={String(year)} onChange={(e) => router.push(`?view=tee&year=${e.target.value}`)}
              style={{ height: 32, fontSize: 12.5, padding: "0 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {canUpload && (
            <label className="fos-btn" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Loading…" : "Upload budget"}
              <input ref={input} type="file" accept=".csv,.xlsx,.xls" disabled={busy} onChange={onFile} style={{ display: "none" }} />
            </label>
          )}
        </div>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>{msg}</div>}

      {!rows.length ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 12 }}>
          No department to show. T&amp;E budgets are loaded by each department&rsquo;s head and by Finance — ask Finance to add you as your department&rsquo;s sign-off approver.
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>
              {["Department", "Budget", "Set", "Status", "Template", ""].map((h, i) => (
                <th key={i} style={{ ...labelSt, textAlign: i === 1 ? "right" : "left", padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.department}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", fontWeight: 600 }}>{r.department}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.budgetId ? gbp(r.total) : <span style={{ color: "var(--faint)" }}>—</span>}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", color: "var(--muted)" }}>
                    {!r.budgetId ? "—" : r.level === "EMPLOYEE" ? `Per employee · ${r.employees}` : "Department"}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>
                    {r.budgetId ? <span style={{ color: TONE[r.status] || "var(--muted)", fontWeight: 600 }}>{STAGE_LABEL[r.status] || r.status}</span> : <span style={{ color: "var(--faint)" }}>Not set</span>}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>
                    {canUpload && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <a href={tpl(r.department, "DEPARTMENT")} style={ghost}>Department</a>
                        <a href={tpl(r.department, "EMPLOYEE")} style={ghost} title="One row per employee who claimed this year, and anyone already budgeted — add rows for anyone else">Per employee</a>
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right" }}>
                    {r.budgetId && <a href={`?view=tee&year=${year}&open=${r.budgetId}`} style={{ ...ghost, color: "var(--accent)" }}>Open</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
