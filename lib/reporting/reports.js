import { query } from "../db";
import { audit } from "../governance";
import { getTemplate } from "./templates";
import { resolveSource } from "./adapters";
import {
  validateReportInput, reportTransitionError, REPORT_TRANSITIONS, isEditable,
  reorderSections as reorderSectionRule, nextDraftLabel, approvedLabel, deriveDefaultTitle,
} from "./reporting-rules";
import { validateReport } from "./validation-rules";

/*
 * Corporate Reporting Centre — report engine (DB layer). A report instance is
 * derived from a template, carries ordered section instances (each a page) and
 * components, and moves through the governed lifecycle. Validity + the state
 * machine live in reporting-rules.js / validation-rules.js; this layer is the
 * reads, writes, source resolution and version snapshots. Every mutation is
 * audited. Degrades to { ready:false } before migration 045 (42P01).
 */

const tableMissing = (e) => e?.code === "42P01";
const actorOf = (a) => a?.email || a?.name || "system";

// ---------------------------------------------------------------------------
// Create — copy the template's default sections into a new draft report.
// ---------------------------------------------------------------------------
export async function createReport(input, actor) {
  const err = validateReportInput(input);
  if (err) throw new Error(err);

  const tpl = await getTemplate(input.templateKey);
  if (!tpl) throw new Error("Unknown or inactive report template");

  const title = String(input.title).trim() || deriveDefaultTitle(tpl.name, input.reportingPeriod);
  const scope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const { rows } = await query(
    `INSERT INTO finance.report_instance
       (template_id, template_key, title, reporting_period, data_through_date, comparator,
        forecast_version, budget_version, scenario, currency, display_units, scope, audience,
        owner, reviewer, approver, expected_issue_date, confidentiality, status, version_label, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'DRAFT',$19,$20)
     RETURNING report_id`,
    [
      tpl.template_id, tpl.template_key, title, input.reportingPeriod || null, input.dataThroughDate || null,
      input.comparator || "LATEST_FORECAST", input.forecastVersion || null, input.budgetVersion || null,
      input.scenario || null, input.currency || "GBP", input.displayUnits || "GBP", JSON.stringify(scope),
      input.audience || tpl.audience || null, input.owner || actorOf(actor), input.reviewer || null,
      input.approver || null, input.expectedIssueDate || null, input.confidentiality || tpl.default_confidentiality || "INTERNAL",
      nextDraftLabel(1), actorOf(actor),
    ]
  );
  const reportId = rows[0].report_id;

  // Copy template sections → section instances. Mandatory sections are always
  // included; optional ones default to included so the first draft is complete.
  for (const s of tpl.sections) {
    await query(
      `INSERT INTO finance.report_section_instance
         (report_id, template_section_id, section_key, title, purpose, position, included,
          page_type, layout, source_key, ai_perspective, data_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING')`,
      [reportId, s.section_id, s.section_key, s.title, s.purpose || null, s.position,
       true, s.default_page_type || "content", s.default_layout || "standard",
       s.default_source_key || null, s.default_ai_perspective || null]
    );
  }

  await audit({ actor, eventType: "report.create", objectType: "report_instance", objectRef: String(reportId), detail: { template: tpl.template_key, title } });
  return { reportId, title };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listReports({ owner = null, status = null, limit = 50 } = {}) {
  try {
    const { rows } = await query(
      `SELECT report_id, template_key, title, reporting_period, data_through_date, status,
              version_label, owner, reviewer, approver, confidentiality, expected_issue_date,
              issue_date, created_by, created_at, updated_at
       FROM finance.report_instance
       WHERE ($1::varchar IS NULL OR owner = $1)
         AND ($2::varchar IS NULL OR status = $2)
       ORDER BY updated_at DESC LIMIT $3`,
      [owner, status, limit]
    );
    return { ready: true, reports: rows };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, reports: [] };
    throw e;
  }
}

export async function getReport(reportId) {
  try {
    const { rows } = await query(`SELECT * FROM finance.report_instance WHERE report_id = $1`, [reportId]);
    const report = rows[0] || null;
    if (!report) return null;
    const { rows: sections } = await query(
      `SELECT * FROM finance.report_section_instance WHERE report_id = $1 ORDER BY position`, [reportId]);
    const { rows: components } = await query(
      `SELECT * FROM finance.report_component WHERE report_id = $1 ORDER BY section_inst_id, position`, [reportId]);
    return { report, sections, components };
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

async function requireEditable(reportId) {
  const { rows } = await query(`SELECT status FROM finance.report_instance WHERE report_id = $1`, [reportId]);
  if (!rows.length) throw new Error("Report not found");
  if (!isEditable(rows[0].status)) throw new Error(`This report is ${rows[0].status.replace(/_/g, " ").toLowerCase()} and cannot be edited`);
  return rows[0].status;
}

function touch(reportId) {
  return query(`UPDATE finance.report_instance SET updated_at = CURRENT_TIMESTAMP WHERE report_id = $1`, [reportId]);
}

// ---------------------------------------------------------------------------
// Edit — instance fields, section include/reorder, components
// ---------------------------------------------------------------------------
const EDITABLE_FIELDS = {
  title: "title", reportingPeriod: "reporting_period", dataThroughDate: "data_through_date",
  comparator: "comparator", forecastVersion: "forecast_version", budgetVersion: "budget_version",
  scenario: "scenario", displayUnits: "display_units", audience: "audience", owner: "owner",
  reviewer: "reviewer", approver: "approver", expectedIssueDate: "expected_issue_date",
  confidentiality: "confidentiality",
};

export async function updateReport(reportId, patch = {}, actor) {
  await requireEditable(reportId);
  const sets = [], vals = [];
  let i = 1;
  for (const [k, col] of Object.entries(EDITABLE_FIELDS)) {
    if (k in patch) { sets.push(`${col} = $${i++}`); vals.push(k === "scope" ? JSON.stringify(patch[k]) : patch[k]); }
  }
  if ("scope" in patch) { sets.push(`scope = $${i++}`); vals.push(JSON.stringify(patch.scope || {})); }
  if (!sets.length) return { ok: true };
  vals.push(reportId);
  await query(`UPDATE finance.report_instance SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE report_id = $${i}`, vals);
  await audit({ actor, eventType: "report.update", objectType: "report_instance", objectRef: String(reportId), detail: { fields: Object.keys(patch) } });
  return { ok: true };
}

export async function setSectionIncluded(reportId, sectionInstId, included, actor) {
  await requireEditable(reportId);
  const { rows } = await query(`SELECT mandatory FROM finance.report_section_instance WHERE section_inst_id = $1 AND report_id = $2`,
    [sectionInstId, reportId]);
  // mandatory is on the template; a section instance mirrors it via template link — guard by re-check.
  const { rows: t } = await query(
    `SELECT ts.mandatory FROM finance.report_section_instance si
       LEFT JOIN finance.report_template_section ts ON ts.section_id = si.template_section_id
      WHERE si.section_inst_id = $1`, [sectionInstId]);
  if (!included && t[0]?.mandatory) throw new Error("This section is mandatory and cannot be excluded");
  await query(`UPDATE finance.report_section_instance SET included = $3, updated_at = CURRENT_TIMESTAMP WHERE section_inst_id = $1 AND report_id = $2`,
    [sectionInstId, reportId, !!included]);
  await touch(reportId);
  await audit({ actor, eventType: "report.section.toggle", objectType: "report_section_instance", objectRef: String(sectionInstId), detail: { included: !!included } });
  return { ok: true };
}

export async function reorderReportSections(reportId, orderedIds, actor) {
  await requireEditable(reportId);
  const { rows } = await query(`SELECT section_inst_id FROM finance.report_section_instance WHERE report_id = $1`, [reportId]);
  const ordered = reorderSectionRule(rows.map((r) => ({ section_inst_id: r.section_inst_id })), orderedIds);
  for (const s of ordered) {
    await query(`UPDATE finance.report_section_instance SET position = $2, updated_at = CURRENT_TIMESTAMP WHERE section_inst_id = $1`,
      [s.section_inst_id, s.position]);
  }
  await touch(reportId);
  await audit({ actor, eventType: "report.section.reorder", objectType: "report_instance", objectRef: String(reportId) });
  return { ok: true };
}

export async function addComponent(reportId, sectionInstId, comp, actor) {
  await requireEditable(reportId);
  const { rows: pos } = await query(
    `SELECT COALESCE(max(position),0)+1 AS n FROM finance.report_component WHERE section_inst_id = $1`, [sectionInstId]);
  const { rows } = await query(
    `INSERT INTO finance.report_component
       (report_id, section_inst_id, component_type, title, position, source_key, filters, config, ai_perspective)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING component_id`,
    [reportId, sectionInstId, comp.component_type, comp.title || null, pos[0].n,
     comp.source_key || null, JSON.stringify(comp.filters || {}), JSON.stringify(comp.config || {}), comp.ai_perspective || null]
  );
  await touch(reportId);
  await audit({ actor, eventType: "report.component.add", objectType: "report_component", objectRef: String(rows[0].component_id), detail: { type: comp.component_type, reportId } });
  return { componentId: rows[0].component_id };
}

// Append an ad-hoc section (used by "Add to Report" from a dashboard). Retains
// the source key + current filters so the page refreshes from governed data
// rather than being a screenshot (CR §8).
export async function addAdhocSection(reportId, { title, sourceKey = null, filters = {}, pageType = "content", aiPerspective = null }, actor) {
  await requireEditable(reportId);
  const { rows: pos } = await query(`SELECT COALESCE(max(position),0)+1 AS n FROM finance.report_section_instance WHERE report_id = $1`, [reportId]);
  const { rows } = await query(
    `INSERT INTO finance.report_section_instance
       (report_id, section_key, title, position, included, page_type, layout, source_key, ai_perspective, data_status)
     VALUES ($1,$2,$3,$4,true,$5,'standard',$6,$7,'PENDING') RETURNING section_inst_id`,
    [reportId, `adhoc_${pos[0].n}`, title || "Added item", pos[0].n, pageType, sourceKey, aiPerspective]
  );
  await touch(reportId);
  await audit({ actor, eventType: "report.section.add", objectType: "report_section_instance", objectRef: String(rows[0].section_inst_id), detail: { reportId, sourceKey } });
  return { sectionInstId: rows[0].section_inst_id };
}

export async function removeComponent(reportId, componentId, actor) {
  await requireEditable(reportId);
  await query(`DELETE FROM finance.report_component WHERE component_id = $1 AND report_id = $2`, [componentId, reportId]);
  await touch(reportId);
  await audit({ actor, eventType: "report.component.remove", objectType: "report_component", objectRef: String(componentId) });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Source resolution — attach a governed data envelope to each included section.
// Used by the builder preview, the validator, the exporter and the snapshot.
// ---------------------------------------------------------------------------
export async function resolveReport(reportId, scope) {
  const loaded = await getReport(reportId);
  if (!loaded) return null;
  const { report, sections, components } = loaded;
  const included = sections.filter((s) => s.included).sort((a, b) => a.position - b.position);

  const resolvedSections = [];
  for (const s of included) {
    const secComponents = components.filter((c) => c.section_inst_id === s.section_inst_id).sort((a, b) => a.position - b.position);
    // Resolve the section's own source (if any) plus any component sources.
    let envelope = null;
    if (s.source_key) envelope = await resolveSource(s.source_key, { scope, filters: s.filters || {} });

    const resolvedComponents = [];
    for (const c of secComponents) {
      let compEnv = null;
      if (c.source_key && c.component_type !== "commentary") {
        compEnv = await resolveSource(c.source_key, { scope, filters: c.filters || {} });
      }
      resolvedComponents.push({ ...c, data: compEnv });
    }

    // Section data status: MISSING if a source was requested but returned nothing.
    let dataStatus = "READY";
    if (s.source_key) dataStatus = envelope?.ready ? "READY" : (envelope?.metadata?.validationStatus === "MISSING" ? "MISSING" : "PARTIAL");
    else if (["cover", "appendix", "decision"].includes(s.page_type)) dataStatus = "READY";

    // Persist the derived data status so the centre home / validation reflect it.
    await query(`UPDATE finance.report_section_instance SET data_status = $2 WHERE section_inst_id = $1`, [s.section_inst_id, dataStatus]);
    resolvedSections.push({ ...s, data_status: dataStatus, envelope, components: resolvedComponents });
  }
  return { report, sections: resolvedSections, allSections: sections, components };
}

// ---------------------------------------------------------------------------
// Validation — reads the report, resolves data, runs the pure checklist.
// ---------------------------------------------------------------------------
export async function validateReportById(reportId, scope, opts = {}) {
  const resolved = await resolveReport(reportId, scope);
  if (!resolved) throw new Error("Report not found");
  const { report, sections, components } = resolved;
  // Mandatory flag comes from the template; hydrate it onto sections for the check.
  const { rows: mand } = await query(
    `SELECT si.section_inst_id, COALESCE(ts.mandatory,false) AS mandatory
       FROM finance.report_section_instance si
       LEFT JOIN finance.report_template_section ts ON ts.section_id = si.template_section_id
      WHERE si.report_id = $1`, [reportId]);
  const mandById = new Map(mand.map((m) => [String(m.section_inst_id), m.mandatory]));
  const secForCheck = resolved.allSections.map((s) => ({
    section_key: s.section_key, title: s.title, included: s.included,
    mandatory: mandById.get(String(s.section_inst_id)) || false,
    data_status: (sections.find((x) => x.section_inst_id === s.section_inst_id)?.data_status) || s.data_status,
    commentary_status: s.commentary_status,
  }));
  return validateReport(report, secForCheck, components, opts);
}

// ---------------------------------------------------------------------------
// Lifecycle transitions. Approve/issue also freeze a locked version snapshot.
// ---------------------------------------------------------------------------
export async function transitionReport(reportId, action, actor, { note = null, scope = null, changeSummary = null } = {}) {
  const { rows } = await query(`SELECT status, version_seq FROM finance.report_instance WHERE report_id = $1`, [reportId]);
  if (!rows.length) throw new Error("Report not found");
  const status = rows[0].status;

  // Gates check validation first.
  let validationFailed = false;
  if (["ready_for_approval", "approve", "issue"].includes(action) && scope) {
    const v = await validateReportById(reportId, scope);
    validationFailed = !v.canIssue;
  }
  const err = reportTransitionError(action, status, { validationFailed });
  if (err) throw new Error(err);

  const to = REPORT_TRANSITIONS[action].to;
  const stamps = [];
  if (action === "issue") stamps.push("issue_date = CURRENT_DATE");
  await query(`UPDATE finance.report_instance SET status = $2${stamps.length ? ", " + stamps.join(", ") : ""}, updated_at = CURRENT_TIMESTAMP WHERE report_id = $1`,
    [reportId, to]);

  // On approve, freeze a locked snapshot so the approved version never changes
  // silently when the underlying data moves (CR §15).
  let versionId = null;
  if (action === "approve" && scope) {
    versionId = await snapshotVersion(reportId, { scope, status: "APPROVED", label: approvedLabel(rows[0].version_seq), locked: true, changeSummary }, actor);
  }

  await audit({ actor, eventType: `report.${action}`, objectType: "report_instance", objectRef: String(reportId), detail: { from: status, to, note } });
  return { ok: true, status: to, versionId };
}

// ---------------------------------------------------------------------------
// Versions — a frozen snapshot of the fully resolved report.
// ---------------------------------------------------------------------------
export async function snapshotVersion(reportId, { scope, status, label, locked = false, changeSummary = null }, actor) {
  const resolved = await resolveReport(reportId, scope);
  if (!resolved) throw new Error("Report not found");
  // Approved commentary text is baked in; unreviewed drafts are excluded.
  const snapshot = {
    report: resolved.report,
    generatedAt: null, // stamped by caller/route to keep this layer deterministic
    sections: resolved.sections.map((s) => ({
      section_key: s.section_key, title: s.title, position: s.position, page_type: s.page_type,
      kpis: s.envelope?.kpis || [], table: s.envelope?.table || null,
      source: s.source_key, dataThrough: s.envelope?.metadata?.dataThrough || null,
      sourceRoute: s.envelope?.metadata?.sourceRoute || null,
      components: s.components.map((c) => ({
        type: c.component_type, title: c.title,
        approvedText: c.component_type === "commentary" ? (c.ai_status === "APPROVED" ? c.approved_text || c.draft_text : null) : null,
        aiStatus: c.ai_status, data: c.data ? { kpis: c.data.kpis, table: c.data.table } : null,
      })),
    })),
  };
  const { rows: seqRow } = await query(`SELECT COALESCE(max(seq),0)+1 AS n FROM finance.report_version WHERE report_id = $1`, [reportId]);
  const seq = seqRow[0].n;
  const { rows } = await query(
    `INSERT INTO finance.report_version (report_id, seq, label, snapshot, status, change_summary, locked, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING version_id`,
    [reportId, seq, label || `Draft v0.${seq}`, JSON.stringify(snapshot), status, changeSummary, locked, actorOf(actor)]
  );
  await query(`UPDATE finance.report_instance SET version_seq = $2, version_label = $3 WHERE report_id = $1`, [reportId, seq, label || `Draft v0.${seq}`]);
  await audit({ actor, eventType: "report.version.snapshot", objectType: "report_version", objectRef: String(rows[0].version_id), detail: { reportId, seq, locked } });
  return rows[0].version_id;
}

export async function listVersions(reportId) {
  const { rows } = await query(
    `SELECT version_id, seq, label, status, change_summary, locked, created_by, created_at
     FROM finance.report_version WHERE report_id = $1 ORDER BY seq DESC`, [reportId]);
  return rows;
}

export async function getVersion(versionId) {
  const { rows } = await query(`SELECT * FROM finance.report_version WHERE version_id = $1`, [versionId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Exports — record every generated artifact.
// ---------------------------------------------------------------------------
export async function recordExport(reportId, { versionId = null, format, checksum, byteSize, watermark = null, confidentiality = null }, actor) {
  const { rows } = await query(
    `INSERT INTO finance.report_export (report_id, version_id, format, checksum, byte_size, watermark, confidentiality, exported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING export_id`,
    [reportId, versionId, format, checksum || null, byteSize || null, watermark, confidentiality, actorOf(actor)]
  );
  await audit({ actor, eventType: "report.export", objectType: "report_instance", objectRef: String(reportId), detail: { format, versionId } });
  return { exportId: rows[0].export_id };
}

// ---------------------------------------------------------------------------
// Centre home — health + attention feed.
// ---------------------------------------------------------------------------
export async function getReportingHealth() {
  try {
    const { rows } = await query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status IN ('DRAFT','DATA_PENDING','COMMENTARY_PENDING','REVIEW_READY','IN_REVIEW','RETURNED','APPROVAL_READY'))::int AS in_progress,
         count(*) FILTER (WHERE status IN ('APPROVED','ISSUED'))::int AS completed,
         count(*) FILTER (WHERE status = 'ISSUED')::int AS issued,
         count(*) FILTER (WHERE expected_issue_date < CURRENT_DATE AND status NOT IN ('ISSUED','APPROVED','ARCHIVED','CANCELLED','SUPERSEDED'))::int AS overdue
       FROM finance.report_instance`
    );
    return { ready: true, ...rows[0] };
  } catch (e) {
    if (tableMissing(e)) return { ready: false };
    throw e;
  }
}

// Reports needing attention (CR §3): missing data, unreviewed commentary,
// returned, approval required, overdue.
export async function getAttention(limit = 20) {
  try {
    const { rows } = await query(
      `SELECT i.report_id, i.title, i.status, i.owner, i.expected_issue_date, i.updated_at,
              EXISTS (SELECT 1 FROM finance.report_section_instance s WHERE s.report_id = i.report_id AND s.included AND s.data_status = 'MISSING') AS missing_data,
              EXISTS (SELECT 1 FROM finance.report_component c WHERE c.report_id = i.report_id AND c.component_type = 'commentary' AND c.ai_status = 'DRAFT') AS unreviewed_commentary,
              (i.expected_issue_date < CURRENT_DATE AND i.status NOT IN ('ISSUED','APPROVED','ARCHIVED','CANCELLED','SUPERSEDED')) AS overdue
       FROM finance.report_instance i
       WHERE i.status NOT IN ('ISSUED','ARCHIVED','CANCELLED','SUPERSEDED')
       ORDER BY i.updated_at DESC LIMIT $1`, [limit]);
    return rows.filter((r) => r.missing_data || r.unreviewed_commentary || r.overdue || ["RETURNED", "APPROVAL_READY"].includes(r.status));
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}
