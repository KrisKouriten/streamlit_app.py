/*
 * Corporate Reporting Centre — report validation (CR §13). Pure: given a report
 * instance, its sections and its components, produce a checklist of results at
 * PASSED / WARNING / FAILED and an overall verdict. A report with any FAILED
 * check must not be approved or issued as final. No DB, no I/O. Unit-tested in
 * tests/reporting-validation.test.mjs.
 */

const DEFAULT_STALE_DAYS = 9;

const PASS = "PASSED", WARN = "WARNING", FAIL = "FAILED";

function daysBetween(aMs, bMs) {
  return Math.floor((aMs - bMs) / 86_400_000);
}

/*
 * report:      { status, confidentiality, reviewer, approver, comparator,
 *                data_through_date, reporting_period }
 * sections:    [{ section_key, title, included, mandatory, data_status,
 *                 commentary_status }]
 * components:  [{ component_type, ai_status, source_key, ... }]
 * opts:        { nowMs, staleDays }
 */
export function validateReport(report = {}, sections = [], components = [], opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const checks = [];
  const add = (key, label, level, detail) => checks.push({ key, label, level, detail: detail || null });

  const included = sections.filter((s) => s.included);

  // Required sections are included (CR §13).
  const missingMandatory = sections.filter((s) => s.mandatory && !s.included);
  add("mandatory_sections", "Required sections included",
    missingMandatory.length ? FAIL : PASS,
    missingMandatory.length ? `Missing: ${missingMandatory.map((s) => s.title).join(", ")}` : null);

  // At least one content section beyond the cover.
  add("has_content", "Report has content",
    included.length >= 2 ? PASS : FAIL,
    included.length >= 2 ? null : "A report needs at least a cover and one content section");

  // Data availability across included sections.
  const missingData = included.filter((s) => s.data_status === "MISSING");
  const partialData = included.filter((s) => s.data_status === "PARTIAL" || s.data_status === "PENDING");
  add("data_available", "Section data available",
    missingData.length ? FAIL : partialData.length ? WARN : PASS,
    missingData.length ? `No data: ${missingData.map((s) => s.title).join(", ")}`
      : partialData.length ? `Awaiting/partial: ${partialData.map((s) => s.title).join(", ")}` : null);

  // Data freshness (CR §13). data_through_date within the freshness threshold.
  if (report.data_through_date) {
    const throughMs = Date.parse(report.data_through_date);
    const age = Number.isNaN(throughMs) ? null : daysBetween(nowMs, throughMs);
    add("data_freshness", "Data within freshness threshold",
      age == null ? WARN : age > staleDays ? WARN : PASS,
      age == null ? "Could not read data-through date" : age > staleDays ? `Data is ${age} days old (threshold ${staleDays})` : null);
  } else {
    add("data_freshness", "Data-through date set", WARN, "No data-through date recorded");
  }

  // Comparison basis is set and consistent (CR §13).
  add("comparator", "Comparison basis set",
    report.comparator ? PASS : WARN,
    report.comparator ? null : "No comparison basis chosen");

  // AI commentary has been reviewed (CR §12/§13): no included commentary
  // component may remain a DRAFT in a report heading for approval/issue.
  const commentary = components.filter((c) => c.component_type === "commentary");
  const unreviewed = commentary.filter((c) => c.ai_status === "DRAFT");
  const rejected = commentary.filter((c) => c.ai_status === "REJECTED");
  add("commentary_reviewed", "AI commentary reviewed",
    unreviewed.length ? FAIL : rejected.length ? WARN : PASS,
    unreviewed.length ? `${unreviewed.length} commentary block(s) still a draft — review before issue`
      : rejected.length ? `${rejected.length} commentary block(s) rejected` : null);

  // Sections flagged for commentary that have none yet.
  const commentaryPending = included.filter((s) => s.commentary_status === "DRAFT");
  add("commentary_complete", "Commentary complete",
    commentaryPending.length ? WARN : PASS,
    commentaryPending.length ? `${commentaryPending.length} section(s) with draft commentary` : null);

  // Confidentiality label present (CR §13).
  add("confidentiality", "Confidentiality label present",
    report.confidentiality ? PASS : FAIL,
    report.confidentiality ? null : "No confidentiality classification set");

  // Reviewer and approver assigned (CR §13).
  add("reviewer", "Reviewer assigned", report.reviewer ? PASS : WARN, report.reviewer ? null : "No reviewer assigned");
  add("approver", "Approver assigned", report.approver ? PASS : WARN, report.approver ? null : "No approver assigned");

  const summary = {
    passed: checks.filter((c) => c.level === PASS).length,
    warning: checks.filter((c) => c.level === WARN).length,
    failed: checks.filter((c) => c.level === FAIL).length,
  };
  const overall = summary.failed ? FAIL : summary.warning ? WARN : PASS;
  return { checks, summary, overall, canIssue: summary.failed === 0 };
}
