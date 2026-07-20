/* Pure agent-governance rules — no imports, unit-testable in plain Node. */

export const LIFECYCLE = [
  "GENERATED", "AUTOMATED_VALIDATION", "PENDING_REVIEW",
  "APPROVED", "AMENDED", "REJECTED", "ACTION_CREATED", "CLOSED",
];

// decision -> allowed current lifecycle states
export const DECISIONS = {
  approve: { from: ["PENDING_REVIEW"], to: "APPROVED" },
  amend:   { from: ["PENDING_REVIEW"], to: "AMENDED" },
  reject:  { from: ["PENDING_REVIEW"], to: "REJECTED" },
  close:   { from: ["APPROVED", "AMENDED", "REJECTED", "ACTION_CREATED"], to: "CLOSED" },
};

// Returns an error string or null. Reviewer rights: ADMIN or FINANCE.
export function reviewError(decision, output, actor) {
  const rule = DECISIONS[decision];
  if (!rule) return "Unknown decision";
  if (!rule.from.includes(output.lifecycle)) return `Cannot ${decision} an output that is ${output.lifecycle}`;
  const canReview = actor.roles?.includes("ADMIN") || actor.roles?.includes("FINANCE");
  if (!canReview) return "Reviewer access required (ADMIN or FINANCE role)";
  if (decision === "amend" && !(output.amended_headline || output.amended_body)) {
    return "An amendment must change the headline or the narrative";
  }
  return null;
}

// Automated validation applied to every generated output before review.
export function validateOutput(o) {
  const problems = [];
  if (!o.headline?.trim()) problems.push("missing headline");
  if (!o.body?.trim()) problems.push("missing narrative");
  if (o.financial_impact !== null && o.financial_impact !== undefined && !Number.isFinite(Number(o.financial_impact)))
    problems.push("financial impact not numeric");
  if (o.confidence_pct !== null && o.confidence_pct !== undefined && (o.confidence_pct < 0 || o.confidence_pct > 1))
    problems.push("confidence out of range");
  return problems.length ? `FAILED: ${problems.join("; ")}` : "PASSED: structure, numeric fields and confidence in range";
}

// Where an approved output lands in the insight layer.
export const AGENT_DASHBOARD = {
  STORE_PRIORITIES: "STORE_SALES_KPI",
  DATA_QUALITY: "MASTER",
};
