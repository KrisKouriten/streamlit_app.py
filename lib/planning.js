import { query } from "./db";
import { audit } from "./governance";
import { validateDriverDefinition, validateAssumption, resolveAssumption } from "./planning-rules.js";

/*
 * Driver-based planning engine — DB layer (Phase 1 foundation). Reads and writes
 * the Driver Library (planning.driver_definition), the Assumption Register
 * (planning.driver_assumption) and the scenario dimension. The precedence maths
 * lives in planning-rules.js. Degrades to []/null before migration 055 (missing
 * schema/table) so nothing breaks pre-migration. No live screen depends on this
 * yet — it is the foundation the later phases build on.
 */

const actorOf = (a) => a?.email || a?.name || "system";
const absent = (e) => e?.code === "42P01" || e?.code === "3F000"; // table / schema missing

export async function listScenarios() {
  try {
    const { rows } = await query(`SELECT * FROM planning.scenario WHERE is_active ORDER BY sort_order, scenario_code`);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

// ---- Driver Library -----------------------------------------------------

export async function listDrivers({ category = null, scope = null, includeRetired = false } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.driver_definition
        WHERE ($1::varchar IS NULL OR category = $1)
          AND ($2::varchar IS NULL OR $2 = ANY(permitted_scopes))
          AND ($3::boolean OR approval_status <> 'RETIRED')
        ORDER BY category, driver_code`,
      [category, scope, includeRetired]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function upsertDriver(def, actor) {
  const err = validateDriverDefinition(def);
  if (err) throw new Error(err);
  const { rows } = await query(
    `INSERT INTO planning.driver_definition
       (driver_code, description, category, unit, calc_rule, permitted_scopes, permitted_nominals,
        effective_start, effective_end, is_active, owner, approval_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,true),$11,COALESCE($12,'DRAFT'),$13)
     ON CONFLICT (driver_code) DO UPDATE SET
       description = EXCLUDED.description, category = EXCLUDED.category, unit = EXCLUDED.unit,
       calc_rule = EXCLUDED.calc_rule, permitted_scopes = EXCLUDED.permitted_scopes,
       permitted_nominals = EXCLUDED.permitted_nominals, effective_start = EXCLUDED.effective_start,
       effective_end = EXCLUDED.effective_end, is_active = EXCLUDED.is_active, owner = EXCLUDED.owner,
       version = planning.driver_definition.version + 1, updated_at = CURRENT_TIMESTAMP
     RETURNING driver_code`,
    [def.driver_code, def.description, def.category, def.unit || null, def.calc_rule || null,
     def.permitted_scopes || [], def.permitted_nominals || null, def.effective_start || null,
     def.effective_end || null, def.is_active, def.owner || null, def.approval_status, actorOf(actor)]);
  await audit({ actor, eventType: "planning.driver.upsert", objectType: "driver_definition", objectRef: def.driver_code });
  return { driverCode: rows[0].driver_code };
}

export async function setDriverApproval(driverCode, status, actor) {
  if (!["DRAFT", "APPROVED", "RETIRED"].includes(status)) throw new Error("Unknown approval status");
  await query(`UPDATE planning.driver_definition SET approval_status = $2, updated_at = CURRENT_TIMESTAMP WHERE driver_code = $1`, [driverCode, status]);
  await audit({ actor, eventType: "planning.driver.approval", objectType: "driver_definition", objectRef: driverCode, detail: { status } });
  return { ok: true, status };
}

// ---- Assumption Register ------------------------------------------------

export async function listAssumptions({ driverCode = null, scope = null, scenario = null, fiscalYear = null, includeDrafts = true } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.driver_assumption
        WHERE ($1::varchar IS NULL OR driver_code = $1)
          AND ($2::varchar IS NULL OR scope = $2)
          AND ($3::varchar IS NULL OR scenario_code = $3)
          AND ($4::char(4) IS NULL OR fiscal_year = $4 OR fiscal_year IS NULL)
          AND ($5::boolean OR approval_status = 'APPROVED')
        ORDER BY driver_code, level, level_key NULLS FIRST, period NULLS FIRST`,
      [driverCode, scope, scenario, fiscalYear, includeDrafts]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function upsertAssumption(a, actor) {
  const err = validateAssumption(a);
  if (err) throw new Error(err);
  if (a.assumption_id) {
    await query(
      `UPDATE planning.driver_assumption SET
         value = $2, unit = $3, source = $4, owner = $5, commentary = $6,
         effective_start = $7, effective_end = $8, period = $9, updated_at = CURRENT_TIMESTAMP
       WHERE assumption_id = $1`,
      [a.assumption_id, a.value, a.unit || null, a.source || null, a.owner || null, a.commentary || null,
       a.effective_start || null, a.effective_end || null, a.period || null]);
    await audit({ actor, eventType: "planning.assumption.update", objectType: "driver_assumption", objectRef: String(a.assumption_id) });
    return { assumptionId: a.assumption_id };
  }
  const { rows } = await query(
    `INSERT INTO planning.driver_assumption
       (driver_code, scope, level, level_key, fiscal_year, scenario_code, version_label, period,
        value, unit, source, owner, commentary, approval_status, effective_start, effective_end, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'BASE'),$7,$8,$9,$10,$11,$12,$13,COALESCE($14,'DRAFT'),$15,$16,$17)
     RETURNING assumption_id`,
    [a.driver_code, a.scope, a.level, a.level_key || null, a.fiscal_year || null, a.scenario_code,
     a.version_label || null, a.period || null, a.value, a.unit || null, a.source || null, a.owner || null,
     a.commentary || null, a.approval_status, a.effective_start || null, a.effective_end || null, actorOf(actor)]);
  await audit({ actor, eventType: "planning.assumption.create", objectType: "driver_assumption", objectRef: String(rows[0].assumption_id), detail: { driver: a.driver_code, level: a.level } });
  return { assumptionId: rows[0].assumption_id };
}

export async function setAssumptionApproval(assumptionId, status, actor) {
  if (!["DRAFT", "APPROVED"].includes(status)) throw new Error("Unknown approval status");
  await query(
    `UPDATE planning.driver_assumption SET approval_status = $2, reviewed_by = $3, updated_at = CURRENT_TIMESTAMP WHERE assumption_id = $1`,
    [assumptionId, status, actorOf(actor)]);
  await audit({ actor, eventType: "planning.assumption.approval", objectType: "driver_assumption", objectRef: String(assumptionId), detail: { status } });
  return { ok: true, status };
}

/*
 * Resolve the effective (most-specific approved) assumption for a driver in a
 * context — the read the calculation engine will use. Loads the candidate rows
 * for the driver/scope/scenario and applies the precedence rule.
 *   ctx: { driverCode, scope, storeCode?, region?, entity?, period?, scenario?, fiscalYear?, includeDrafts? }
 */
export async function resolveAssumptionFor(ctx = {}) {
  const rows = await listAssumptions({
    driverCode: ctx.driverCode, scope: ctx.scope || null, scenario: ctx.scenario || null,
    fiscalYear: ctx.fiscalYear || null, includeDrafts: !!ctx.includeDrafts,
  });
  return resolveAssumption(rows, ctx);
}
