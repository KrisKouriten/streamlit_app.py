/*
 * Close orchestration — pure rules. No imports, no clock, no DB; the caller
 * gathers machine "signals" (lib/close.js) and passes them in, and these
 * functions turn a period's close into an evaluated plan: which gates the
 * system can prove are met, which are still blocking, and how ready the period
 * is to lock. Unit-tested in tests/close-plan.test.mjs.
 *
 * The design principle: a step the system can CHECK from data is AUTO — it goes
 * green on its own, nobody ticks a box. Only genuinely human judgements
 * (variance sign-off, board pack issued) are MANUAL and wait on a person. A
 * human can also override any step — waive it (NA), force it done, or mark it
 * blocked — and the override always wins over the automatic reading.
 */

// Ordered stages of a monthly close.
export const CLOSE_STAGES = [
  { key: "DATA", label: "Data & feeds" },
  { key: "CHECKS", label: "Pre-close integrity" },
  { key: "WORKSTREAMS", label: "Workstream sign-off" },
  { key: "REVIEW", label: "Review & commentary" },
  { key: "LOCK", label: "Lock & report" },
];

// Freshness tolerance for the feeds behind the close (days). Mirrors the
// DATA_QUALITY agent's tolerance so the two never disagree.
export const FRESHNESS_TOLERANCE_DAYS = 9;

/*
 * The close plan. AUTO steps carry a `check(signals) -> { ok, detail } | { na, detail }`
 * pure predicate; MANUAL steps wait for a human override; the single SYSTEM step
 * reflects the run's own locked state. Order within a stage is the display order.
 */
export const CLOSE_STEPS = [
  {
    code: "actuals_loaded", stage: "DATA", kind: "AUTO",
    label: "Actuals loaded for the period",
    check: (s) => s.actuals?.loaded
      ? { ok: true, detail: `${Number(s.actuals.rows || 0).toLocaleString("en-GB")} nominal lines loaded` }
      : { ok: false, detail: "No actuals are loaded for this period yet" },
  },
  {
    code: "feed_fresh", stage: "DATA", kind: "AUTO",
    label: "Feeds refreshed within tolerance",
    check: (s) => {
      const age = s.freshness?.ageDays;
      if (age == null) return { ok: false, detail: "No successful data load is recorded" };
      return age <= FRESHNESS_TOLERANCE_DAYS
        ? { ok: true, detail: `Latest load ${age}d ago (${s.freshness.source || "feed"})` }
        : { ok: false, detail: `Latest load ${age}d ago — beyond the ${FRESHNESS_TOLERANCE_DAYS}-day tolerance` };
    },
  },
  {
    code: "preclose_clear", stage: "CHECKS", kind: "AUTO",
    label: "No unresolved high-severity exceptions",
    check: (s) => {
      if (!s.preclose?.ready) return { na: true, detail: "Pre-close checks are not configured (migration 012)" };
      const n = s.preclose.unresolvedHigh || 0;
      return n === 0
        ? { ok: true, detail: "All high-severity pre-close exceptions are cleared" }
        : { ok: false, detail: `${n} high-severity exception${n === 1 ? "" : "s"} still open` };
    },
  },
  {
    code: "preclose_reviewed", stage: "CHECKS", kind: "AUTO",
    label: "Every exception dispositioned",
    check: (s) => {
      if (!s.preclose?.ready) return { na: true, detail: "Pre-close checks are not configured (migration 012)" };
      const n = s.preclose.unresolved || 0;
      return n === 0
        ? { ok: true, detail: "All pre-close exceptions have a confirm / explain / correct decision" }
        : { ok: false, detail: `${n} exception${n === 1 ? "" : "s"} awaiting a decision` };
    },
  },
  { code: "pl_playbook", stage: "WORKSTREAMS", kind: "AUTO", label: "P&L workstream complete", check: playbookCheck("PL") },
  { code: "accruals_playbook", stage: "WORKSTREAMS", kind: "AUTO", label: "Accruals workstream complete", check: playbookCheck("ACCRUALS") },
  { code: "fa_playbook", stage: "WORKSTREAMS", kind: "AUTO", label: "Fixed-assets workstream complete", check: playbookCheck("FA") },
  {
    code: "tasks_complete", stage: "REVIEW", kind: "AUTO",
    label: "Month-end tasks complete",
    check: (s) => {
      const open = s.tasks?.open || 0;
      const crit = s.tasks?.overdueCritical || 0;
      if (open === 0) return { ok: true, detail: "No open month-end tasks for the period" };
      return { ok: false, detail: `${open} task${open === 1 ? "" : "s"} still open${crit ? ` (${crit} critical overdue)` : ""}` };
    },
  },
  {
    code: "commentary_drafted", stage: "REVIEW", kind: "AUTO",
    label: "Trading commentary drafted",
    check: (s) => s.commentary?.exists
      ? { ok: true, detail: s.commentary.approved ? "Commentary drafted and approved" : "Commentary drafted — awaiting review" }
      : { ok: false, detail: "No trading commentary has been drafted for the period" },
  },
  {
    code: "variance_reviewed", stage: "REVIEW", kind: "MANUAL",
    label: "Management-accounts variance reviewed",
    hint: "Sign off once the actual-vs-forecast variances have been reviewed",
  },
  {
    code: "board_pack", stage: "LOCK", kind: "MANUAL",
    label: "Board pack produced",
    hint: "Confirm the board pack has been exported and circulated",
  },
  {
    code: "period_locked", stage: "LOCK", kind: "SYSTEM",
    label: "Period locked",
    check: (s) => s.locked
      ? { ok: true, detail: "The period is locked" }
      : { ok: false, detail: "The period is open" },
  },
];

// A workstream playbook is complete when every configured action for the period
// is done. No actions configured → not applicable (never a blocker).
function playbookCheck(workstream) {
  return (s) => {
    const p = s.playbook?.[workstream] || { done: 0, total: 0 };
    if (!p.total) return { na: true, detail: "No playbook actions configured" };
    return p.done >= p.total
      ? { ok: true, detail: `${p.done}/${p.total} actions complete` }
      : { ok: false, detail: `${p.done}/${p.total} actions complete` };
  };
}

const MANUAL_STATUSES = ["DONE", "NA", "BLOCKED"];
const SATISFIED = new Set(["PASS", "DONE", "NA"]);

// Evaluate a single step against the signals and an optional human override.
// An override to DONE / NA / BLOCKED always wins over the automatic reading.
export function evaluateStep(step, signals, override) {
  const base = { code: step.code, stage: step.stage, label: step.label, kind: step.kind };
  if (override && MANUAL_STATUSES.includes(override.status)) {
    return { ...base, status: override.status, detail: override.note || manualDetail(step, override.status), by: override.actor || null, at: override.at || null, overridden: true };
  }
  if (step.check) {
    const r = step.check(signals || {});
    if (r.na) return { ...base, status: "NA", detail: r.detail };
    return { ...base, status: r.ok ? "PASS" : "FAIL", detail: r.detail };
  }
  // MANUAL step, no override yet.
  return { ...base, status: "PENDING", detail: step.hint || "Awaiting sign-off" };
}

function manualDetail(step, status) {
  if (status === "NA") return "Waived — not applicable this period";
  if (status === "BLOCKED") return "Marked blocked";
  return "Signed off";
}

/*
 * Evaluate the whole plan. `overrides` is a map of step_code -> { status, note,
 * actor, at }. Returns the evaluated steps, a per-stage rollup, and overall
 * readiness. `period_locked` is the outcome of locking, not a gate to it, so it
 * is excluded from the readiness gate.
 */
export function evaluatePlan(signals, overrides = {}) {
  const steps = CLOSE_STEPS.map((step) => evaluateStep(step, signals, overrides[step.code]));

  const gate = steps.filter((s) => s.code !== "period_locked");
  const satisfied = gate.filter((s) => SATISFIED.has(s.status));
  const blockers = gate
    .filter((s) => !SATISFIED.has(s.status))
    .map((s) => ({ code: s.code, label: s.label, stage: s.stage, status: s.status, detail: s.detail }));

  const stages = CLOSE_STAGES.map((st) => {
    const inStage = steps.filter((s) => s.stage === st.key);
    const done = inStage.filter((s) => SATISFIED.has(s.status)).length;
    const blocked = inStage.some((s) => s.status === "FAIL" || s.status === "BLOCKED");
    const pending = inStage.some((s) => s.status === "PENDING");
    return {
      key: st.key, label: st.label, steps: inStage,
      done, total: inStage.length,
      status: done === inStage.length ? "COMPLETE" : blocked ? "BLOCKED" : pending ? "PENDING" : "OPEN",
    };
  });

  const score = gate.length ? Math.round((satisfied.length / gate.length) * 100) : 0;
  const lockStatus = steps.find((s) => s.code === "period_locked")?.status;
  const locked = lockStatus === "PASS" || lockStatus === "DONE";

  return {
    steps, stages, blockers, locked,
    ready: blockers.length === 0,
    score,
    satisfied: satisfied.length,
    gateTotal: gate.length,
  };
}

// One-line readiness label for headers and the agent summary.
export function readinessLabel(plan) {
  if (plan.locked) return "Locked";
  if (plan.ready) return "Ready to lock";
  const n = plan.blockers.length;
  return `${n} item${n === 1 ? "" : "s"} outstanding`;
}
