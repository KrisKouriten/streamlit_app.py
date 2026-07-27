import { query } from "../db";
import { audit } from "../governance";
import { summariseRealisation } from "./benefit-rules";

/*
 * Benefit measurement for the intelligence layer (Phase 5b). An AI recommendation
 * becomes a tracked benefit opportunity (source AI_INTELLIGENCE, linked to the
 * run that raised it). The expected value is set by a human — the model never
 * invents a £ figure. Realisation feeds through the existing Phase-4 benefit
 * tables; finance validation happens on Govern › Benefits, which lists every
 * opportunity including these.
 */

export async function captureRecommendation({ actor, title, description = null, expectedValueGbp = null, category = null, runId = null, originSurface = null }) {
  if (!title || !String(title).trim()) return { ok: false, error: "title is required" };
  const val = expectedValueGbp == null || expectedValueGbp === "" ? null : Number(expectedValueGbp);
  if (val != null && !Number.isFinite(val)) return { ok: false, error: "expected value must be a number" };
  const { rows } = await query(
    `INSERT INTO intelligence.benefit_opportunity
       (title, description, category, source_type, expected_value_gbp, owner_name, ai_run_id, origin_surface, status)
     VALUES ($1,$2,$3,'AI_INTELLIGENCE',$4,$5,$6,$7,'PROPOSED') RETURNING opportunity_id`,
    [String(title).trim(), description, category, val, actor?.name || actor?.email || null, runId || null, originSurface || null]
  );
  const opportunityId = rows[0].opportunity_id;
  await audit({ actor, eventType: "benefit.capture_ai", objectType: "benefit_opportunity", objectRef: String(opportunityId), detail: { expectedValueGbp: val, runId, originSurface } });
  return { ok: true, opportunityId };
}

// Record a realised measurement against an AI opportunity (no linked action).
export async function recordMeasurement(opportunityId, value, note, actor) {
  const val = Number(value);
  if (!Number.isFinite(val)) return { ok: false, error: "measured value must be a number" };
  await query(
    `INSERT INTO intelligence.benefit_measurement (opportunity_id, measured_value_gbp, note, measured_by)
     VALUES ($1,$2,$3,$4)`,
    [opportunityId, val, note || null, actor.email]
  );
  await query(`UPDATE intelligence.benefit_opportunity SET status = 'REALISED' WHERE opportunity_id = $1 AND status NOT IN ('VALIDATED','REJECTED')`, [opportunityId]);
  await audit({ actor, eventType: "benefit.measure_ai", objectType: "benefit_opportunity", objectRef: String(opportunityId), detail: { value: val } });
  return { ok: true };
}

// The realisation picture for AI-originated opportunities (this layer + agents).
export async function getIntelligenceBenefits() {
  const { rows } = await query(
    `SELECT o.opportunity_id, o.title, o.description, o.category, o.source_type, o.origin_surface,
            o.expected_value_gbp, o.status, o.ai_run_id, o.owner_name, o.created_at,
            (SELECT measured_value_gbp FROM intelligence.benefit_measurement m WHERE m.opportunity_id = o.opportunity_id ORDER BY created_at DESC LIMIT 1) AS latest_measured,
            (SELECT validated_value_gbp FROM intelligence.benefit_validation v WHERE v.opportunity_id = o.opportunity_id ORDER BY validated_at DESC LIMIT 1) AS validated_value,
            (SELECT decision FROM intelligence.benefit_validation v WHERE v.opportunity_id = o.opportunity_id ORDER BY validated_at DESC LIMIT 1) AS validation_decision
     FROM intelligence.benefit_opportunity o
     WHERE o.source_type IN ('AI_INTELLIGENCE','AI_AGENT')
     ORDER BY o.expected_value_gbp DESC NULLS LAST, o.created_at DESC`
  );
  return { opportunities: rows, summary: summariseRealisation(rows) };
}
