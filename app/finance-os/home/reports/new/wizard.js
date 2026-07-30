"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const COMPARATORS = ["LATEST_FORECAST", "BUDGET", "PRIOR_FORECAST", "PRIOR_YEAR", "LIKE_FOR_LIKE", "TARGET", "RUN_RATE", "SCENARIO"];
const UNITS = [["GBP", "£ (full)"], ["GBP_000", "£'000"], ["GBP_M", "£m"]];
const CONF = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "BOARD", "RESTRICTED"];

const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };

export default function Wizard({ templates, selected, defaults, owner, deptBudgetTemplate = null, budgets = [], myDepartment = null, canPickAnyDept = true }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Departments a budget can be chosen from: those with an existing budget, plus
  // the caller's own. A budget holder (not finance/admin) is pinned to theirs.
  const departments = useMemo(() => {
    const set = new Set(budgets.map((b) => b.department).filter(Boolean));
    if (myDepartment) set.add(myDepartment);
    const all = Array.from(set).sort((a, b) => a.localeCompare(b));
    return canPickAnyDept ? all : all.filter((d) => d === myDepartment);
  }, [budgets, myDepartment, canPickAnyDept]);

  const defaultDept = (myDepartment && departments.includes(myDepartment)) ? myDepartment : (departments[0] || "");

  const [f, setF] = useState({
    templateKey: selected || templates[0]?.key,
    title: defaults ? `${defaults.name} — ${new Date().toISOString().slice(0, 7)}` : "",
    reportingPeriod: new Date().toISOString().slice(0, 7),
    dataThroughDate: new Date().toISOString().slice(0, 10),
    comparator: "LATEST_FORECAST",
    displayUnits: "GBP",
    confidentiality: defaults?.confidentiality || "INTERNAL",
    audience: defaults?.audience || "",
    owner: owner || "",
    reviewer: "",
    approver: "",
    expectedIssueDate: "",
    department: defaultDept,
    budgetId: "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const isDeptBudget = deptBudgetTemplate && f.templateKey === deptBudgetTemplate;

  // Budgets for the chosen department, newest first. "" = latest for the department.
  const deptBudgets = useMemo(
    () => budgets.filter((b) => b.department === f.department).sort((a, b) => (b.year - a.year) || String(b.versionLabel).localeCompare(String(a.versionLabel))),
    [budgets, f.department]
  );

  function onTemplate(e) {
    const key = e.target.value;
    const t = templates.find((x) => x.key === key);
    setF((s) => ({
      ...s, templateKey: key,
      confidentiality: t?.confidentiality || s.confidentiality,
      audience: t?.audience || s.audience,
      title: t ? `${t.name} — ${s.reportingPeriod}` : s.title,
      // Landing on the budget pack: default to the caller's department; clear a
      // stale budget pick so it doesn't carry across departments.
      department: key === deptBudgetTemplate ? (s.department || defaultDept) : s.department,
      budgetId: "",
    }));
  }

  function onDepartment(e) {
    const department = e.target.value;
    setF((s) => ({ ...s, department, budgetId: "" }));
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      // Only carry the departmental-budget scope for the pack that uses it.
      const payload = { ...f };
      if (!isDeptBudget) { delete payload.department; delete payload.budgetId; }
      else if (!payload.budgetId) delete payload.budgetId; // "" → latest for department
      const res = await fetch("/api/reports-centre", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not create report");
      router.push(`/finance-os/home/reports/${j.reportId}`);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="fos-card" style={{ padding: "20px 22px", maxWidth: 760 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
        <label style={field}><span style={labelSt}>Template</span>
          <select style={inputSt} value={f.templateKey} onChange={onTemplate}>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <label style={field}><span style={labelSt}>Report title</span><input style={inputSt} value={f.title} onChange={set("title")} /></label>
        <label style={field}><span style={labelSt}>Reporting period</span><input style={inputSt} value={f.reportingPeriod} onChange={set("reportingPeriod")} placeholder="2026-W30 or 2026-06" /></label>
        <label style={field}><span style={labelSt}>Data through</span><input type="date" style={inputSt} value={f.dataThroughDate} onChange={set("dataThroughDate")} /></label>
        <label style={field}><span style={labelSt}>Comparison basis</span>
          <select style={inputSt} value={f.comparator} onChange={set("comparator")}>{COMPARATORS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
        </label>
        <label style={field}><span style={labelSt}>Display units</span>
          <select style={inputSt} value={f.displayUnits} onChange={set("displayUnits")}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label style={field}><span style={labelSt}>Confidentiality</span>
          <select style={inputSt} value={f.confidentiality} onChange={set("confidentiality")}>{CONF.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <label style={field}><span style={labelSt}>Audience</span><input style={inputSt} value={f.audience} onChange={set("audience")} /></label>
        <label style={field}><span style={labelSt}>Owner</span><input style={inputSt} value={f.owner} onChange={set("owner")} /></label>
        <label style={field}><span style={labelSt}>Reviewer</span><input style={inputSt} value={f.reviewer} onChange={set("reviewer")} /></label>
        <label style={field}><span style={labelSt}>Approver</span><input style={inputSt} value={f.approver} onChange={set("approver")} /></label>
        <label style={field}><span style={labelSt}>Expected issue date</span><input type="date" style={inputSt} value={f.expectedIssueDate} onChange={set("expectedIssueDate")} /></label>
      </div>

      {/* Departmental Budget Pack — choose which departmental budget the pack is built from. */}
      {isDeptBudget && (
        <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--raise)" }}>
          <div style={{ ...labelSt, marginBottom: 4 }}>Departmental budget</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            The pack is built from this department&rsquo;s approved budget — the same figures behind Dashboards &rsaquo; Departmental Budgets and its P.O approvals.
          </div>
          {departments.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--amber)" }}>
              No departmental budgets exist yet. Create one under Plan &rsaquo; Departmental Budgets first.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <label style={field}><span style={labelSt}>Department</span>
                <select style={inputSt} value={f.department} onChange={onDepartment} disabled={!canPickAnyDept}>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {!canPickAnyDept && <span style={{ fontSize: 11, color: "var(--faint)" }}>Your department.</span>}
              </label>
              <label style={field}><span style={labelSt}>Budget version</span>
                <select style={inputSt} value={f.budgetId} onChange={set("budgetId")}>
                  <option value="">Latest for department</option>
                  {deptBudgets.map((b) => <option key={b.budgetId} value={b.budgetId}>{b.year} · {b.versionLabel} · {b.status}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 14 }}>{error}</div>}
      <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={submit} disabled={busy} style={{ fontSize: 13.5, fontWeight: 650, padding: "9px 18px", borderRadius: 9, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent,#fff)", cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Creating…" : "Create draft & open builder"}
        </button>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>Sections, data sources and AI commentary are set in the builder.</span>
      </div>
    </div>
  );
}
