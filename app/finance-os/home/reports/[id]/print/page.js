import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../../../../lib/auth";
import { scopeForSession } from "../../../../../../lib/intelligence/permission";
import { resolveReport } from "../../../../../../lib/reporting/reports";
import { money } from "../../../../ui";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

function kpiVal(k) {
  if (k.unit === "%") return `${k.value}%`;
  if (k.unit === "count") return Number(k.value).toLocaleString("en-GB");
  return money(k.value);
}

// Print-optimised deck view. The app-wide @media print CSS (app/layout.js)
// hides chrome, forces black-on-white and breaks each .fos-print-tab to a page.
// Save as PDF from the browser dialog.
export default async function ReportPrint({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasRole(session, "ADMIN", "FINANCE", "EXEC")) redirect("/finance-os/home/reports");
  const { id } = await params;
  const scope = scopeForSession(session);
  const resolved = await resolveReport(id, scope);
  if (!resolved) return <div style={{ padding: 40 }}>Report not found.</div>;
  const { report, sections } = resolved;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>
      <PrintButton />

      {/* Cover */}
      <section className="fos-print-tab" style={{ minHeight: "60vh", display: "flex", flexDirection: "column", justifyContent: "center", borderTop: "4px solid var(--accent)", paddingTop: 24 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".14em", color: "var(--accent)", fontWeight: 700 }}>MINISO UK · FINANCE OS</div>
        <h1 style={{ fontSize: 34, fontWeight: 700, margin: "18px 0 8px" }}>{report.title}</h1>
        <div style={{ fontSize: 15, color: "var(--muted)" }}>
          {report.reporting_period}{report.data_through_date ? ` · data through ${String(report.data_through_date).slice(0, 10)}` : ""}
        </div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 30 }}>{report.confidentiality} — governed reporting deck · {report.version_label}</div>
      </section>

      {/* Section pages */}
      {sections.filter((s) => s.page_type !== "cover").map((s) => {
        const commentary = (s.components || []).filter((c) => c.component_type === "commentary" && c.ai_status === "APPROVED");
        return (
          <section key={s.section_inst_id} className="fos-print-tab" style={{ paddingTop: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 650, borderBottom: "2px solid var(--accent)", paddingBottom: 8, marginBottom: 16 }}>{s.title}</h2>
            {s.envelope && !s.envelope.ready && <div style={{ fontSize: 13, color: "var(--muted)" }}>{s.envelope.reason || "Awaiting data."}</div>}
            {!!s.envelope?.kpis?.length && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
                {s.envelope.kpis.map((k, i) => (
                  <div key={i}><div style={{ fontSize: 22, fontWeight: 650 }}>{kpiVal(k)}</div><div style={{ fontSize: 11, color: "var(--faint)" }}>{k.label}</div></div>
                ))}
              </div>
            )}
            {s.envelope?.table && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 18 }}>
                <thead><tr>{s.envelope.table.columns.map((c) => <th key={c.key} style={{ textAlign: c.align || "left", padding: "6px 8px", borderBottom: "1.5px solid #444", fontSize: 10.5, textTransform: "uppercase" }}>{c.label}</th>)}</tr></thead>
                <tbody>{s.envelope.table.rows.map((r, ri) => <tr key={ri}>{s.envelope.table.columns.map((c) => <td key={c.key} style={{ textAlign: c.align || "left", padding: "5px 8px", borderBottom: "1px solid #ddd" }}>{c.money ? money(r[c.key]) : String(r[c.key] ?? "—")}</td>)}</tr>)}</tbody>
              </table>
            )}
            {commentary.map((c) => (
              <div key={c.component_id} style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12 }}>{c.approved_text || c.draft_text}</div>
            ))}
            <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 20, borderTop: "1px solid #ddd", paddingTop: 6 }}>
              MINISO UK · FINANCE OS{s.envelope?.metadata?.sourceRoute ? ` · Source: ${s.envelope.metadata.sourceRoute}` : ""}{s.envelope?.metadata?.dataThrough ? ` · Data through ${String(s.envelope.metadata.dataThrough).slice(0, 10)}` : ""} · {report.confidentiality}
            </div>
          </section>
        );
      })}
    </div>
  );
}
