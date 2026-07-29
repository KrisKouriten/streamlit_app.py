import { redirect } from "next/navigation";
import { getSession, isAdmin } from "../../../lib/auth";
import { getUserDepartment, getApproverEmails } from "../../../lib/dept-budget";
import { departmentList, getDepartmentDashboard } from "../../../lib/dept-budget-dashboard";
import { STAGE_LABEL } from "../../../lib/dept-budget-rules";
import { challengeReasonLabels, displayStatus, committedAmount } from "../../../lib/po-rules";
import { PageHeader, StatRow, Stat, Panel, Table, Badge, EmptyState, money } from "../../finance-os/ui";
import DeptDashControls from "./dept-dash-controls";
import DeptApprovals from "./dept-approvals";

export const dynamic = "force-dynamic";

/*
 * Departmental Budget Dashboard — a read-only roll-up for one department: its
 * budget for the year, its open purchase orders, and YTD committed spend. All
 * from governed sources (dept budgets + POs); "spend" is PO-committed (approved
 * POs), not GL actuals, and is labelled as such.
 */

const PO_TONE = { DRAFT: "muted", PENDING_SIGNOFF: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "muted" };

export default async function DepartmentBudgetDashboard({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const departments = await departmentList();
  const myDept = await getUserDepartment(session.id);
  const department = sp?.dept || myDept || departments[0] || null;
  const thisYear = new Date().getFullYear();
  const year = Number(sp?.year) || thisYear;
  const years = [thisYear + 1, thisYear, thisYear - 1];

  const d = department ? await getDepartmentDashboard(department, year) : { ready: true, hasBudget: false };

  // Can this viewer sign off the department's P.Os? (approver for the dept, or admin)
  const approverEmails = department ? (await getApproverEmails(department).catch(() => [])).map((e) => (e || "").toLowerCase()) : [];
  const canApprove = isAdmin(session) || approverEmails.includes((session.email || "").toLowerCase());

  const s = d.summary;
  const committed = d.pos?.ytdCommitted || 0;
  const proposed = s?.proposed || 0;
  const budgetLeft = proposed ? proposed - committed : null;
  const maxCat = Math.max(1, ...(d.categories || []).map((c) => Math.abs(c.subtotal)));

  return (
    <div className="fos-shell">
      <PageHeader crumb="Department Dashboards" title={department ? `${department} Dashboard` : "Department Dashboard"}
        right={department ? `Budget & purchase orders · ${year}` : "No department"} />

      {!departments.length ? (
        <EmptyState title="No departments yet">Seed the governed departments (migration 047) to use this dashboard.</EmptyState>
      ) : (
        <>
          <DeptDashControls departments={departments} department={department} year={year} years={years} />

          <StatRow>
            <Stat label="Budget (proposed)" value={d.hasBudget ? money(proposed, { compact: true }) : "—"}
              sub={d.hasBudget ? (s.target != null ? `target ${money(s.target, { compact: true })}` : "no target set") : "no budget for this year"} />
            <Stat label="YTD committed spend" value={money(committed, { compact: true })} sub={`${d.pos?.closedCount || 0} closed POs, this year`} />
            <Stat label="Under challenge" value={String(d.pos?.challengedCount || 0)}
              sub={d.pos?.challengedCount ? `${money(d.pos.challengedValue || 0, { compact: true })} in query` : "none"}
              tone={d.pos?.challengedCount ? "red" : undefined} />
            <Stat label="Open purchase orders" value={String(d.pos?.openCount || 0)}
              sub={`${money(d.pos?.openValue || 0, { compact: true })}${d.pos?.pending ? ` · ${d.pos.pending} awaiting sign-off` : ""}`}
              tone={d.pos?.pending ? "amber" : undefined} />
            <Stat label="Budget remaining" value={budgetLeft != null ? money(budgetLeft, { compact: true }) : "—"}
              sub={budgetLeft != null ? "proposed less committed" : "set a budget"} tone={budgetLeft != null && budgetLeft < 0 ? "red" : undefined} />
          </StatRow>

          <div style={{ fontSize: 12, color: "var(--faint)", margin: "-14px 0 22px" }}>
            &ldquo;Committed spend&rdquo; is the net value of purchase orders <strong>closed by Finance</strong> (P.O Summary + Close) for this department this year — invoice net where recorded. P.Os <strong>under challenge</strong> are shown separately until resolved. A GL-actuals-by-department feed isn&rsquo;t connected yet, so this is committed spend, not booked actuals.
          </div>

          {/* Awaiting sign-off — the budget-holder's action queue */}
          {d.pos?.awaitingCount > 0 && (
            <Panel title={canApprove ? "Awaiting your sign-off" : "Awaiting department-head sign-off"} note={`${d.pos.awaitingCount} P.O${d.pos.awaitingCount === 1 ? "" : "s"}`}>
              <DeptApprovals pos={d.pos.awaiting} canApprove={canApprove} />
            </Panel>
          )}

          {/* Budget by category */}
          <Panel title="Budget by category" note={d.hasBudget ? `${STAGE_LABEL[d.budget.status] || d.budget.status} · ${d.budget.version_label}` : undefined}>
            {d.hasBudget && d.categories.length ? (
              <div className="fos-card" style={{ padding: "16px 18px" }}>
                {d.categories.map((c) => (
                  <div key={c.category} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                      <span style={{ color: "var(--muted)" }}>{c.category}</span>
                      <span style={{ fontWeight: 600 }}>{money(c.subtotal)}</span>
                    </div>
                    <div style={{ height: 7, background: "var(--raise)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${(Math.abs(c.subtotal) / maxCat) * 100}%`, height: "100%", background: "var(--accent)" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No budget for this year">
                No {department} budget exists for {year}. Build one in <a href="/plan/dept-budget" style={{ color: "var(--accent)" }}>Plan — HO → Departmental Budgets</a>.
              </EmptyState>
            )}
          </Panel>

          {/* Under challenge */}
          {d.pos?.challengedCount > 0 && (
            <Panel title="P.Os under challenge" note={`${d.pos.challengedCount} in query`}>
              <div className="fos-card" style={{ padding: "6px 16px", borderColor: "color-mix(in srgb, var(--red) 30%, var(--line))" }}>
                {d.pos.challenged.map((p) => (
                  <div key={p.po_id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid var(--hairline)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{p.xero_po_number}</span>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.supplier}</span>
                    <span className="fos-num" style={{ fontSize: 12.5 }}>{money(p.payment_value)}</span>
                    <span style={{ flex: 1, fontSize: 11.5, color: "var(--red)" }}>{challengeReasonLabels(p.challenge_reasons).join(" · ")}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Open POs */}
          <Panel title="Open purchase orders" note={`${d.pos?.openCount || 0} open`}>
            <Table
              columns={[
                { label: "Date", render: (r) => (r.po_date ? new Date(r.po_date).toLocaleDateString("en-GB") : "—") },
                { label: "Supplier", render: (r) => r.supplier || "—" },
                { label: "Category", render: (r) => r.po_category || "—" },
                { label: "Net value", align: "right", render: (r) => money(r.payment_value) },
                { label: "Status", render: (r) => <Badge tone={PO_TONE[r.status] || "muted"}>{(r.status || "").replace(/_/g, " ")}</Badge> },
              ]}
              rows={d.pos?.open || []}
              empty={`No open purchase orders for ${department}.`}
            />
          </Panel>

          {/* P.O register — every signed-off P.O for this department */}
          <Panel title="P.O register" note={`${d.pos?.registerCount || 0} signed off`}>
            <Table
              columns={[
                { label: "Xero P.O", render: (r) => r.xero_po_number || "—" },
                { label: "Approved", render: (r) => (r.approved_at ? new Date(r.approved_at).toLocaleDateString("en-GB") : "—") },
                { label: "Supplier", render: (r) => r.supplier || "—" },
                { label: department === "Marketing" ? "Campaign" : "Category", render: (r) => (department === "Marketing" ? (r.marketing_campaign || r.po_category || "—") : (r.po_category || "—")) },
                { label: "Net value", align: "right", render: (r) => money(r.payment_value) },
                { label: "Invoice net", align: "right", render: (r) => (r.invoice_amount != null ? money(r.invoice_amount) : "—") },
                { label: "Committed", align: "right", render: (r) => (r.finance_status === "CLOSED" ? money(committedAmount(r)) : "—") },
                { label: "Status", render: (r) => { const st = displayStatus(r); return <Badge tone={st.tone}>{st.label}</Badge>; } },
              ]}
              rows={d.pos?.register || []}
              empty={`No signed-off purchase orders for ${department} yet.`}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
