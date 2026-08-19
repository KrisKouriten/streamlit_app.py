import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../../lib/auth";
import { listTemplates } from "../../../../lib/reporting/templates";
import { listReports, getReportingHealth, getAttention } from "../../../../lib/reporting/reports";
import { getUserDepartmentById, getReportPermissionsForDepartment } from "../../../../lib/governance";
import { hasFullReportAccess, accessibleTemplateKeys, filterViewableReports } from "../../../../lib/reporting/report-access-rules";
import { confidentialStamp } from "../../../../lib/reporting/watermark";
import ScreenWatermark from "../../../screen-watermark";
import { PageHeader, Panel, Stat, StatRow, Table, Badge, EmptyState } from "../../ui";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  DRAFT: "muted", DATA_PENDING: "amber", COMMENTARY_PENDING: "amber", REVIEW_READY: "accent",
  IN_REVIEW: "accent", RETURNED: "red", APPROVAL_READY: "accent", APPROVED: "green",
  ISSUED: "green", SUPERSEDED: "muted", ARCHIVED: "muted", CANCELLED: "red",
};
const statusLabel = (s) => String(s || "").replace(/_/g, " ");

export default async function ReportingCentre({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const fullAccess = hasFullReportAccess(session.roles);
  const canCreate = hasRole(session, "ADMIN", "FINANCE");
  const me = session.email || session.name;

  // Report access (migration 064): full-access roles see all; other departments
  // see only the report templates they have been granted.
  const department = await getUserDepartmentById(session.id);
  const permissions = await getReportPermissionsForDepartment(department);
  const allowedKeys = accessibleTemplateKeys({ roles: session.roles, permissions }); // null = all
  const canView = fullAccess || (allowedKeys && allowedKeys.length > 0);
  const allow = (rows) => filterViewableReports(rows, { roles: session.roles, permissions });

  const sp = await searchParams;
  const templateFilter = sp?.template || null;

  const [{ ready, templates: allTemplates }, recentAll, mineAll, health, attention] = await Promise.all([
    listTemplates(),
    listReports({ limit: 40 }),
    listReports({ owner: me, limit: 40 }),
    fullAccess ? getReportingHealth() : Promise.resolve(null),
    fullAccess ? getAttention(12) : Promise.resolve([]),
  ]);
  const templates = fullAccess ? allTemplates : (allTemplates || []).filter((t) => allowedKeys.includes(t.template_key));
  const recent = allow(recentAll.reports || []).slice(0, 8);
  const mine = allow(mineAll.reports || []).slice(0, 8);

  if (!canView) {
    return <div style={{ padding: "1rem 0" }}><PageHeader crumb="Corporate Reporting Centre" title="Corporate Reporting Centre" /><EmptyState title="Access required">Ask an administrator for access to the reports your department needs.</EmptyState></div>;
  }

  // Drill-down: "View history" for one template. Shows every report of that
  // template (not just the latest few), each linking to the builder to edit,
  // cancel or reopen.
  if (ready && templateFilter) {
    // Non-full-access users may only drill into a template they have been granted.
    if (!fullAccess && !allowedKeys.includes(templateFilter)) {
      return <div style={{ padding: "1rem 0" }}><PageHeader crumb="Corporate Reporting Centre" title="Corporate Reporting Centre" /><EmptyState title="Access required">Your department does not have access to this report.</EmptyState></div>;
    }
    const tpl = templates.find((t) => t.template_key === templateFilter);
    const { reports } = await listReports({ templateKey: templateFilter, limit: 200 });
    return (
      <div style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Corporate Reporting Centre · History" title={tpl ? `${tpl.name} — history` : "Report history"} right={`${reports.length} report${reports.length === 1 ? "" : "s"}`} />
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Link href="/finance-os/home/reports" style={{ fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, textDecoration: "none", color: "var(--muted)", border: "1px solid var(--line)" }}>← All reporting</Link>
          {canCreate && tpl && (
            <Link href={`/finance-os/home/reports/new?template=${tpl.template_key}`} className="fos-btn" style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, textDecoration: "none", background: "var(--accent)", color: "var(--on-accent, #fff)", border: "1px solid var(--accent)" }}>Create report</Link>
          )}
        </div>
        <Panel title="All reports" note={tpl?.purpose || "every version of this report, newest first"}>
          {!reports.length ? (
            <div style={{ fontSize: 13, color: "var(--faint)", padding: "8px 0" }}>No reports of this type have been created yet.</div>
          ) : (
            <Table
              columns={[
                { label: "Report", render: (r) => <Link href={`/finance-os/home/reports/${r.report_id}`} style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 600 }}>{r.title}</Link> },
                { label: "Period", render: (r) => r.reporting_period || "—" },
                { label: "Version", render: (r) => r.version_label || "—" },
                { label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge> },
                { label: "Owner", render: (r) => r.owner || "—" },
                { label: "Updated", align: "right", render: (r) => new Date(r.updated_at).toLocaleDateString("en-GB") },
              ]}
              rows={reports}
            />
          )}
        </Panel>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Corporate Reporting Centre" title="Corporate Reporting Centre" />
        <EmptyState title="Reporting Centre not migrated yet">Run migration 045 to create the reporting schema and seed the five corporate templates.</EmptyState>
      </div>
    );
  }

  return (
    <div style={{ padding: "1rem 0" }}>
      <ScreenWatermark text={confidentialStamp(session, new Date())} />
      <PageHeader
        crumb="Corporate Reporting Centre"
        title="Corporate Reporting Centre"
        right="Create governed reporting decks from live Finance OS data, approved commentary and AI intelligence." />

      {/* Reporting health (finance/exec/admin operational view) */}
      {fullAccess && health && (
        <StatRow>
          <Stat label="Reports (total)" value={health.total ?? 0} />
          <Stat label="In progress" value={health.in_progress ?? 0} tone="amber" />
          <Stat label="Completed" value={health.completed ?? 0} tone="green" />
          <Stat label="Overdue" value={health.overdue ?? 0} tone={health.overdue ? "red" : "muted"} />
        </StatRow>
      )}

      {/* Template cards */}
      <Panel title="Report templates" note="one governed engine, five templates">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
          {templates.map((t) => (
            <div key={t.template_key} className="fos-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 650 }}>{t.name}</div>
                <Badge tone="muted">{t.frequency}</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, minHeight: 54 }}>{t.purpose}</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{t.section_count} sections · {t.audience}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {canCreate && (
                  <Link href={`/finance-os/home/reports/new?template=${t.template_key}`} className="fos-btn" style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, textDecoration: "none", background: "var(--accent)", color: "var(--on-accent, #fff)", border: "1px solid var(--accent)" }}>
                    Create report
                  </Link>
                )}
                <Link href={`/finance-os/home/reports?template=${t.template_key}`} style={{ fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, textDecoration: "none", color: "var(--muted)", border: "1px solid var(--line)" }}>
                  View history
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Reports requiring attention (finance/exec/admin) */}
      {fullAccess && (
      <Panel title="Reports requiring attention" note="missing data · unreviewed commentary · returned · overdue">
        {attention.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--faint)", padding: "8px 0" }}>Nothing needs attention.</div>
        ) : (
          <Table
            columns={[
              { label: "Report", render: (r) => <Link href={`/finance-os/home/reports/${r.report_id}`} style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 600 }}>{r.title}</Link> },
              { label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge> },
              { label: "Flags", render: (r) => [r.missing_data && "Missing data", r.unreviewed_commentary && "Commentary draft", r.overdue && "Overdue"].filter(Boolean).join(" · ") || "—" },
              { label: "Owner", render: (r) => r.owner || "—" },
            ]}
            rows={attention}
          />
        )}
      </Panel>
      )}

      {/* My drafts */}
      <Panel title="My drafts">
        {!mine.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)", padding: "8px 0" }}>You have no reports yet.</div>
        ) : (
          <Table
            columns={[
              { label: "Report", render: (r) => <Link href={`/finance-os/home/reports/${r.report_id}`} style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 600 }}>{r.title}</Link> },
              { label: "Period", render: (r) => r.reporting_period || "—" },
              { label: "Version", render: (r) => r.version_label || "—" },
              { label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge> },
            ]}
            rows={mine}
          />
        )}
      </Panel>

      {/* Recent reports */}
      <Panel title="Recent reports">
        {!recent.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)", padding: "8px 0" }}>No reports have been created yet.</div>
        ) : (
          <Table
            columns={[
              { label: "Report", render: (r) => <Link href={`/finance-os/home/reports/${r.report_id}`} style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 600 }}>{r.title}</Link> },
              { label: "Period", render: (r) => r.reporting_period || "—" },
              { label: "Owner", render: (r) => r.owner || "—" },
              { label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge> },
              { label: "Updated", align: "right", render: (r) => new Date(r.updated_at).toLocaleDateString("en-GB") },
            ]}
            rows={recent}
          />
        )}
      </Panel>
    </div>
  );
}
