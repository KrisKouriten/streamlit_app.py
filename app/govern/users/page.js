import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, isAdmin } from "../../../lib/auth";
import { listUsersWithRoles, listDepartments, listSignoffs, listNavVisibility, getPoSelfApproveLimit, listDeptPoPolicies, listReportPermissions } from "../../../lib/governance";
import { listTemplates } from "../../../lib/reporting/templates";
import UsersAdmin from "./users-admin";
import DepartmentSignoff from "./signoff";
import AccessMatrix from "./access";
import SelfApproveLimit from "./self-approve";
import PoPolicySettings from "./po-policy";
import ReportAccessMatrix from "./report-access";

export const dynamic = "force-dynamic";

export default async function GovernUsers() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdmin(session)) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.25rem" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Admin access required</div>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>
          Users, Roles &amp; Permissions is limited to administrators. If your role has changed recently, sign out and back in.
        </p>
        <p style={{ marginTop: 12 }}><Link href="/govern" style={{ fontSize: 13.5 }}>Back to Govern</Link></p>
      </div>
    );
  }

  const [users, departments, signoffs, visibility, selfApproveLimit, poPolicies, reportPerms, tpl] = await Promise.all([
    listUsersWithRoles(),
    listDepartments(),
    listSignoffs(),
    listNavVisibility(),
    getPoSelfApproveLimit().catch(() => 0),
    listDeptPoPolicies().catch(() => []),
    listReportPermissions().catch(() => []),
    listTemplates().catch(() => ({ templates: [] })),
  ]);
  const deptNames = departments.map((d) => d.department_name);
  const reportTemplates = (Array.isArray(tpl) ? tpl : tpl.templates || []).map((t) => ({ template_key: t.template_key, name: t.name }));

  const heading = { fontSize: 16, fontWeight: 650, margin: "0 0 4px" };
  const sub = { fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px", lineHeight: 1.5 };

  return (
    <div className="fos-shell">
      <header style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/govern" style={{ textDecoration: "none", color: "var(--faint)" }}>Govern</Link> · Users, Roles &amp; Permissions
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Users, Roles &amp; Permissions</div>
      </header>

      <section style={{ marginBottom: 34 }}>
        <h2 style={heading}>Users &amp; roles</h2>
        <p style={sub}>The people who can sign in, their role, and the department they belong to.</p>
        <UsersAdmin me={{ id: session.id }} />
      </section>

      <section style={{ marginBottom: 34 }}>
        <h2 style={heading}>Department sign-off</h2>
        <p style={sub}>Who signs off each department&rsquo;s budgets and purchase orders. A department can have more than one approver.</p>
        <DepartmentSignoff departments={deptNames} signoffs={signoffs} users={users.map((u) => ({ name: u.name, email: u.email, department: u.department }))} />
      </section>

      <section style={{ marginBottom: 34 }}>
        <h2 style={heading}>Purchase-order self-approval</h2>
        <p style={sub}>A P.O whose net value is at or below this limit is signed off automatically by whoever raises it, so department-heads aren&rsquo;t asked to approve every small P.O. Anything above the limit still goes for department-head sign-off. Set £0 to switch it off. This is the fallback for departments without their own policy below.</p>
        <SelfApproveLimit initialLimit={selfApproveLimit} />
      </section>

      <section style={{ marginBottom: 34 }}>
        <h2 style={heading}>Department PO Approval Settings</h2>
        <p style={sub}>Per-department self-approval limits. Set a count of self-approved P.Os per period, an individual-P.O value cap and a cumulative value cap. Once the first of those is reached, the next P.O routes to the line manager (or department) for sign-off. Departments without a policy use the org-wide limit above.</p>
        <PoPolicySettings departments={deptNames} initialPolicies={poPolicies} />
      </section>

      <section style={{ marginBottom: 34 }}>
        <h2 style={heading}>Department report access</h2>
        <p style={sub}>Choose which Corporate Reporting Centre reports each department may view and export. Finance, Exec and Admin always have full access; this grants access to the other departments. Enforced server-side.</p>
        <ReportAccessMatrix departments={deptNames} templates={reportTemplates} initialPermissions={reportPerms} />
      </section>

      <section>
        <h2 style={heading}>Access</h2>
        <p style={sub}>Choose which navigation headers and sub-headers each department can see. Unticking a header hides everything under it; you can still hide individual sub-headers while the header stays visible. Admins always see everything.</p>
        <AccessMatrix departments={deptNames} visibility={visibility} />
      </section>
    </div>
  );
}
