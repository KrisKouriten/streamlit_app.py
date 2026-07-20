import { query } from "./db";
import { audit } from "./governance";
import { ACTION_TRANSITIONS, actionTransitionError, ACTION_STATUSES, SOURCE_TYPES } from "./action-rules.js";

export { ACTION_TRANSITIONS, actionTransitionError, ACTION_STATUSES, SOURCE_TYPES } from "./action-rules.js";

/*
 * Action Centre — one register for actions from every source, plus the
 * benefits tracker (opportunity -> measurement -> validation). createAction is
 * the single insertion path, used by the API and by the agent-approval flow.
 */

export async function createAction(a, actor) {
  const { rows } = await query(
    `INSERT INTO intelligence.action_register
       (action_title, action_description, owner_name, sponsor, due_date, status, progress_pct,
        source_type, source_ref, root_cause, expected_value_gbp, dashboard_code, kpi_id,
        agent_run_id, insight_id)
     VALUES ($1,$2,$3,$4,$5,'OPEN',0,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING action_id`,
    [a.title, a.description || null, a.ownerName, a.sponsor || null, a.dueDate || null,
     a.sourceType || "MANUAL", a.sourceRef || null, a.rootCause || null,
     a.expectedValue ?? null, a.dashboardCode || null, a.kpiId || null,
     a.agentRunId || null, a.insightId || null]
  );
  const actionId = rows[0].action_id;
  await query(
    `INSERT INTO intelligence.action_update (action_id, author, body, to_status, progress_pct)
     VALUES ($1, $2, $3, 'OPEN', 0)`,
    [actionId, actor.email, `Action raised (${a.sourceType || "MANUAL"})`]
  );
  if (a.expectedValue != null && Number(a.expectedValue) !== 0) {
    await query(
      `INSERT INTO intelligence.benefit_opportunity
         (title, source_type, expected_value_gbp, owner_name, action_id, insight_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'IN_DELIVERY')`,
      [a.title.slice(0, 250), a.sourceType || "MANUAL", Math.abs(Number(a.expectedValue)), a.ownerName, actionId, a.insightId || null]
    );
  }
  await audit({ actor, eventType: "action.create", objectType: "action_register", objectRef: String(actionId), detail: { source: a.sourceType } });
  return actionId;
}

export async function transitionAction(actionId, action, actor, { note } = {}) {
  const { rows } = await query(`SELECT * FROM intelligence.action_register WHERE action_id = $1`, [actionId]);
  const a = rows[0];
  if (!a) throw new Error("Action not found");
  const to = ACTION_TRANSITIONS[action].to;
  const extra = {};
  if (to === "COMPLETE") extra.completed_at = "CURRENT_TIMESTAMP";
  const closureCols = action === "close"
    ? `, closure_approved_by = ${'$3'}, closure_approved_at = CURRENT_TIMESTAMP`
    : "";
  const params = action === "close" ? [to, actionId, actor.name || actor.email] : [to, actionId];
  await query(
    `UPDATE intelligence.action_register
     SET status = $1::varchar,
         progress_pct = CASE WHEN $1::varchar = 'COMPLETE' THEN 100 WHEN $1::varchar = 'CLOSED' THEN 100 ELSE progress_pct END,
         completed_at = CASE WHEN $1::varchar = 'COMPLETE' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END
         ${closureCols}
     WHERE action_id = $2`,
    params
  );
  await query(
    `INSERT INTO intelligence.action_update (action_id, author, body, from_status, to_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [actionId, actor.email, note || null, a.status, to]
  );
  await audit({ actor, eventType: `action.${action}`, objectType: "action_register", objectRef: String(actionId) });
  return to;
}

export async function addActionUpdate(actionId, actor, { body, progressPct }) {
  if (progressPct != null) {
    await query(`UPDATE intelligence.action_register SET progress_pct = $1 WHERE action_id = $2`, [progressPct, actionId]);
  }
  await query(
    `INSERT INTO intelligence.action_update (action_id, author, body, progress_pct) VALUES ($1, $2, $3, $4)`,
    [actionId, actor.email, body || null, progressPct ?? null]
  );
}

export async function addActionEvidence(actionId, actor, { label, url, note }) {
  await query(
    `INSERT INTO intelligence.action_evidence (action_id, label, url, note, added_by) VALUES ($1,$2,$3,$4,$5)`,
    [actionId, label, url || null, note || null, actor.email]
  );
  await audit({ actor, eventType: "action.evidence", objectType: "action_register", objectRef: String(actionId) });
}

// Record realised value on an action and log a benefit measurement.
export async function recordRealised(actionId, value, note, actor) {
  await query(`UPDATE intelligence.action_register SET realised_value_gbp = $1 WHERE action_id = $2`, [value, actionId]);
  const { rows } = await query(`SELECT opportunity_id FROM intelligence.benefit_opportunity WHERE action_id = $1`, [actionId]);
  if (rows.length) {
    await query(
      `INSERT INTO intelligence.benefit_measurement (opportunity_id, measured_value_gbp, note, measured_by)
       VALUES ($1, $2, $3, $4)`,
      [rows[0].opportunity_id, value, note || null, actor.email]
    );
    await query(`UPDATE intelligence.benefit_opportunity SET status = 'REALISED' WHERE opportunity_id = $1 AND status <> 'VALIDATED'`, [rows[0].opportunity_id]);
  }
  await audit({ actor, eventType: "action.realised", objectType: "action_register", objectRef: String(actionId), detail: { value } });
}

export async function validateBenefit(opportunityId, value, decision, comment, actor) {
  await query(
    `INSERT INTO intelligence.benefit_validation (opportunity_id, validated_value_gbp, decision, validated_by, comment)
     VALUES ($1, $2, $3, $4, $5)`,
    [opportunityId, value, decision, actor.email, comment || null]
  );
  await query(`UPDATE intelligence.benefit_opportunity SET status = $2 WHERE opportunity_id = $1`,
    [opportunityId, decision === "VALIDATED" ? "VALIDATED" : "REJECTED"]);
  await audit({ actor, eventType: "benefit.validate", objectType: "benefit_opportunity", objectRef: String(opportunityId), detail: { decision, value } });
}

// ---------------------------------------------------------------- queries
export async function listActions({ status = null, source = null } = {}) {
  const { rows } = await query(
    `SELECT a.*, k.kpi_name,
            EXISTS (SELECT 1 FROM intelligence.action_evidence e WHERE e.action_id = a.action_id) AS has_evidence
     FROM intelligence.action_register a
     LEFT JOIN intelligence.dim_kpi k ON k.kpi_id = a.kpi_id
     WHERE ($1::varchar IS NULL OR a.status = $1)
       AND ($2::varchar IS NULL OR a.source_type = $2)
     ORDER BY
       CASE a.status WHEN 'OVERDUE' THEN 0 WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'COMPLETE' THEN 3 ELSE 4 END,
       a.due_date NULLS LAST, a.created_at DESC`,
    [status, source]
  );
  return rows;
}

export async function getActionSummary() {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','OVERDUE'))::int AS open,
            count(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue,
            count(*) FILTER (WHERE status = 'COMPLETE')::int AS awaiting_closure,
            COALESCE(SUM(expected_value_gbp) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','OVERDUE','COMPLETE')),0) AS open_value
     FROM intelligence.action_register WHERE status <> 'CANCELLED'`
  );
  return rows[0];
}

export async function getAction(actionId) {
  const [action, updates, evidence, opp] = await Promise.all([
    query(`SELECT a.*, k.kpi_name FROM intelligence.action_register a
           LEFT JOIN intelligence.dim_kpi k ON k.kpi_id = a.kpi_id WHERE a.action_id = $1`, [actionId]),
    query(`SELECT * FROM intelligence.action_update WHERE action_id = $1 ORDER BY created_at`, [actionId]),
    query(`SELECT * FROM intelligence.action_evidence WHERE action_id = $1 ORDER BY added_at`, [actionId]),
    query(`SELECT * FROM intelligence.benefit_opportunity WHERE action_id = $1`, [actionId]),
  ]);
  if (!action.rows.length) return null;
  return { ...action.rows[0], updates: updates.rows, evidence: evidence.rows, opportunity: opp.rows[0] || null };
}

export async function markOverdueActions() {
  await query(
    `UPDATE intelligence.action_register SET status = 'OVERDUE'
     WHERE due_date < CURRENT_DATE AND status IN ('OPEN','IN_PROGRESS')`
  );
}

// ---------------------------------------------------------------- benefits
export async function getBenefits() {
  const { rows } = await query(
    `SELECT o.*, a.status AS action_status,
            (SELECT measured_value_gbp FROM intelligence.benefit_measurement m
             WHERE m.opportunity_id = o.opportunity_id ORDER BY created_at DESC LIMIT 1) AS latest_measured,
            (SELECT validated_value_gbp FROM intelligence.benefit_validation v
             WHERE v.opportunity_id = o.opportunity_id ORDER BY validated_at DESC LIMIT 1) AS validated_value,
            (SELECT decision FROM intelligence.benefit_validation v
             WHERE v.opportunity_id = o.opportunity_id ORDER BY validated_at DESC LIMIT 1) AS validation_decision
     FROM intelligence.benefit_opportunity o
     LEFT JOIN intelligence.action_register a ON a.action_id = o.action_id
     ORDER BY o.expected_value_gbp DESC NULLS LAST`
  );
  const summary = { AI: { expected: 0, realised: 0, validated: 0 }, HUMAN: { expected: 0, realised: 0, validated: 0 } };
  for (const o of rows) {
    const bucket = o.source_type === "AI_AGENT" ? "AI" : "HUMAN";
    summary[bucket].expected += Number(o.expected_value_gbp || 0);
    summary[bucket].realised += Number(o.latest_measured || 0);
    if (o.validation_decision === "VALIDATED") summary[bucket].validated += Number(o.validated_value || 0);
  }
  return { opportunities: rows, summary };
}
