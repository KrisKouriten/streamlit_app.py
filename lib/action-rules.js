/* Pure Action Centre rules — no imports, unit-testable in plain Node. */

export const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETE", "CLOSED", "CANCELLED", "OVERDUE"];

export const SOURCE_TYPES = [
  "DASHBOARD", "MONTH_END", "WEEKLY_TASK", "AI_AGENT",
  "MANAGEMENT_ACCOUNTS", "BOARD", "CONTROL", "AUDIT", "MANUAL",
];

// action -> { from, to, who }. who: 'owner' (owner or manager), 'manager', 'closer'.
export const ACTION_TRANSITIONS = {
  start:    { from: ["OPEN", "OVERDUE"], to: "IN_PROGRESS", who: "owner" },
  complete: { from: ["OPEN", "IN_PROGRESS", "OVERDUE"], to: "COMPLETE", who: "owner" },
  reopen:   { from: ["COMPLETE"], to: "IN_PROGRESS", who: "owner" },
  close:    { from: ["COMPLETE"], to: "CLOSED", who: "closer" },
  cancel:   { from: ["OPEN", "IN_PROGRESS", "OVERDUE", "COMPLETE"], to: "CANCELLED", who: "manager" },
};

// flags: { isOwner, isManager, canClose }. Returns error string or null.
export function actionTransitionError(action, currentStatus, flags) {
  const rule = ACTION_TRANSITIONS[action];
  if (!rule) return "Unknown action";
  if (!rule.from.includes(currentStatus)) return `Cannot ${action} an action that is ${currentStatus}`;
  if (rule.who === "closer" && !flags.canClose) return "Closure approval requires the ADMIN, FINANCE or EXEC role";
  if (rule.who === "manager" && !flags.isManager) return "Manager access required";
  if (rule.who === "owner" && !flags.isManager && !flags.isOwner) return "Only the action owner or a manager can do this";
  return null;
}
