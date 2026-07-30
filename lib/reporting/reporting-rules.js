/*
 * Corporate Reporting Centre — pure rules. No imports, no DB, no React. The
 * report lifecycle state machine, the create-report validator, section
 * include/exclude/reorder, display-unit formatting and version labelling all
 * live here so the "shape and rules of a report" are unit-tested independently
 * of the database. Mirrors the forecast-version-rules pattern. Unit-tested in
 * tests/reporting-rules.test.mjs.
 */

// The controlled report statuses (CR §14), in lifecycle order.
export const REPORT_STATUSES = [
  "DRAFT", "DATA_PENDING", "COMMENTARY_PENDING", "REVIEW_READY", "IN_REVIEW",
  "RETURNED", "APPROVAL_READY", "APPROVED", "ISSUED", "SUPERSEDED", "ARCHIVED", "CANCELLED",
];

// Statuses where the report content may still be edited. Once APPROVED the
// version is locked — an approved report must not change silently (CR §15).
export const EDITABLE_STATUSES = new Set(["DRAFT", "DATA_PENDING", "COMMENTARY_PENDING", "RETURNED"]);
export const LOCKED_STATUSES = new Set(["APPROVED", "ISSUED", "SUPERSEDED", "ARCHIVED", "CANCELLED"]);

export function isEditable(status) {
  return EDITABLE_STATUSES.has(status);
}

// The lifecycle transitions. Each action lists the statuses it is allowed from
// and the status it moves to. Approval and issue are the governed gates.
export const REPORT_TRANSITIONS = {
  submit_for_review: { from: ["DRAFT", "DATA_PENDING", "COMMENTARY_PENDING", "RETURNED"], to: "REVIEW_READY" },
  start_review:      { from: ["REVIEW_READY"], to: "IN_REVIEW" },
  return:            { from: ["IN_REVIEW", "APPROVAL_READY"], to: "RETURNED" },
  ready_for_approval:{ from: ["IN_REVIEW"], to: "APPROVAL_READY" },
  approve:           { from: ["APPROVAL_READY"], to: "APPROVED" },
  issue:             { from: ["APPROVED"], to: "ISSUED" },
  supersede:         { from: ["APPROVED", "ISSUED"], to: "SUPERSEDED" },
  archive:           { from: ["DRAFT", "RETURNED", "APPROVED", "ISSUED", "SUPERSEDED", "CANCELLED"], to: "ARCHIVED" },
  cancel:            { from: ["DRAFT", "DATA_PENDING", "COMMENTARY_PENDING", "REVIEW_READY", "IN_REVIEW", "RETURNED", "APPROVAL_READY"], to: "CANCELLED" },
  // Reopen pulls a cancelled report back to an editable draft (CR §14 — a cancel
  // is recoverable, not terminal; only ARCHIVED is terminal). Audited like any
  // other transition; the version history is preserved.
  reopen:            { from: ["CANCELLED"], to: "DRAFT" },
};

// Returns null if the action is allowed from the current status, else a reason.
// `validationFailed` blocks the two gates that must never pass a failed report
// (CR §13: a report with failed validation must not be issued as final).
export function reportTransitionError(action, status, { validationFailed = false } = {}) {
  const t = REPORT_TRANSITIONS[action];
  if (!t) return `Unknown action '${action}'`;
  if (!REPORT_STATUSES.includes(status)) return `Unknown status '${status}'`;
  if (!t.from.includes(status)) return `Cannot ${action.replace(/_/g, " ")} a report that is ${status.replace(/_/g, " ").toLowerCase()}`;
  if (validationFailed && (action === "ready_for_approval" || action === "approve" || action === "issue")) {
    return "Validation has failed — resolve the failed checks before this step";
  }
  return null;
}

export const CLASSIFICATIONS = ["CORPORATE", "TEAM", "PERSONAL"];
export const CONFIDENTIALITY = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "BOARD", "RESTRICTED"];
export const DISPLAY_UNITS = ["GBP", "GBP_000", "GBP_M"];
export const COMPARATORS = ["BUDGET", "LATEST_FORECAST", "PRIOR_FORECAST", "PRIOR_YEAR", "LIKE_FOR_LIKE", "TARGET", "RUN_RATE", "SCENARIO"];

// Validate the details captured in Step 1 of the creation wizard. Returns an
// error string or null (matching the validateVersion convention).
export function validateReportInput({ templateKey, title, reportingPeriod, confidentiality, displayUnits, comparator } = {}) {
  if (!templateKey || !String(templateKey).trim()) return "Choose a report template";
  if (!title || !String(title).trim()) return "A report needs a title";
  if (String(title).trim().length > 200) return "Title is too long (max 200)";
  if (!reportingPeriod || !String(reportingPeriod).trim()) return "Set the reporting period";
  if (confidentiality && !CONFIDENTIALITY.includes(confidentiality)) return "Unknown confidentiality classification";
  if (displayUnits && !DISPLAY_UNITS.includes(displayUnits)) return "Unknown display units";
  if (comparator && !COMPARATORS.includes(comparator)) return "Unknown comparison basis";
  return null;
}

// Reorder sections to match an ordered list of ids; unknown ids are ignored and
// any sections not named keep their relative order after the named ones.
export function reorderSections(sections, orderedIds) {
  const byId = new Map(sections.map((s) => [String(s.section_inst_id ?? s.id), s]));
  const seen = new Set();
  const out = [];
  for (const id of orderedIds || []) {
    const s = byId.get(String(id));
    if (s && !seen.has(String(id))) { out.push(s); seen.add(String(id)); }
  }
  for (const s of sections) {
    const id = String(s.section_inst_id ?? s.id);
    if (!seen.has(id)) out.push(s);
  }
  return out.map((s, i) => ({ ...s, position: i + 1 }));
}

// A mandatory section cannot be excluded (CR §5 / §13).
export function canExcludeSection(section) {
  return !section?.mandatory;
}

// Version labels (CR §15): drafts are v0.x, approved is v1.0, revised approved
// is v1.1, v1.2 …
export function nextDraftLabel(draftSeq) {
  return `Draft v0.${Math.max(1, draftSeq)}`;
}
export function approvedLabel(revision = 0) {
  return `Approved v1.${revision}`;
}

// en-GB money formatting honouring the report's display units.
export function formatReportMoney(value, units = "GBP") {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const neg = n < 0;
  let scaled = n, suffix = "", dp = 0;
  if (units === "GBP_000") { scaled = n / 1000; suffix = "k"; }
  else if (units === "GBP_M") { scaled = n / 1_000_000; suffix = "m"; dp = 1; }
  const body = Math.abs(scaled).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const s = `£${body}${suffix}`;
  return neg ? `(${s})` : s;
}

export function deriveDefaultTitle(templateName, period) {
  return period ? `${templateName} — ${period}` : templateName;
}
