"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MONTHS, MONTH_KEYS, QUARTERS, lineTotal, monthlyTotals, grandTotal, priorYearTotal,
  categoryGroups, variance, budgetSummary, quarterTotals, lineMovers, budgetValidation,
  availableTransitions, STAGE_LABEL, BUDGET_STAGES,
} from "../../../lib/dept-budget-rules";

/* Departmental Budgets — the budget control centre. A budget opens with an
   executive summary (target · proposed · remaining · vs prior year · completion ·
   stage), then a guided journey: Overview (charts, movers, validation, timeline),
   Financial View (the annual/quarterly/monthly grid with per-line commentary), and
   Review & Submit (checks + the approval workflow). The grid is now the Finance
   view, not the front door. */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 16 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 14px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const cellIn = { width: 62, fontSize: 12, padding: "4px 5px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", textAlign: "right" };
const td = { padding: "4px 8px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap" };
const th = { fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--faint)", padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" };
const STAGE_TONE = { DRAFT: "var(--muted)", FINANCE_REVIEW: "var(--amber)", DEPT_APPROVAL: "var(--amber)", SLT_APPROVAL: "var(--amber)", LOCKED: "var(--green)" };
const money0 = (v) => `£${Math.round(Number(v) || 0).toLocaleString("en-GB")}`;
const moneyC = (v) => { const a = Math.abs(Number(v) || 0); const s = (Number(v) || 0) < 0 ? "−" : ""; if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(2)}m`; if (a >= 1e3) return `${s}£${Math.round(a / 1e3)}k`; return `${s}£${Math.round(a)}`; };
const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

export default function DeptBudgetUI({ initialBudgets, departments, myDept, isAdminFinance, me }) {
  const router = useRouter();
  const keyRef = useRef(1);
  const thisYear = new Date().getFullYear();
  const editableDepts = isAdminFinance ? departments : departments.filter((d) => d === myDept);

  const [budgets] = useState(initialBudgets);
  const [selId, setSelId] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState("overview");
  const [viewMode, setViewMode] = useState("annual");
  const [expanded, setExpanded] = useState(null); // line _key with months open
  const [targetDraft, setTargetDraft] = useState("");

  // Create form
  const [nd, setNd] = useState(editableDepts[0] || "");
  const [nyear, setNyear] = useState(thisYear);
  const [nver, setNver] = useState("");

  const status = loaded?.budget?.status;
  const editing = loaded?.canEdit && status === "DRAFT";
  const target = loaded?.budget?.target_amount != null ? Number(loaded.budget.target_amount) : null;

  const groups = useMemo(() => categoryGroups(lines), [lines]);
  const summary = useMemo(() => budgetSummary(target, lines), [target, lines]);
  const monthly = useMemo(() => monthlyTotals(lines), [lines]);
  const movers = useMemo(() => lineMovers(lines), [lines]);
  const issues = useMemo(() => budgetValidation(target, lines), [target, lines]);

  async function api(body) {
    setError(null); setMsg(null); setBusy(true);
    const res = await fetch("/api/plan/dept-budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error || "Action failed"); return null; }
    return j;
  }

  async function loadBudget(id) {
    setError(null); setMsg(null);
    const res = await fetch(`/api/plan/dept-budget?id=${id}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error || "Could not load budget"); return; }
    setSelId(id);
    setLoaded(j);
    setLines((j.lines || []).map((r) => ({ _key: keyRef.current++, ...r })));
    setTargetDraft(j.budget?.target_amount != null ? String(j.budget.target_amount) : "");
    setDirty(false); setExpanded(null); setTab("overview");
  }

  async function createBudget() {
    if (!nd) { setError("Choose a department"); return; }
    const r = await api({ action: "create", department: nd, budget_year: Number(nyear), version_label: nver });
    if (r) { setNver(""); await loadBudget(r.budgetId); router.refresh(); }
  }

  function upd(key, field, value) { setLines((ls) => ls.map((l) => (l._key === key ? { ...l, [field]: value } : l))); setDirty(true); }
  function addLine(category) { setLines((ls) => [...ls, { _key: keyRef.current++, category, line_label: "", prior_year: 0, commentary: "", ...Object.fromEntries(MONTH_KEYS.map((k) => [k, 0])) }]); setDirty(true); }
  function addCategory() { const n = window.prompt("New category name"); if (n && n.trim()) addLine(n.trim()); }
  function removeLine(key) { setLines((ls) => ls.filter((l) => l._key !== key)); setDirty(true); }
  function spread(key) {
    const line = lines.find((l) => l._key === key);
    const raw = window.prompt("Spread what full-year amount evenly across the 12 months?", String(lineTotal(line)));
    if (raw == null) return;
    const annual = Number(String(raw).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(annual)) { setError("Enter a number"); return; }
    const cents = Math.round(annual * 100), base = Math.trunc(cents / 12);
    let rem = cents - base * 12; const step = rem < 0 ? -1 : 1; rem = Math.abs(rem);
    const vals = MONTH_KEYS.map((_, i) => Math.round(base + (i < rem ? step : 0)) / 100);
    setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...Object.fromEntries(MONTH_KEYS.map((k, i) => [k, vals[i]])) } : l)));
    setDirty(true);
  }
  function setAnnual(key, value) {
    // Typing a full-year figure in Annual view spreads it evenly across months.
    const annual = Number(String(value).replace(/[^0-9.-]/g, "")) || 0;
    const cents = Math.round(annual * 100), base = Math.trunc(cents / 12);
    let rem = cents - base * 12; const step = rem < 0 ? -1 : 1; rem = Math.abs(rem);
    const vals = MONTH_KEYS.map((_, i) => Math.round(base + (i < rem ? step : 0)) / 100);
    setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...Object.fromEntries(MONTH_KEYS.map((k, i) => [k, vals[i]])) } : l)));
    setDirty(true);
  }

  async function save() {
    const payload = lines.map((l, i) => ({
      category: l.category || "General", line_label: l.line_label, sort_order: i * 10,
      prior_year: Number(l.prior_year) || 0, commentary: l.commentary || "",
      ...Object.fromEntries(MONTH_KEYS.map((k) => [k, Number(l[k]) || 0])),
    }));
    if (payload.some((l) => !String(l.line_label).trim())) { setError("Every cost line needs a name"); return; }
    const r = await api({ action: "save-lines", budgetId: selId, lines: payload });
    if (r) { setDirty(false); setMsg("Saved."); }
  }
  async function saveTarget() {
    const r = await api({ action: "set-target", budgetId: selId, target: targetDraft });
    if (r) { await loadBudget(selId); router.refresh(); }
  }
  async function transition(t, needsNote) {
    let note = null;
    if (needsNote) { note = window.prompt("Add a note for this step (optional)") || null; }
    const r = await api({ action: "transition", budgetId: selId, transition: t, note });
    if (r) { await loadBudget(selId); router.refresh(); }
  }
  async function del() {
    if (!window.confirm("Delete this budget version? This cannot be undone.")) return;
    const r = await api({ action: "delete", budgetId: selId });
    if (r) { setSelId(null); setLoaded(null); setLines([]); router.refresh(); }
  }

  const TABS = [["overview", "Overview"], ["financial", "Financial View"], ["review", "Review & Submit"]];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 18, alignItems: "start" }}>
      {/* Left — create + pick */}
      <div>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 10 }}>New budget</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={labelSt}>Department</span>
              <select value={nd} onChange={(e) => setNd(e.target.value)} style={inputSt} disabled={!editableDepts.length}>
                {editableDepts.length ? editableDepts.map((d) => <option key={d} value={d}>{d}</option>) : <option>No department assigned</option>}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={labelSt}>Budget year</span>
              <input type="number" value={nyear} onChange={(e) => setNyear(e.target.value)} style={inputSt} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={labelSt}>Version label</span>
              <input value={nver} onChange={(e) => setNver(e.target.value)} placeholder="Working draft" style={inputSt} />
            </label>
            <button onClick={createBudget} disabled={busy || !editableDepts.length} style={btn("var(--accent)")}>Create from template</button>
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 10 }}>Budgets</div>
          {!budgets.length && <div style={{ fontSize: 12.5, color: "var(--faint)" }}>None yet.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {budgets.map((b) => (
              <button key={b.budget_id} onClick={() => loadBudget(b.budget_id)}
                style={{ textAlign: "left", padding: "8px 10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${selId === b.budget_id ? "var(--accent)" : "var(--line)"}`, background: selId === b.budget_id ? "var(--accent-bg)" : "transparent" }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.department} · {b.budget_year}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                  <span>{b.version_label}</span>
                  <span style={{ color: STAGE_TONE[b.status] || "var(--muted)", fontWeight: 600 }}>{STAGE_LABEL[b.status] || b.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right — control centre */}
      <div>
        {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

        {!loaded ? (
          <div style={{ ...card, color: "var(--faint)", fontSize: 13 }}>Pick a budget on the left, or create one, to open the control centre.</div>
        ) : (
          <>
            {/* Executive summary strip */}
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{loaded.budget.department} — {loaded.budget.budget_year} <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted)" }}>· {loaded.budget.version_label}</span></div>
                <StageBar status={status} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
                <SummaryTile label="Target" value={summary.target != null ? moneyC(summary.target) : "—"} sub={summary.target == null ? "not set" : "envelope"} />
                <SummaryTile label="Proposed" value={moneyC(summary.proposed)} sub="entered" />
                <SummaryTile label="Remaining" value={summary.remaining != null ? moneyC(summary.remaining) : "—"} sub={summary.remaining != null ? (summary.remaining < 0 ? "over target" : "to allocate") : "set a target"} tone={summary.remaining != null && summary.remaining < 0 ? "var(--red)" : undefined} />
                <SummaryTile label="Prior year" value={moneyC(summary.priorYear)} sub="actual" />
                <SummaryTile label="vs Prior yr" value={`${summary.vsPriorAbs >= 0 ? "+" : ""}${moneyC(summary.vsPriorAbs)}`} sub={summary.vsPriorPct != null ? `${summary.vsPriorPct >= 0 ? "+" : ""}${summary.vsPriorPct}%` : "—"} tone={summary.vsPriorAbs > 0 ? "var(--amber)" : "var(--green)"} />
                <SummaryTile label="Completion" value={`${summary.completion}%`} sub={`${issues.length} to review`} tone={issues.length ? "var(--amber)" : "var(--green)"} />
              </div>
              {loaded.isFinance && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <span style={labelSt}>Set target £</span>
                  <input value={targetDraft} onChange={(e) => setTargetDraft(e.target.value)} placeholder="e.g. 1200000" inputMode="decimal" style={{ ...inputSt, width: 140 }} />
                  <button onClick={saveTarget} disabled={busy} style={ghost}>Save target</button>
                  <span style={{ fontSize: 11, color: "var(--faint)" }}>Finance sets the top-down envelope.</span>
                </div>
              )}
            </div>

            {/* Journey tabs */}
            <div style={{ display: "inline-flex", gap: 3, marginBottom: 16, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
              {TABS.map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ fontSize: 12.5, fontWeight: tab === k ? 650 : 500, padding: "6px 13px", borderRadius: 7, border: `1px solid ${tab === k ? "var(--line-strong)" : "transparent"}`, background: tab === k ? "var(--surface)" : "transparent", color: tab === k ? "var(--ink)" : "var(--muted)", cursor: "pointer" }}>{l}</button>
              ))}
            </div>

            {tab === "overview" && <Overview lines={lines} monthly={monthly} groups={groups} movers={movers} issues={issues} summary={summary} events={loaded.events || []} approvers={loaded.approvers || []} onGoFinancial={() => setTab("financial")} />}

            {tab === "financial" && (
              <FinancialView
                lines={lines} groups={groups} monthly={monthly} editing={editing} viewMode={viewMode} setViewMode={setViewMode}
                expanded={expanded} setExpanded={setExpanded} upd={upd} setAnnual={setAnnual} spread={spread} addLine={addLine} addCategory={addCategory} removeLine={removeLine}
                dirty={dirty} busy={busy} onSave={save}
                lockedNote={!editing ? (loaded.canEdit ? "Locked while in review — return it to draft to edit." : "Read-only. You can view but not edit this department's budget.") : null}
              />
            )}

            {tab === "review" && (
              <ReviewSubmit
                status={status} issues={issues} summary={summary} allowed={loaded.allowed || {}} approvers={loaded.approvers || []}
                dirty={dirty} busy={busy} onTransition={transition} canEdit={loaded.canEdit} onDelete={del}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, sub, tone }) {
  return (
    <div style={{ background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={labelSt}>{label}</div>
      <div className="fos-num" style={{ fontSize: 19, fontWeight: 700, marginTop: 5, color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function StageBar({ status }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {BUDGET_STAGES.map((s, i) => {
        const done = BUDGET_STAGES.indexOf(status) > i;
        const on = s === status;
        return (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, padding: "3px 8px", borderRadius: 7, background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : done ? "var(--muted)" : "var(--faint)", border: `1px solid ${on ? "var(--accent)" : "var(--line)"}` }}>{STAGE_LABEL[s]}</span>
            {i < BUDGET_STAGES.length - 1 && <span style={{ color: "var(--faint)", fontSize: 10 }}>→</span>}
          </span>
        );
      })}
    </div>
  );
}

function Overview({ lines, monthly, groups, movers, issues, summary, events, approvers, onGoFinancial }) {
  const maxMonth = Math.max(1, ...monthly.map((m) => Math.abs(m)));
  const maxCat = Math.max(1, ...groups.map((g) => Math.abs(g.subtotal)));
  const moverRow = (r, tone) => (
    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid var(--hairline)" }}>
      <span style={{ color: "var(--muted)" }}>{r.label}</span>
      <span style={{ color: tone, fontWeight: 600 }}>{r.delta >= 0 ? "+" : ""}{money0(r.delta)}</span>
    </div>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Monthly profile */}
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Monthly spend profile</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 120 }}>
            {monthly.map((m, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div title={money0(m)} style={{ width: "100%", height: `${(Math.abs(m) / maxMonth) * 96}px`, minHeight: 2, background: "linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 55%, transparent))", borderRadius: "3px 3px 0 0" }} />
                <span style={{ fontSize: 8.5, color: "var(--faint)" }}>{MONTHS[i][0]}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>Budget phasing across the year. Prior year is shown as a total (no monthly history feed yet).</div>
        </div>
        {/* Category breakdown */}
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Spend by category</div>
          {groups.length ? groups.map((g) => (
            <div key={g.category} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: "var(--muted)" }}>{g.category}</span>
                <span style={{ fontWeight: 600 }}>{money0(g.subtotal)}</span>
              </div>
              <div style={{ height: 6, background: "var(--raise)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${(Math.abs(g.subtotal) / maxCat) * 100}%`, height: "100%", background: "var(--accent)" }} /></div>
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No lines yet.</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>Top increases vs prior year</div>
          {movers.up.length ? movers.up.map((r) => moverRow(r, "var(--amber)")) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>None.</div>}
        </div>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>Top reductions vs prior year</div>
          {movers.down.length ? movers.down.map((r) => moverRow(r, "var(--green)")) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>None.</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>Validation <span style={{ fontSize: 11.5, fontWeight: 400, color: issues.length ? "var(--amber)" : "var(--green)" }}>· {issues.length ? `${issues.length} to review` : "all clear"}</span></div>
          {issues.length ? issues.slice(0, 8).map((v, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--muted)", padding: "4px 0", borderBottom: "1px solid var(--hairline)" }}>⚠ {v.message}</div>
          )) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No outstanding validation issues.</div>}
          <button onClick={onGoFinancial} style={{ ...ghost, marginTop: 10 }}>Open the Financial View →</button>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>Approval timeline</div>
          {events.length ? [...events].reverse().slice(0, 8).map((e, i) => (
            <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--hairline)" }}>
              <span style={{ fontWeight: 600 }}>{(e.event_type || "").replace(/_/g, " ")}</span>
              <span style={{ color: "var(--faint)" }}> · {e.actor} · {dmy(e.created_at)}</span>
              {e.note && <div style={{ color: "var(--muted)", fontStyle: "italic" }}>“{e.note}”</div>}
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No workflow activity yet.</div>}
          {!!approvers.length && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>Department sign-off: {approvers.join(", ")}</div>}
        </div>
      </div>
    </div>
  );
}

function FinancialView({ lines, groups, monthly, editing, viewMode, setViewMode, expanded, setExpanded, upd, setAnnual, spread, addLine, addCategory, removeLine, dirty, busy, onSave, lockedNote }) {
  const VIEWS = [["annual", "Annual"], ["quarterly", "Quarterly"], ["monthly", "Monthly"]];
  const gTotal = grandTotal(lines);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 9 }}>
          {VIEWS.map(([k, l]) => (
            <button key={k} onClick={() => setViewMode(k)} style={{ fontSize: 12, fontWeight: viewMode === k ? 650 : 500, padding: "5px 11px", borderRadius: 6, border: "none", background: viewMode === k ? "var(--surface)" : "transparent", color: viewMode === k ? "var(--ink)" : "var(--muted)", cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        {editing && <button onClick={onSave} disabled={busy || !dirty} style={btn(dirty ? "var(--accent)" : "var(--line)", dirty ? "#fff" : "var(--faint)")}>Save</button>}
      </div>
      {lockedNote && <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 10 }}>{lockedNote}</div>}

      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: viewMode === "monthly" ? 1080 : 640 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ ...th, textAlign: "left", minWidth: 190 }}>Cost line</th>
              <th style={th}>Prior yr</th>
              {viewMode === "annual" && (<><th style={{ ...th, color: "var(--ink)" }}>Proposed</th><th style={th}>Δ £</th><th style={th}>Δ %</th></>)}
              {viewMode === "quarterly" && (<>{QUARTERS.map(([q]) => <th key={q} style={th}>{q}</th>)}<th style={{ ...th, color: "var(--ink)" }}>FY</th></>)}
              {viewMode === "monthly" && (<>{MONTHS.map((m) => <th key={m} style={th}>{m}</th>)}<th style={{ ...th, color: "var(--ink)" }}>FY</th></>)}
              {editing && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <CategoryBand key={g.category} group={g} viewMode={viewMode} editing={editing}
                expanded={expanded} setExpanded={setExpanded} upd={upd} setAnnual={setAnnual} spread={spread} removeLine={removeLine} addLine={addLine} />
            ))}
            <tr style={{ borderTop: "2px solid var(--line)", background: "var(--raise)" }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>Grand total</td>
              <td style={{ ...td, color: "var(--muted)" }}>{money0(priorYearTotal(lines))}</td>
              {viewMode === "annual" && (<><td style={{ ...td, fontWeight: 800 }}>{money0(gTotal)}</td><td style={td}></td><td style={td}></td></>)}
              {viewMode === "quarterly" && (<>{[0, 1, 2, 3].map((qi) => <td key={qi} style={{ ...td, fontWeight: 600 }}>{money0(lines.reduce((t, l) => t + quarterTotals(l)[qi], 0))}</td>)}<td style={{ ...td, fontWeight: 800 }}>{money0(gTotal)}</td></>)}
              {viewMode === "monthly" && (<>{monthly.map((m, i) => <td key={i} style={{ ...td, fontWeight: 600 }}>{money0(m)}</td>)}<td style={{ ...td, fontWeight: 800 }}>{money0(gTotal)}</td></>)}
              {editing && <td style={td}></td>}
            </tr>
          </tbody>
        </table>
      </div>
      {editing && <button onClick={addCategory} style={ghost}>+ Add category</button>}
    </div>
  );
}

function CategoryBand({ group, viewMode, editing, expanded, setExpanded, upd, setAnnual, spread, removeLine, addLine }) {
  const cols = viewMode === "monthly" ? 12 : viewMode === "quarterly" ? 4 : 3;
  const span = 2 + cols + (editing ? 1 : 0);
  return (
    <>
      <tr style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
        <td colSpan={span} style={{ ...td, textAlign: "left", fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent)", padding: "7px 8px" }}>{group.category}</td>
      </tr>
      {group.lines.map((line) => {
        const total = lineTotal(line), v = variance(total, line.prior_year), q = quarterTotals(line);
        const open = expanded === line._key;
        return (
          <FragmentRow key={line._key}>
            <tr style={{ borderBottom: open ? "none" : "1px solid var(--hairline)" }}>
              <td style={{ ...td, textAlign: "left" }}>
                {editing
                  ? <input value={line.line_label} onChange={(e) => upd(line._key, "line_label", e.target.value)} placeholder="Cost line" style={{ ...inputSt, width: 172, padding: "4px 7px", fontSize: 12 }} />
                  : <span style={{ fontSize: 12.5 }}>{line.line_label}</span>}
                {String(line.commentary || "").trim() && <span title={line.commentary} style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)" }}>✎</span>}
              </td>
              <td style={{ ...td, color: "var(--muted)" }}>{Number(line.prior_year) ? money0(line.prior_year) : "—"}</td>
              {viewMode === "annual" && (
                <>
                  <td style={{ ...td }}>
                    {editing
                      ? <input value={total === 0 ? "" : total} onChange={(e) => setAnnual(line._key, e.target.value)} inputMode="decimal" style={{ ...cellIn, width: 84 }} title="Full-year — spreads evenly across months" />
                      : <span style={{ fontWeight: 700 }}>{money0(total)}</span>}
                  </td>
                  <td style={{ ...td, color: v.abs > 0 ? "var(--amber)" : v.abs < 0 ? "var(--green)" : "var(--faint)" }}>{v.abs ? `${v.abs > 0 ? "+" : ""}${money0(v.abs)}` : "—"}</td>
                  <td style={{ ...td, color: "var(--faint)" }}>{v.pct != null ? `${v.pct >= 0 ? "+" : ""}${v.pct}%` : "—"}</td>
                </>
              )}
              {viewMode === "quarterly" && (<>{q.map((qv, i) => <td key={i} style={{ ...td, color: "var(--muted)" }}>{qv ? money0(qv) : "—"}</td>)}<td style={{ ...td, fontWeight: 700 }}>{money0(total)}</td></>)}
              {viewMode === "monthly" && (
                <>
                  {MONTH_KEYS.map((k) => (
                    <td key={k} style={{ ...td, padding: "2px 3px" }}>
                      {editing ? <input value={line[k] === 0 ? "" : line[k]} onChange={(e) => upd(line._key, k, e.target.value)} inputMode="decimal" style={cellIn} /> : <span>{Number(line[k]) ? money0(line[k]) : "—"}</span>}
                    </td>
                  ))}
                  <td style={{ ...td, fontWeight: 700 }}>{money0(total)}</td>
                </>
              )}
              {editing && (
                <td style={{ ...td, padding: "2px 4px" }}>
                  <span style={{ display: "inline-flex", gap: 3 }}>
                    <button title="Detail: months + commentary" onClick={() => setExpanded(open ? null : line._key)} style={{ ...ghost, padding: "2px 6px" }}>{open ? "▾" : "▸"}</button>
                    {viewMode !== "monthly" && <button title="Spread a full-year amount" onClick={() => spread(line._key)} style={{ ...ghost, padding: "2px 6px" }}>≡</button>}
                    <button title="Remove line" onClick={() => removeLine(line._key)} style={{ ...ghost, padding: "2px 6px", color: "var(--red)" }}>×</button>
                  </span>
                </td>
              )}
            </tr>
            {open && editing && (
              <tr style={{ borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                <td colSpan={2 + cols + 1} style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {MONTHS.map((m, i) => (
                      <label key={m} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 8.5, color: "var(--faint)", textAlign: "center" }}>{m}</span>
                        <input value={line[MONTH_KEYS[i]] === 0 ? "" : line[MONTH_KEYS[i]]} onChange={(e) => upd(line._key, MONTH_KEYS[i], e.target.value)} inputMode="decimal" style={cellIn} />
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={labelSt}>Prior-year actual (£) & commentary</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <input value={line.prior_year === 0 ? "" : line.prior_year} onChange={(e) => upd(line._key, "prior_year", e.target.value)} inputMode="decimal" placeholder="Prior year" style={{ ...cellIn, width: 100 }} />
                      <textarea value={line.commentary || ""} onChange={(e) => upd(line._key, "commentary", e.target.value)} placeholder="Business purpose / explanation of change (required for material lines)" rows={2} style={{ ...inputSt, flex: 1, minWidth: 240, resize: "vertical" }} />
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </FragmentRow>
        );
      })}
      {editing && (
        <tr style={{ borderBottom: "1px solid var(--line)" }}>
          <td colSpan={span} style={{ ...td, textAlign: "left" }}>
            <button onClick={() => addLine(group.category)} style={{ ...ghost, padding: "2px 8px" }}>+ line in {group.category}</button>
          </td>
        </tr>
      )}
    </>
  );
}

// A fragment wrapper so a line can render its row + optional detail row.
function FragmentRow({ children }) { return <>{children}</>; }

function ReviewSubmit({ status, issues, summary, allowed, approvers, dirty, busy, onTransition, canEdit, onDelete }) {
  const avail = availableTransitions(status).filter((t) => allowed[t.action]);
  const check = (ok, label) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 0" }}>
      <span style={{ color: ok ? "var(--green)" : "var(--amber)" }}>{ok ? "✓" : "⚠"}</span><span>{label}</span>
    </div>
  );
  const overTarget = summary.target != null && summary.proposed > summary.target;
  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>Pre-submission checks</div>
        {check(summary.completion === 100, `Completion ${summary.completion}%`)}
        {check(!issues.some((i) => i.code === "missing_commentary"), "Material lines have commentary")}
        {check(!overTarget, summary.target != null ? (overTarget ? `Over target by ${money0(summary.proposed - summary.target)}` : "Within target") : "No target set (optional)")}
        {check(!issues.some((i) => i.code === "unnamed_line"), "All lines named")}
        {issues.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            {issues.map((v, i) => <div key={i} style={{ padding: "2px 0" }}>⚠ {v.message}</div>)}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 4 }}>Workflow</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
          Current stage: <strong>{STAGE_LABEL[status] || status}</strong>. Department sign-off: {approvers.length ? approvers.join(", ") : "none assigned"}.
        </div>
        {dirty && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 10 }}>You have unsaved grid changes — save them in the Financial View before submitting.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {avail.length ? avail.map((t) => {
            const returning = t.to === "DRAFT";
            const primary = !returning;
            return (
              <button key={t.action} disabled={busy || (dirty && t.action === "submit_to_finance")}
                onClick={() => onTransition(t.action, returning)}
                style={primary ? btn(t.action === "slt_approve" ? "var(--green)" : "var(--accent)") : ghost}>{t.label}</button>
            );
          }) : <span style={{ fontSize: 12.5, color: "var(--faint)" }}>No actions available to you at this stage.</span>}
          {canEdit && <button onClick={onDelete} disabled={busy} style={{ ...ghost, color: "var(--red)", borderColor: "var(--red)", marginLeft: "auto" }}>Delete</button>}
        </div>
      </div>
    </div>
  );
}
