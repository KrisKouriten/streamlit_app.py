/* Pure workflow rules — no imports, unit-testable in plain Node. */

export const STATUSES = [
  "NOT_RELEASED", "AVAILABLE", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_INFORMATION",
  "READY_FOR_REVIEW", "RETURNED", "COMPLETE", "BLOCKED", "OVERDUE", "CANCELLED",
];

// action -> { from: allowed current statuses, to, who: 'assignee'|'manager'|'reviewer' }
export const TRANSITIONS = {
  release:       { from: ["NOT_RELEASED"], to: "AVAILABLE", who: "manager" },
  start:         { from: ["ASSIGNED", "RETURNED", "OVERDUE", "AVAILABLE"], to: "IN_PROGRESS", who: "assignee" },
  wait:          { from: ["IN_PROGRESS"], to: "WAITING_FOR_INFORMATION", who: "assignee" },
  resume:        { from: ["WAITING_FOR_INFORMATION", "BLOCKED"], to: "IN_PROGRESS", who: "assignee" },
  block:         { from: ["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_INFORMATION"], to: "BLOCKED", who: "assignee" },
  submit:        { from: ["IN_PROGRESS", "RETURNED", "OVERDUE"], to: "READY_FOR_REVIEW", who: "assignee" },
  complete:      { from: ["IN_PROGRESS", "RETURNED", "OVERDUE"], to: "COMPLETE", who: "assignee", onlyIfNoReview: true },
  approve:       { from: ["READY_FOR_REVIEW"], to: "COMPLETE", who: "reviewer" },
  return:        { from: ["READY_FOR_REVIEW"], to: "RETURNED", who: "reviewer" },
  cancel:        { from: ["NOT_RELEASED", "AVAILABLE", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_INFORMATION", "BLOCKED", "OVERDUE", "RETURNED"], to: "CANCELLED", who: "manager" },
};

// Pure rule check (unit-tested): returns an error string or null.
export function transitionError(action, task, actor) {
  const rule = TRANSITIONS[action];
  if (!rule) return "Unknown action";
  if (!rule.from.includes(task.status)) return `Cannot ${action} a task that is ${task.status}`;
  if (rule.onlyIfNoReview && task.requires_review) return "This task requires reviewer approval — submit it for review instead";
  const isManager = actor.roles?.includes("ADMIN") || actor.roles?.includes("FINANCE");
  if (rule.who === "manager" && !isManager) return "Manager access required";
  if (rule.who === "assignee" && task.assigned_to !== actor.id && !isManager) return "Only the assignee (or a manager) can do this";
  if (rule.who === "reviewer") {
    const isNamedReviewer = task.reviewer_id && task.reviewer_id === actor.id;
    if (!isNamedReviewer && !isManager) return "Reviewer access required";
    if (task.assigned_to === actor.id && task.reviewer_id !== actor.id)
      return "You cannot review your own task";
  }
  return null;
}

