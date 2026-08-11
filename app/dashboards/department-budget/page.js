import { redirect } from "next/navigation";
import { getSession, isAdmin, hasRole } from "../../../lib/auth";
import { getUserDepartment, getApproverEmails } from "../../../lib/dept-budget";
import { departmentList, getDepartmentDashboard } from "../../../lib/dept-budget-dashboard";
import { STAGE_LABEL } from "../../../lib/dept-budget-rules";
import { challengeReasonLabels, displayStatus, committedAmount, poRef, paymentStatusOf } from "../../../lib/po-rules";
import { displayStatus as procDisplayStatus, procRef, lineValue as procLineValue, committedAmount as procCommitted, challengeReasonLabels as procChallengeLabels, paymentStatusOf as procPayment, isForeignRow as procForeign, reportBasis as procReportBasis } from "../../../lib/procurement-close-rules";
import { PageHeader, StatRow, Stat, Panel, Table, Badge, EmptyState, money, pct } from "../../finance-os/ui";
import DeptDashControls from "./dept-dash-controls";
import DeptApprovals from "./dept-approvals";
import RegisterTabs from "./register-tabs";

export const dynamic = "force-dynamic";

/*
 * Departmental Budget Dashboard — a read-only roll-up for one department: its
 * budget for the year, its open purchase orders, and YTD committed spend. All
 * from governed sources (dept budgets + POs); "spend" is PO-committed (approved
 * POs), not GL actuals, and is labelled as such.
 */

const PO_TONE = { DRAFT: "muted", PENDING_SIGNOFF: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "muted" };

// The procurement register is split by source (Miniso HQ / Local / other merch
// requests). Columns are shared; the Miniso table additionally shows whether a
// Letter of Credit has been issued yet against each order.
const hasLc = (r) => !!(r.lc_reference && String(r.lc_reference).trim());
// The submitted net value in the order's own currency, e.g. "$12,700 USD".
const PROC_CCY_SYMBOL = { USD: "$", GBP: "£", EUR: "€", CNY: "¥" };
const procCcyAmt = (v, ccy) => `${PROC_CCY_SYMBOL[ccy] || ""}${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy || ""}`.trim();
// The GBP reported for a row — at its SPOT/HEDGED basis (report_gbp, attached by
// the DB layer), falling back to the booked line value.
const procReportedGbp = (r) => (r.report_gbp != null ? Number(r.report_gbp) : procLineValue(r));
function procRegisterColumns({ lc = false } = {}) {
  const cols = [
    { label: "Reference", render: (r) => procRef(r) },
    { label: "Supplier", render: (r) => r.supplier || "—" },
    { label: "Channel / SKU", render: (r) => (r.channel_code ? `${r.channel_code}${r.sku_or_range ? ` · ${r.sku_or_range}` : ""}` : (r.category || "—")) },
    {
      label: "Net value", align: "right", render: (r) => {
        // Foreign orders show the submitted order-currency amount, then the GBP at
        // the chosen reporting basis (spot / hedged). GBP orders show GBP only.
        if (procForeign(r) && r.amount_ccy != null) {
          return (
            <div>
              <div>{procCcyAmt(r.amount_ccy, r.currency)}</div>
              <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>{money(procReportedGbp(r))} at {procReportBasis(r) === "HEDGED" ? "hedged" : "spot"}</div>
            </div>
          );
        }
        return money(procReportedGbp(r));
      },
    },
    { label: "Invoice net", align: "right", render: (r) => (r.invoice_amount != null ? money(r.invoice_amount) : "—") },
    { label: "Committed", align: "right", render: (r) => (r.finance_status === "CLOSED" ? money(procCommitted(r)) : "—") },
    { label: "Payment", render: (r) => { const ps = procPayment(r); return <Badge tone={ps.tone}>{ps.label}</Badge>; } },
    { label: "Status", render: (r) => { const st = procDisplayStatus(r); return <Badge tone={st.tone}>{st.label}</Badge>; } },
  ];
  // LC column sits just before Payment on the Miniso table only.
  if (lc) cols.splice(6, 0, { label: "LC issued", render: (r) => (hasLc(r) ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">Not yet</Badge>) });
  return cols;
}
const PROC_REGISTER_GROUPS = [
  ["MINISO", "Miniso HQ purchases", true],
  ["LOCAL", "Local purchases", false],
  ["OTHER", "Other", false],
];

export default async function DepartmentBudgetDashboard({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;

  const departments = await departmentList();
  const myDept = await getUserDepartment(session.id);
  // Finance/Exec/Admin may view any department; everyone else is locked to their
  // own — a ?dept for another department is ignored, not shown.
  const canViewAll = isAdmin(session) || hasRole(session, "FINANCE", "EXEC");
  const department = canViewAll ? (sp?.dept || myDept || departments[0] || null) : (myDept || null);
  const thisYear = new Date().getFullYear();
  const year = Number(sp?.year) || thisYear;
  const years = [thisYear + 1, thisYear, thisYear - 1];

  const d = department ? await getDepartmentDashboard(department, year) : { ready: true, hasBudget: false };

  // Can this viewer sign off the department's P.Os? (approver for the dept, or admin)
  const approverEmails = department ? (await getApproverEmails(department).catch(() => [])).map((e) => (e || "").toLowerCase()) : [];
  const canApprove = isAdmin(session) || approverEmails.includes((session.email || "").toLowerCase());

  const s = d.summary;
  const committed = d.pos?.ytdCommitted || 0;
  const openValue = d.pos?.openValue || 0;
  const proposed = s?.proposed || 0;
  // Budget remaining is net of both committed spend (closed P.Os) and open
  // purchase-order commitments still in flight.
  const budgetLeft = d.hasBudget ? proposed - committed - openValue : null;
  const maxCat = Math.max(1, ...(d.categories || []).map((c) => Math.abs(c.subtotal)));

  return (
    <div className="fos-shell">
      <PageHeader crumb="Department Dashboards" title={department ? `${department} Dashboard` : "Department Dashboard"}
        right={department ? `Budget & purchase orders · ${year}` : "No department"} />

      {!departments.length ? (
        <EmptyState title="No departments yet">Seed the governed departments (migration 047) to use this dashboard.</EmptyState>
      ) : (
        <>
          <DeptDashControls departments={departments} department={department} year={year} years={years} canViewAll={canViewAll} />

          <StatRow>
            <Stat label="Budget (proposed)" value={d.hasBudget ? money(proposed, { compact: true }) : "—"}
              sub={d.hasBudget ? (s.target != null ? `target ${money(s.target, { compact: true })}` : "no target set") : "no budget for this year"} />
            <Stat label="YTD committed spend" value={money(committed, { compact: true })} sub={`${d.pos?.closedCount || 0} closed PO${(d.pos?.closedCount || 0) === 1 ? "" : "s"}, this year`} />
            <Stat label="Under challenge" value={String(d.pos?.challengedCount || 0)}
              sub={d.pos?.challengedCount ? `${money(d.pos.challengedValue || 0, { compact: true })} in query` : "none"}
              tone={d.pos?.challengedCount ? "red" : undefined} />
            <Stat label="Open purchase orders" value={money(openValue, { compact: true })}
              sub={`${d.pos?.openCount || 0} open PO${(d.pos?.openCount || 0) === 1 ? "" : "s"}${d.pos?.pending ? ` · ${d.pos.pending} awaiting sign-off` : ""}`}
              tone={d.pos?.pending ? "amber" : undefined} />
            <Stat label="Budget remaining" value={budgetLeft != null ? money(budgetLeft, { compact: true }) : "—"}
              sub={budgetLeft != null ? "proposed less committed & open" : "set a budget"} tone={budgetLeft != null && budgetLeft < 0 ? "red" : undefined} />
          </StatRow>

          <div style={{ fontSize: 12, color: "var(--faint)", margin: "-14px 0 22px" }}>
            &ldquo;Committed spend&rdquo; is the net value of purchase orders <strong>closed by Finance</strong> (P.O Summary + Close) for this department this year — invoice net where recorded. <strong>Budget remaining</strong> is the proposed budget less committed spend <em>and</em> open purchase orders still in flight. P.Os <strong>under challenge</strong> are shown separately until resolved. A GL-actuals-by-department feed isn&rsquo;t connected yet, so this is committed spend, not booked actuals.
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
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{poRef(p)}</span>
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
                { label: "P.O number", render: (r) => poRef(r) },
                { label: "Approved", render: (r) => (r.approved_at ? new Date(r.approved_at).toLocaleDateString("en-GB") : "—") },
                { label: "Supplier", render: (r) => r.supplier || "—" },
                { label: department === "Marketing" ? "Campaign" : "Category", render: (r) => (department === "Marketing" ? (r.marketing_campaign || r.po_category || "—") : (r.po_category || "—")) },
                { label: "Net value", align: "right", render: (r) => money(r.payment_value) },
                { label: "Invoice net", align: "right", render: (r) => (r.invoice_amount != null ? money(r.invoice_amount) : "—") },
                { label: "Committed", align: "right", render: (r) => (r.finance_status === "CLOSED" ? money(committedAmount(r)) : "—") },
                { label: "Payment", render: (r) => { const ps = paymentStatusOf(r); return <Badge tone={ps.tone}>{ps.label}</Badge>; } },
                { label: "Status", render: (r) => { const st = displayStatus(r); return <Badge tone={st.tone}>{st.label}</Badge>; } },
              ]}
              rows={d.pos?.register || []}
              empty={`No signed-off purchase orders for ${department} yet.`}
            />
          </Panel>

          {/* Supplier credit & HSBC facility (Merchandising) — supplier exposure
              vs credit limits + the HSBC facility headroom, from the governed
              suppliers/credit layer. Shown only when the data loads. */}
          {d.supplierCredit && (() => {
            const sc = d.supplierCredit;
            const fac = sc.facility;
            const exp = sc.exposure && sc.exposure.ready ? sc.exposure : null;
            const totals = exp?.totals;
            const facHasLimit = fac && fac.limit != null;
            const rowTone = (r) => (r.over ? "red" : r.near ? "amber" : undefined);
            const limited = (exp?.rows || []).filter((r) => r.limit != null).slice(0, 8);
            return (
              <Panel title="Supplier credit & HSBC facility" note="orders & drawings vs credit limits">
                <StatRow>
                  <Stat label="HSBC facility limit" value={facHasLimit ? money(fac.limit, { compact: true }) : "—"}
                    sub={facHasLimit ? "HSBC ceiling" : "limit not set"} />
                  <Stat label="Facility drawn" value={money(fac?.exposure || 0, { compact: true })} sub="GBP-equivalent drawings" />
                  <Stat label="Facility headroom" value={facHasLimit ? money(fac.headroom, { compact: true }) : "—"}
                    tone={fac?.over ? "red" : undefined}
                    sub={fac?.over ? "over facility limit" : facHasLimit ? `${pct(fac.utilisation)} utilised` : "set a limit"} />
                  <Stat label="Suppliers over limit" value={String(totals?.overLimit || 0)}
                    tone={totals?.overLimit ? "red" : undefined}
                    sub={`${totals?.nearLimit || 0} near limit`} />
                </StatRow>
                {limited.length ? (
                  <Table
                    columns={[
                      { label: "Supplier", tone: rowTone, render: (r) => r.name },
                      { label: "Exposure", align: "right", tone: rowTone, render: (r) => money(r.exposure) },
                      { label: "Limit", align: "right", tone: rowTone, render: (r) => money(r.limit) },
                      { label: "Headroom", align: "right", tone: rowTone, render: (r) => money(r.headroom) },
                      { label: "Utilisation", align: "right", tone: rowTone, render: (r) => (r.utilisation != null ? pct(r.utilisation) : "—") },
                    ]}
                    rows={limited}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: "var(--faint)" }}>
                    No supplier credit limits set yet — set them on <a href="/operate/suppliers" style={{ color: "var(--accent)" }}>Suppliers &amp; Credit</a>.
                  </div>
                )}
              </Panel>
            );
          })()}

          {/* Procurement (Merchandising) — the Summary + Close lifecycle rolled up
              here, same visibility Marketing has for its POs. */}
          {d.proc?.ready && (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, margin: "8px 0 12px" }}>Procurement</div>
              <StatRow>
                <Stat label="Committed spend" value={money(d.proc.committed, { compact: true })} sub={`${d.proc.committedCount} closed`} />
                <Stat label="Open procurement" value={money(d.proc.open, { compact: true })}
                  sub={`${d.proc.openCount} open${d.proc.pendingCount ? ` · ${d.proc.pendingCount} pending approval` : ""}`} tone={d.proc.pendingCount ? "amber" : undefined} />
                <Stat label="Under challenge" value={String(d.proc.challengedCount)}
                  sub={d.proc.challengedCount ? `${money(d.proc.challengedValue, { compact: true })} in query` : "none"} tone={d.proc.challengedCount ? "red" : undefined} />
                <Stat label="Cash budget" value={money(d.proc.cashBudget, { compact: true })} sub="Miniso + Local monthly" />
                <Stat label="Purchases" value={String(d.proc.count)} sub="all sources" />
              </StatRow>

              <div style={{ fontSize: 12, color: "var(--faint)", margin: "-14px 0 22px" }}>
                &ldquo;Committed spend&rdquo; is procurement <strong>closed by Finance</strong> (Procurement Summary + Close) — invoice net where recorded. Covers Miniso &amp; Local purchases and OTB merch requests. Items <strong>under challenge</strong> are shown separately until resolved.
              </div>

              {d.proc.challengedCount > 0 && (
                <Panel title="Procurement under challenge" note={`${d.proc.challengedCount} in query`}>
                  <div className="fos-card" style={{ padding: "6px 16px", borderColor: "color-mix(in srgb, var(--red) 30%, var(--line))" }}>
                    {d.proc.challenged.map((p) => (
                      <div key={p.purchase_id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid var(--hairline)", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{procRef(p)}</span>
                        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.supplier}</span>
                        <span className="fos-num" style={{ fontSize: 12.5 }}>{money(procCommitted(p))}</span>
                        <span style={{ flex: 1, fontSize: 11.5, color: "var(--red)" }}>{procChallengeLabels(p.challenge_reasons).join(" · ")}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel title="Procurement register" note={`${d.proc.registerCount} purchases · Miniso / Local tabs`}>
                {(() => {
                  const reg = d.proc.register || [];
                  // Group by the supplier's master classification (report_source:
                  // MINISO / LOCAL / OTHER), falling back to the row source.
                  const grp = (r) => r.report_source || (r.source === "MINISO" ? "MINISO" : r.source === "LOCAL" ? "LOCAL" : "OTHER");
                  // One tab per source so a long Miniso list doesn't crowd out Local.
                  // Each tab's table is built here (server) and shown one at a time.
                  const tabs = PROC_REGISTER_GROUPS.map(([key, label, lc]) => {
                    const rows = reg.filter((r) => grp(r) === key);
                    return { key, label, count: rows.length, content: <Table columns={procRegisterColumns({ lc })} rows={rows} empty="—" /> };
                  });
                  return <RegisterTabs tabs={tabs} />;
                })()}
                {d.proc.excludedMerch > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>
                    {d.proc.excludedMerch} purchase{d.proc.excludedMerch === 1 ? "" : "s"} from suppliers marked not Active&nbsp;to&nbsp;Merch are excluded.
                  </div>
                )}
              </Panel>

              {d.proc.dc && d.proc.dc.count > 0 && (() => {
                const dc = d.proc.dc;
                const cur = (v) => procCcyAmt(v, dc.currency);
                const dmy = (s) => { if (!s) return "—"; const x = new Date(s); return isNaN(x) ? s : x.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }); };
                return (
                  <Panel title="Documentary Credits" note={`${dc.count} DC${dc.count === 1 ? "" : "s"} · Miniso HQ`}>
                    <StatRow>
                      <Stat label="DC value" value={cur(dc.totalValue)} sub="full DC amount · USD" />
                      <Stat label="Total LC value" value={cur(dc.totalLcValue)} sub="LCs logged · USD" />
                      <Stat label="Balance" value={cur(dc.totalBalance)} tone={dc.totalBalance < -0.005 ? "red" : dc.totalBalance <= 0.005 ? "amber" : "green"} sub="DC value − LCs" />
                      <Stat label="LC value @ spot" value={money(dc.totalSpotGbp || 0)} sub="GBP at spot FX" />
                      <Stat label="LC value @ costing" value={money(dc.totalCostingGbp || 0)} sub="GBP at costing FX" />
                    </StatRow>
                    <Table
                      columns={[
                        { label: "DC reference", render: (r) => r.dc_reference },
                        { label: "Request", render: (r) => r.purchaseRef },
                        { label: "LCs", align: "right", render: (r) => String(r.count) },
                        { label: "DC value", align: "right", render: (r) => (r.dc_value != null ? cur(r.dc_value) : "—") },
                        { label: "Total LC value", align: "right", render: (r) => cur(r.lc_value) },
                        { label: "Balance", align: "right", render: (r) => (r.balance != null ? cur(r.balance) : "—") },
                        { label: "Expected payment", render: (r) => dmy(r.due_date) },
                      ]}
                      rows={dc.rows}
                      empty="—"
                    />
                    <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>
                      DC value is the full documentary credit keyed on <strong>Procurement → Manage LC</strong>; total LC value is the sum of the LCs logged under it (a DC can hold several); balance is DC value − total LC value. The GBP stats convert the LC total at the spot/costing FX rates. A DC with no value keyed shows &ldquo;—&rdquo;.
                    </div>
                  </Panel>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}
