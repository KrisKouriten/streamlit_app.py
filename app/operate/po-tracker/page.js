import { redirect } from "next/navigation";
import { getSession, isAdmin, hasRole } from "../../../lib/auth";
import { getUserDepartment } from "../../../lib/dept-budget";
import { departmentPoBudgets } from "../../../lib/dept-budget-dashboard";
import { deptTabsFor, rowsForViewer } from "../../../lib/dept-tabs-rules.js";
import { listPos, getDepartments, marketingCampaignSuggestions } from "../../../lib/purchase-orders";
import { listEntitiesForPicker } from "../../../lib/intercompany";
import { getBusinessProjects } from "../../../lib/business-projects";
import { listSuppliers } from "../../../lib/suppliers";
import { getStoreList } from "../../../lib/store-sales";
import { listSignoffs, getPoSelfApproveLimit } from "../../../lib/governance";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import PoUI from "./po-ui";

export const dynamic = "force-dynamic";

// Purchase Order Requests (PLAN — HO) — departments raise a P.O (header + optional
// store recharge) after generating the number in Xero, then submit it for the
// department-head sign-off. A department's sign-off approvers (or an admin) can
// approve/reject; once signed off a P.O can only be deleted by an admin. Finance
// then closes or challenges it on the P.O Summary + Close screen (Operate).
export default async function PurchaseOrderRequests({ searchParams }) {
  const session = await getSession();
  const sp = (await searchParams) || {};
  if (!session) redirect("/login");

  const admin = isAdmin(session);
  const email = (session.email || "").toLowerCase();

  const [list, departments, stores, signoffs, marketingCampaigns, selfApproveLimit, projects, supplierList, entities] = await Promise.all([
    listPos({ limit: 500 }),
    getDepartments(),
    getStoreList().catch(() => []),
    listSignoffs().catch(() => []),
    marketingCampaignSuggestions().catch(() => []),
    getPoSelfApproveLimit().catch(() => 0),
    getBusinessProjects().catch(() => ({ projects: [] })),
    listSuppliers({ activeOnly: true }).catch(() => ({ suppliers: [] })),
    listEntitiesForPicker().catch(() => []),
  ]);
  // Live business projects to allocate P.O spend against (exclude finished ones).
  const businessProjects = (projects.projects || [])
    .filter((p) => p.status !== "Done")
    .map((p) => ({ id: p.id, name: p.name, status: p.status }));

  // Departments this user can sign off for (from governance.department_signoff).
  // Admins can sign off any department, so this list is only consulted for
  // non-admins on the client.
  const approverDepts = signoffs
    .filter((s) => (s.signoff_email || "").toLowerCase() === email)
    .map((s) => s.department);

  /*
   * One tab per department. Finance and admins see every department and an
   * "All departments" tab; anyone else sees their own: the department on their
   * profile, the ones they sign off for, and any they have raised a P.O under.
   * The P.Os are filtered here, on the server, so another department's are
   * never sent to the browser.
   */
  const seeAll = admin || hasRole(session, "FINANCE");
  const myDept = seeAll ? null : await getUserDepartment(session.id).catch(() => null);
  const me = String(session.email || session.name || "").toLowerCase();
  const raisedIn = (list.pos || []).filter((p) => String(p.created_by || "").toLowerCase() === me).map((p) => p.department);
  const deptTabs = deptTabsFor({ seeAll, departments: departments.map((d) => d.department_name), mine: [myDept, ...approverDepts, ...raisedIn] });
  const visiblePos = rowsForViewer(list.pos || [], deptTabs);

  // Spend & committed vs budget: Finance and admins for every department, a
  // head for the departments they sign off.
  const year = new Date().getFullYear();
  const budgetDepts = seeAll ? departments.map((d) => d.department_name) : [...new Set(approverDepts)];
  const budgetPanel = budgetDepts.length
    ? { year, visible: budgetDepts.filter((d) => deptTabs.includes(d)), budgets: await departmentPoBudgets(year, budgetDepts).catch(() => ({})) }
    : null;

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan — HO" title="Purchase Order Requests"
        right="Raise a P.O, take it through department-head sign-off" />
      {!list.ready ? (
        <EmptyState title="One migration to run">
          Purchase Order Requests needs migration <span style={{ fontFamily: "var(--mono)" }}>046_purchase_order.sql</span> (idempotent). Run it, refresh, then raise your first P.O.
        </EmptyState>
      ) : (
        <PoUI
          initialPos={visiblePos}
          deptTabs={deptTabs}
          departments={departments.map((d) => d.department_name)}
          stores={stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name }))}
          me={session.email || session.name}
          isAdmin={admin}
          approverDepts={approverDepts}
          marketingCampaigns={marketingCampaigns}
          businessProjects={businessProjects}
          selfApproveLimit={selfApproveLimit}
          supplierNames={(supplierList.suppliers || []).map((s) => s.name)}
          entities={entities.map((e) => ({ entity_id: e.entity_id, entity_name: e.entity_name }))}
          openPo={sp.po || null}
          budgetPanel={budgetPanel}
        />
      )}
    </div>
  );
}
