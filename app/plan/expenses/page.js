import { redirect } from "next/navigation";
import { getSession, hasRole, isAdmin } from "../../../lib/auth";
import { getExpenseReport } from "../../../lib/expenses";
import { getUserDepartment } from "../../../lib/dept-budget";
import { accountName, storeFromTracking } from "../../../lib/expense-rules.js";
import { PageHeader, Panel, Table, StatRow, Stat, EmptyState, money, pct, Badge } from "../../finance-os/ui";
import ExpenseTools from "./expenses-ui";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ukDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const dash = <span style={{ color: "var(--faint)" }}>—</span>;

/*
 * Expense Claims (Plan — HO) — the Xero expense-claims export, loaded by
 * Finance and reported by department against each department's Travel,
 * Expenses & Entertainment budget. Finance, Exec and admins see every
 * department; everyone else sees their own.
 */
export default async function ExpensesPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = (await searchParams) || {};
  const seeAll = isAdmin(session) || hasRole(session, "FINANCE", "EXEC");
  const canLoad = isAdmin(session) || hasRole(session, "FINANCE");
  const myDept = await getUserDepartment(session.id).catch(() => null);
  const department = seeAll ? (sp.dept || null) : (myDept || "__none__");
  const year = Number(sp.year) || new Date().getFullYear();

  const r = await getExpenseReport({ year, department: department === "__none__" ? null : department });
  if (!r.ready) {
    return (
      <div className="fos-shell">
        <PageHeader crumb="Plan — HO" title="Expense Claims" />
        <EmptyState title="One migration to run">
          Expense Claims needs migration <span style={{ fontFamily: "var(--mono)" }}>117_expense_claims.sql</span> (idempotent). Run it, refresh, then upload the Xero expense-claims export.
        </EmptyState>
      </div>
    );
  }
  if (department === "__none__") {
    return (
      <div className="fos-shell">
        <PageHeader crumb="Plan — HO" title="Expense Claims" />
        <EmptyState title="No department on your profile">Ask Finance to set your department in Users &amp; Roles to see your department&rsquo;s expense claims.</EmptyState>
      </div>
    );
  }

  const s = r.summary;
  const years = [...new Set([year, ...r.years])].sort((a, b) => b - a);
  const scopeLabel = department || "All departments";
  const through = s.lastMonth ? MONTHS[s.lastMonth - 1] : null;

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan — HO" title="Expense Claims"
        right={`${scopeLabel} · ${year}${through ? ` · claims to ${through}` : ""} · net of VAT, against the Travel, Expenses & Entertainment budget`} />

      <form method="get" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        {seeAll && (
          <select name="dept" defaultValue={department || ""} style={sel}>
            <option value="">All departments</option>
            {[...new Set([...r.departments, ...s.departments.map((d) => d.department)])].sort().map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select name="year" defaultValue={String(year)} style={sel}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="submit" className="fos-btn" style={{ height: 34 }}>View</button>
      </form>

      {canLoad && <ExpenseTools uploads={r.uploads} unmapped={r.unmapped} departments={r.departments} />}

      {s.lines === 0 ? (
        <EmptyState title={`No expense claims for ${scopeLabel.toLowerCase()} in ${year}`}>
          {canLoad ? "Upload the Xero expense-claims export above." : "Finance load the expense claims from Xero; check back once the next export is in."}
        </EmptyState>
      ) : (
        <>
          <StatRow>
            <Stat label="Claimed (net)" value={money(s.net, { compact: true })} sub={`${s.lines.toLocaleString("en-GB")} lines · ${s.claimants} claimants`} />
            <Stat label="VAT on claims" value={money(s.vat, { compact: true })} sub="reclaimable where receipted" />
            {(() => {
              const withBudget = s.departments.filter((d) => d.budget != null);
              const bud = withBudget.reduce((t, d) => t + d.budget, 0);
              const spent = withBudget.reduce((t, d) => t + d.net, 0);
              return <Stat label="T&E budget" value={withBudget.length ? money(bud, { compact: true }) : "—"}
                sub={withBudget.length ? `${pct(bud ? spent / bud : 0, 0)} used · ${withBudget.length} department${withBudget.length === 1 ? "" : "s"}` : "no T&E budgets set yet"} />;
            })()}
            <Stat label="Over T&E budget" value={s.departments.filter((d) => d.overYtd || d.over).length}
              tone={s.departments.some((d) => d.overYtd || d.over) ? "red" : "green"} sub={through ? `budget to ${through}` : "year to date"} />
          </StatRow>

          <Panel title="By department" note={`claims against each department's Travel, Expenses & Entertainment budget · budget to date = the budget's months to ${through || "date"}`}>
            <Table columns={[
              { label: "Department", render: (d) => (seeAll && !department ? <a href={`?dept=${encodeURIComponent(d.department)}&year=${year}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{d.department}</a> : d.department) },
              { label: "Claimed", align: "right", render: (d) => (
                <>
                  {money(d.net)}
                  {d.teams?.length > 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3, whiteSpace: "normal" }}>
                      {d.teams.map((t) => `${t.key} ${money(t.net, { compact: true })}`).join(" · ")}
                    </div>
                  )}
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

          <Panel title="By month" note="claimed, net of VAT">
            <Table columns={[
              { label: "", render: (row) => row.label },
              ...MONTHS.map((m, i) => ({ label: m, align: "right", render: (row) => (row.values[i] ? money(row.values[i], { compact: true }) : dash) })),
              { label: "Total", align: "right", render: (row) => <strong>{money(row.values.reduce((t, v) => t + (v || 0), 0))}</strong> },
            ]} rows={[
              ...s.departments.filter((d) => d.lines).flatMap((d) => [
                { label: d.teams?.length ? <strong>{d.department}</strong> : d.department, values: d.months },
                // Teams inside the department (Head Office / Store Operations
                // within Operations), indented under it.
                ...(d.teams || []).map((t) => ({ label: <span style={{ paddingLeft: 14, color: "var(--muted)" }}>{t.key}</span>, values: t.months })),
              ]),
              ...(s.departments.filter((d) => d.lines).length > 1 ? [{ label: <strong>Total</strong>, values: s.months.map((m) => m.net) }] : []),
              ...(department && s.departments[0]?.budgetMonths ? [{ label: <span style={{ color: "var(--muted)" }}>T&amp;E budget</span>, values: s.departments[0].budgetMonths }] : []),
            ]} />
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16 }}>
            <Panel title="By category" note="the account each claim was coded to">
              <Table columns={[
                { label: "Category", render: (c) => c.key },
                { label: "Claimed", align: "right", render: (c) => money(c.net) },
                { label: "Share", align: "right", render: (c) => pct(s.net ? c.net / s.net : 0) },
              ]} rows={s.categories} />
            </Panel>
            <Panel title="By claimant">
              <Table columns={[
                { label: "Claimant", render: (c) => c.key },
                { label: "Claimed", align: "right", render: (c) => money(c.net) },
                { label: "Lines", align: "right", render: (c) => c.lines },
              ]} rows={s.claimantsList.slice(0, 25)} />
            </Panel>
            {s.stores.length > 0 && (
              <Panel title="By store" note="Xero Store tracking, where the claim was tagged">
                <Table columns={[
                  { label: "Store", render: (c) => c.key },
                  { label: "Claimed", align: "right", render: (c) => money(c.net) },
                ]} rows={s.stores.slice(0, 25)} />
              </Panel>
            )}
          </div>

          <Panel title={`Claim lines${r.lineCount > r.lines.length ? ` · latest ${r.lines.length} of ${r.lineCount.toLocaleString("en-GB")}` : ` · ${r.lineCount.toLocaleString("en-GB")}`}`} note="latest first">
            <Table columns={[
              { label: "Date", render: (l) => ukDate(l.claim_date) },
              { label: "Claimant", render: (l) => l.claimant },
              { label: "Department", render: (l) => (l.team && l.team !== l.department && !String(l.department).includes("(unmapped)")
                ? <>{l.department}<div style={{ fontSize: 10.5, color: "var(--faint)" }}>{l.team}</div></> : l.department) },
              { label: "Description", render: (l) => <span style={{ whiteSpace: "normal", display: "inline-block", maxWidth: 360 }}>{l.description || "—"}</span> },
              { label: "Category", render: (l) => accountName(l.account_code) },
              { label: "Store", render: (l) => (l.store_tracking ? storeFromTracking(l.store_tracking) : dash) },
              { label: "Net", align: "right", render: (l) => money(l.net_amount) },
              { label: "VAT", align: "right", render: (l) => (l.tax_amount ? money(l.tax_amount) : dash) },
            ]} rows={r.lines} />
          </Panel>
        </>
      )}
    </div>
  );
}

const sel = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontSize: 13 };
