import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getAllFormats, getMappingReport, SCOPE_KINDS } from "../../../lib/pl-format-store.js";
import { PageHeader } from "../../finance-os/ui";
import FormatsAdmin from "./formats-admin";

export const dynamic = "force-dynamic";

// GOVERN → P&L Formats. The board-pack layouts, owned by Finance: each scope's
// structure, which chart-of-accounts nominals map where, and — the control that
// matters — the nominals present in the data that no line claims yet.
export default async function PlFormatsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const { ready, formats } = await getAllFormats();

  // Mapping reports for the scopes that have both a spec and data.
  const reports = {};
  if (ready) {
    for (const f of formats) {
      if (f.spec.length) {
        try { reports[f.kind] = await getMappingReport(f.kind); } catch { reports[f.kind] = null; }
      }
    }
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Govern · Reporting" title="P&L Formats"
        right={ready ? `${formats.filter((f) => f.spec.length).length} layouts` : "Setup"} />
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, maxWidth: "72ch", lineHeight: 1.55 }}>
        The board-pack P&L layouts for Miniso UK — Store, Franchise, Head Office and Consolidated. Each line maps one or
        more chart-of-accounts nominals; subtotals and margins are derived. The engine renders whatever these layouts
        say, so Finance owns the structure here. Any nominal that appears in the data but isn&apos;t claimed by a line is
        flagged below as <strong>unmapped</strong> — assign it so nothing drops out of a subtotal.
        {canManage ? "" : " Editing requires ADMIN or FINANCE."}
      </p>

      {!ready ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          Run migration <span style={{ fontFamily: "var(--mono)" }}>022_pl_format.sql</span> and seed the formats.
        </div>
      ) : (
        <FormatsAdmin formats={formats} reports={reports} canManage={canManage} scopeKinds={SCOPE_KINDS} />
      )}
    </div>
  );
}
