import { redirect } from "next/navigation";
import { getSession, hasRole, isAdmin } from "../../../lib/auth";
import { getExpenseReport, expenseDbTarget } from "../../../lib/expenses";
import { departmentsHeadedBy } from "../../../lib/dept-budget";
import { listDepartments } from "../../../lib/governance";
import { accountName, storeFromTracking, expenseTabs, pickExpenseTab, expensePeriod, CONSOLIDATED } from "../../../lib/expense-rules.js";
import { PageHeader, Panel, Table, StatRow, Stat, EmptyState, money, pct, Badge } from "../../finance-os/ui";
import ExpenseTools, { CreateTables, PeriodPicker } from "./expenses-ui";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ukDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const dash = <span style={{ color: "var(--faint)" }}>—</span>;
const qs = (o) => "?" + Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/*
 * Expense Claims (Plan — HO) — the Xero expense-claims export, loaded by
 * Finance and reported against each department's Travel, Expenses &
 * Entertainment budget.
 *
 * One tab per department, and a Consolidated tab with the by-department
 * summary. Finance (and admins) see every tab; a head of department — the
 * department's sign-off approver — sees only their own department's tab;
 * nobody else sees any. Within a department, the head can pick an employee.
 */
export default async function ExpensesPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = (await searchParams) || {};
  const isFinance = isAdmin(session) || hasRole(session, "FINANCE");
  const [headed, deptRows] = await Promise.all([
    isFinance ? Promise.resolve([]) : departmentsHeadedBy(session.email).catch(() => []),
    listDepartments().catch(() => []),
  ]);
  const access = expenseTabs({ isFinance, headed, departments: deptRows.map((d) => d.department_name) });
  const tab = pickExpenseTab(sp.tab, access);
  const year = Number(sp.year) || new Date().getFullYear();

  if (!tab) {
    return (
      <div className="fos-shell">
        <PageHeader crumb="Plan — HO" title="Expense Claims" />
        <EmptyState title="Not available to you">
          Expense claims are visible to Finance and to each department&rsquo;s head. If you head a department, ask Finance to add you as its sign-off approver.
        </EmptyState>
      </div>
    );
  }

  const department = tab === CONSOLIDATED ? null : tab;
  // The period: year to date, a month, or custom dates within the year.
  const period = expensePeriod({ year, period: sp.period || "ytd", from: sp.from, to: sp.to });
  const r = await getExpenseReport({ year, department, claimant: department ? sp.emp || null : null, period: period.key === "ytd" ? null : period });
  if (!r.ready) {
    return (
      <div className="fos-shell">
        <PageHeader crumb="Plan — HO" title="Expense Claims" />
        <EmptyState title="One migration to run">
          Expense Claims needs migration <span style={{ fontFamily: "var(--mono)" }}>117_expense_claims.sql</span> (idempotent). The app can&rsquo;t see its tables on the database it reads
          {(() => { const t = expenseDbTarget(); return t.host ? <> — <span style={{ fontFamily: "var(--mono)" }}>{t.host}</span>{t.database ? <> / <span style={{ fontFamily: "var(--mono)" }}>{t.database}</span></> : null}</> : null; })()}.
          {" "}If you have run it in the SQL editor, it went to another branch.
          {isFinance && <div style={{ marginTop: 14 }}><CreateTables /></div>}
        </EmptyState>
      </div>
    );
  }

  const s = r.summary;
  const years = [...new Set([year, ...r.years])].sort((a, b) => b - a);
  // "to Aug" for the year to date; "for Sep 2026" once a period is picked.
  const through = period.key !== "ytd" ? `for ${period.label}` : s.lastMonth ? `to ${MONTHS[s.lastMonth - 1]}` : null;
  const scope = department ? (r.claimant ? `${department} · ${r.claimant}` : department) : "Consolidated";
  const keep = { tab, year, emp: department ? r.claimant || "" : "", period: period.key, from: period.key === "custom" ? period.from : "", to: period.key === "custom" ? period.to : "" };

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan — HO" title="Expense Claims"
        right={`${scope} · ${year}${period.key !== "ytd" ? ` · ${period.label}` : through ? ` · claims ${through}` : ""} · net of VAT, against the Travel, Expenses & Entertainment budget`} />

      {/* One tab per department the viewer may see, Consolidated first for Finance. */}
      <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line)", marginBottom: 18 }}>
        {access.tabs.map((t) => (
          <a key={t.key} href={qs({ tab: t.key, year, period: keep.period, from: keep.from, to: keep.to })} style={{
            padding: "8px 12px", fontSize: 13, textDecoration: "none", whiteSpace: "nowrap",
            color: t.key === tab ? "var(--ink)" : "var(--muted)", fontWeight: t.key === tab ? 650 : 500,
            borderBottom: t.key === tab ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1,
          }}>{t.label}</a>
        ))}
      </nav>

      <form method="get" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <input type="hidden" name="tab" value={tab} />
        {department && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
            Employee
            <select name="emp" defaultValue={r.claimant || ""} style={sel}>
              <option value="">Everyone in {department}</option>
              {r.claimants.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <select name="year" defaultValue={String(year)} style={sel}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <PeriodPicker key={`${year}-${period.key}-${period.from}-${period.to}`} year={year} period={period.key}
          from={period.key === "custom" ? period.from : ""} to={period.key === "custom" ? period.to : ""} />
        <button type="submit" className="fos-btn" style={{ height: 34 }}>View</button>
        {/* Every claim line in this view — tab, employee, year and period — as Excel. */}
        <a href={`/api/expenses/export${qs(keep)}`} className="fos-btn-ghost" style={{ height: 34, display: "inline-flex", alignItems: "center", textDecoration: "none", marginLeft: "auto" }}>
          Download claim lines (Excel)
        </a>
      </form>

      {!department && isFinance && <ExpenseTools uploads={r.uploads} unmapped={r.unmapped} departments={r.departments} />}

      {s.lines === 0 && !(department && s.departments[0]?.budget != null) ? (
        <EmptyState title={`No expense claims for ${scope} in ${year}`}>
          {isFinance ? "Upload the Xero expense-claims export on the Consolidated tab." : "Finance load the expense claims from Xero; check back once the next export is in."}
        </EmptyState>
      ) : department ? (
        <DepartmentView r={r} department={department} year={year} through={through} />
      ) : (
        <ConsolidatedView r={r} year={year} through={through} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Consolidated
// Finance only: every department side by side against its T&E budget.
function ConsolidatedView({ r, year, through }) {
  const s = r.summary;
  const withBudget = s.departments.filter((d) => d.budget != null);
  const bud = withBudget.reduce((t, d) => t + d.budget, 0);
  const spentAgainst = withBudget.reduce((t, d) => t + d.net, 0);
  return (
    <>
      <StatRow>
        <Stat label="Claimed (net)" value={money(s.net, { compact: true })} sub={`${s.lines.toLocaleString("en-GB")} lines · ${s.claimants} claimants`} />
        <Stat label="VAT on claims" value={money(s.vat, { compact: true })} sub="reclaimable where receipted" />
        <Stat label="T&E budget" value={withBudget.length ? money(bud, { compact: true }) : "—"}
          sub={withBudget.length ? `${pct(bud ? spentAgainst / bud : 0, 0)} used · ${withBudget.length} department${withBudget.length === 1 ? "" : "s"}` : "no T&E budgets set yet"} />
        <Stat label="Over T&E budget" value={s.departments.filter((d) => d.overYtd || d.over).length}
          tone={s.departments.some((d) => d.overYtd || d.over) ? "red" : "green"} sub={through ? `budget ${through}` : "year to date"} />
      </StatRow>

      <Panel title="By department" note={`claims against each department's Travel, Expenses & Entertainment budget · budget to date = the budget's months ${through || "to date"}`}>
        <Table columns={[
          { label: "Department", render: (d) => <a href={qs({ tab: d.department, year })} style={{ color: "var(--accent)", textDecoration: "none" }}>{d.department}</a> },
          { label: "Claimed", align: "right", render: (d) => (
            <>
              {money(d.net)}
              {d.teams?.length > 0 && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3, whiteSpace: "normal" }}>{d.teams.map((t) => `${t.key} ${money(t.net, { compact: true })}`).join(" · ")}</div>}
            </>
          ) },
          { label: "Lines", align: "right", render: (d) => d.lines.toLocaleString("en-GB") },
          { label: "Budget to date", align: "right", render: (d) => (d.budgetYtd == null ? dash : money(d.budgetYtd)) },
          { label: "vs budget to date", align: "right", tone: (d) => (d.budgetYtd == null ? undefined : d.net > d.budgetYtd ? "red" : "green"),
            render: (d) => (d.budgetYtd == null ? dash : `${d.net > d.budgetYtd ? "−" : "+"}${money(Math.abs(d.budgetYtd - d.net))}`) },
          { label: "Full-year budget", align: "right", render: (d) => (d.budget == null ? <span style={{ color: "var(--faint)" }}>no T&amp;E budget</span> : money(d.budget)) },
          { label: "Remaining", align: "right", tone: (d) => (d.remaining == null ? undefined : d.remaining < 0 ? "red" : undefined), render: (d) => (d.remaining == null ? dash : money(d.remaining)) },
          { label: "", render: (d) => (d.over ? <Badge tone="red">Over year</Badge> : d.overYtd ? <Badge tone="amber">Over to date</Badge> : d.budget != null ? <Badge tone="green">Within</Badge> : null) },
        ]} rows={s.departments.filter((d) => d.lines || d.budget != null)} />
      </Panel>

      <MonthTable rows={[
        ...s.departments.filter((d) => d.lines).flatMap((d) => [
          { label: d.teams?.length ? <strong>{d.department}</strong> : d.department, values: d.months },
          ...(d.teams || []).map((t) => ({ label: <span style={{ paddingLeft: 14, color: "var(--muted)" }}>{t.key}</span>, values: t.months })),
        ]),
        { label: <strong>Total</strong>, values: s.months.map((m) => m.net) },
      ]} />

      <Breakdowns s={s} showClaimants />
      <Lines r={r} showDepartment />
    </>
  );
}

// ---------------------------------------------------------------- Department
// One department: its own figures only, against its own T&E budget; an
// employee picked narrows everything below the tiles to their claims.
function DepartmentView({ r, department, through }) {
  const s = r.summary;
  const dept = (r.departmentSummary || s).departments.find((d) => d.department === department) || { net: 0, lines: 0, months: Array(12).fill(0), teams: [] };
  const vsYtd = dept.budgetYtd == null ? null : dept.budgetYtd - dept.net;
  const who = r.claimant;
  const mineRow = who ? s.departments.find((d) => d.department === department) : null;
  // The department budgets per employee: an employee picked is read against
  // their own budget.
  const eb = who && r.employeeBudget ? mineRow : null;
  const ebVs = eb && eb.budgetYtd != null ? eb.budgetYtd - eb.net : null;
  return (
    <>
      {eb ? (
        <StatRow>
          <Stat label={`Claimed by ${who}`} value={money(eb.net, { compact: true })} sub={`${s.lines.toLocaleString("en-GB")} line${s.lines === 1 ? "" : "s"}`} />
          <Stat label={`Their budget${through ? ` ${through}` : ""}`} value={eb.budgetYtd == null ? "—" : money(eb.budgetYtd, { compact: true })} sub={`full year ${money(eb.budget, { compact: true })}`} />
          <Stat label="vs their budget to date" value={ebVs == null ? "—" : `${ebVs < 0 ? "−" : "+"}${money(Math.abs(ebVs), { compact: true })}`}
            tone={ebVs == null ? undefined : ebVs < 0 ? "red" : "green"} sub={ebVs == null ? "" : ebVs < 0 ? "over budget" : "headroom"} />
          <Stat label="Department vs budget to date" value={vsYtd == null ? "—" : `${vsYtd < 0 ? "−" : "+"}${money(Math.abs(vsYtd), { compact: true })}`}
            tone={vsYtd == null ? undefined : vsYtd < 0 ? "red" : "green"} sub={vsYtd == null ? "no T&E budget" : vsYtd < 0 ? "over budget" : "headroom"} />
        </StatRow>
      ) : who ? (
        <StatRow>
          <Stat label={`Claimed by ${who}`} value={money(s.net, { compact: true })} sub={`${s.lines.toLocaleString("en-GB")} line${s.lines === 1 ? "" : "s"}`} />
          <Stat label={`Share of ${department}`} value={pct(dept.net ? s.net / dept.net : 0, 0)} sub={`of ${money(dept.net, { compact: true })} claimed`} />
          <Stat label="VAT on claims" value={money(s.vat, { compact: true })} />
          <Stat label="Department vs budget to date" value={vsYtd == null ? "—" : `${vsYtd < 0 ? "−" : "+"}${money(Math.abs(vsYtd), { compact: true })}`}
            tone={vsYtd == null ? undefined : vsYtd < 0 ? "red" : "green"} sub={vsYtd == null ? "no T&E budget" : vsYtd < 0 ? "over budget" : "headroom"} />
        </StatRow>
      ) : (
        <StatRow>
          <Stat label="Claimed (net)" value={money(dept.net, { compact: true })}
            sub={dept.teams?.length ? dept.teams.map((t) => `${t.key} ${money(t.net, { compact: true })}`).join(" · ") : `${dept.lines.toLocaleString("en-GB")} lines · ${s.claimants} claimants`} />
          <Stat label={`Budget${through ? ` ${through}` : ""}`} value={dept.budgetYtd == null ? "—" : money(dept.budgetYtd, { compact: true })}
            sub={dept.budget == null ? "no T&E budget for this year" : `full year ${money(dept.budget, { compact: true })}`} />
          <Stat label="vs budget to date" value={vsYtd == null ? "—" : `${vsYtd < 0 ? "−" : "+"}${money(Math.abs(vsYtd), { compact: true })}`}
            tone={vsYtd == null ? undefined : vsYtd < 0 ? "red" : "green"} sub={vsYtd == null ? "set a T&E budget" : vsYtd < 0 ? "over budget" : "headroom"} />
          <Stat label="Full-year remaining" value={dept.remaining == null ? "—" : money(dept.remaining, { compact: true })}
            tone={dept.remaining != null && dept.remaining < 0 ? "red" : undefined} sub={dept.budget == null ? "" : "budget less claimed"} />
        </StatRow>
      )}

      <MonthTable rows={who ? [
        { label: <strong>{who}</strong>, values: mineRow?.months || Array(12).fill(0) },
        ...(eb?.budgetMonths ? [{ label: <span style={{ color: "var(--muted)" }}>{who} budget</span>, values: eb.budgetMonths }] : []),
        { label: <span style={{ color: "var(--muted)" }}>{department} total</span>, values: dept.months },
      ] : [
        { label: dept.teams?.length ? <strong>{department}</strong> : department, values: dept.months },
        ...(dept.teams || []).map((t) => ({ label: <span style={{ paddingLeft: 14, color: "var(--muted)" }}>{t.key}</span>, values: t.months })),
        ...(dept.budgetMonths ? [{ label: <span style={{ color: "var(--muted)" }}>T&amp;E budget</span>, values: dept.budgetMonths }] : []),
      ]} />

      {!who && <BudgetLines dept={dept} through={through} />}
      {eb && <BudgetLines dept={eb} through={through} />}
      <Breakdowns s={s} showClaimants={!who} />
      <Lines r={r} showDepartment={false} />
    </>
  );
}

// Budget against claims on each of the T&E budget lines.
function BudgetLines({ dept, through }) {
  const rows = dept.budgetLines || [];
  if (!rows.length) return null;
  const tot = rows.reduce((t, r) => ({ net: t.net + r.net, ytd: t.ytd + (r.budgetYtd || 0), bud: t.bud + (r.budget || 0) }), { net: 0, ytd: 0, bud: 0 });
  const hasBudget = rows.some((r) => r.budget != null);
  const vs = (b, n) => (b == null ? dash : `${n > b ? "−" : "+"}${money(Math.abs(b - n))}`);
  return (
    <Panel title="By budget line" note={`claims sorted onto the Travel, Expenses & Entertainment budget lines · budget to date = the budget's months ${through || "to date"}`}>
      <Table columns={[
        { label: "Line", render: (r) => r.label },
        { label: "Claimed", align: "right", render: (r) => money(r.net) },
        { label: "Budget to date", align: "right", render: (r) => (r.budgetYtd == null ? dash : money(r.budgetYtd)) },
        { label: "vs budget to date", align: "right", tone: (r) => (r.budgetYtd == null ? undefined : r.net > r.budgetYtd ? "red" : "green"), render: (r) => vs(r.budgetYtd, r.net) },
        { label: "Full-year budget", align: "right", render: (r) => (r.budget == null ? dash : money(r.budget)) },
      ]} rows={[
        ...rows.map((r) => ({ ...r, label: r.line })),
        ...(rows.length > 1 ? [{ label: <strong>Total</strong>, net: tot.net, budgetYtd: hasBudget ? tot.ytd : null, budget: hasBudget ? tot.bud : null }] : []),
      ]} />
    </Panel>
  );
}

// ---------------------------------------------------------------- shared
function MonthTable({ rows }) {
  return (
    <Panel title="By month" note="claimed, net of VAT">
      <Table columns={[
        { label: "", render: (row) => row.label },
        ...MONTHS.map((m, i) => ({ label: m, align: "right", render: (row) => (row.values?.[i] ? money(row.values[i], { compact: true }) : dash) })),
        { label: "Total", align: "right", render: (row) => <strong>{money((row.values || []).reduce((t, v) => t + (v || 0), 0))}</strong> },
      ]} rows={rows} />
    </Panel>
  );
}

function Breakdowns({ s, showClaimants }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16 }}>
      <Panel title="By category" note="the account each claim was coded to">
        <Table columns={[
          { label: "Category", render: (c) => c.key },
          { label: "Claimed", align: "right", render: (c) => money(c.net) },
          { label: "Share", align: "right", render: (c) => pct(s.net ? c.net / s.net : 0) },
        ]} rows={s.categories} />
      </Panel>
      {showClaimants && (
        <Panel title="By employee">
          <Table columns={[
            { label: "Employee", render: (c) => c.key },
            { label: "Claimed", align: "right", render: (c) => money(c.net) },
            { label: "Lines", align: "right", render: (c) => c.lines },
          ]} rows={s.claimantsList.slice(0, 25)} />
        </Panel>
      )}
      {s.stores.length > 0 && (
        <Panel title="By store" note="Xero Store tracking, where the claim was tagged">
          <Table columns={[
            { label: "Store", render: (c) => c.key },
            { label: "Claimed", align: "right", render: (c) => money(c.net) },
          ]} rows={s.stores.slice(0, 25)} />
        </Panel>
      )}
    </div>
  );
}

function Lines({ r, showDepartment }) {
  return (
    <Panel title={`Claim lines${r.lineCount > r.lines.length ? ` · latest ${r.lines.length} of ${r.lineCount.toLocaleString("en-GB")}` : ` · ${r.lineCount.toLocaleString("en-GB")}`}`} note="latest first">
      <Table columns={[
        { label: "Date", render: (l) => ukDate(l.claim_date) },
        { label: "Employee", render: (l) => l.claimant },
        ...(showDepartment ? [{ label: "Department", render: (l) => (l.team && l.team !== l.department && !String(l.department).includes("(unmapped)")
          ? <>{l.department}<div style={{ fontSize: 10.5, color: "var(--faint)" }}>{l.team}</div></> : l.department) }]
          // Within a department, the team only where it has teams (Operations).
          : r.lines.some((l) => l.team && l.team !== l.department) ? [{ label: "Team", render: (l) => (l.team && l.team !== l.department ? l.team : dash) }] : []),
        { label: "Description", render: (l) => <span style={{ whiteSpace: "normal", display: "inline-block", maxWidth: 360 }}>{l.description || "—"}</span> },
        { label: "Category", render: (l) => accountName(l.account_code) },
        { label: "Store", render: (l) => (l.store_tracking ? storeFromTracking(l.store_tracking) : dash) },
        { label: "Net", align: "right", render: (l) => money(l.net_amount) },
        { label: "VAT", align: "right", render: (l) => (l.tax_amount ? money(l.tax_amount) : dash) },
      ]} rows={r.lines} />
    </Panel>
  );
}

const sel = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontSize: 13 };
