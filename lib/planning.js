import { query } from "./db";
import { audit } from "./governance";
import { validateDriverDefinition, validateAssumption, resolveAssumption, computeStoreSalesLines } from "./planning-rules.js";

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

// ---- Plan versions ------------------------------------------------------

export async function listPlanVersions() {
  try {
    const { rows } = await query(`SELECT * FROM planning.plan_version ORDER BY created_at DESC, version_id DESC`);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function createPlanVersion(input, actor) {
  if (!input?.label || !String(input.label).trim()) throw new Error("A version label is required");
  const kind = input.kind === "BUDGET" ? "BUDGET" : "FORECAST";
  const { rows } = await query(
    `INSERT INTO planning.plan_version (label, kind, fiscal_year, base_scenario, notes, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'BASE'),$5,$6) RETURNING version_id`,
    [input.label.trim(), kind, input.fiscal_year || null, input.base_scenario || null, input.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "planning.version.create", objectType: "plan_version", objectRef: String(rows[0].version_id), detail: { label: input.label, kind } });
  return { versionId: rows[0].version_id };
}

// ---- Sales driver inputs ------------------------------------------------

export async function listSalesDriverInputs({ versionId, scenario = null, storeCode = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.sales_driver_input
        WHERE version_id = $1
          AND ($2::varchar IS NULL OR scenario_code = $2)
          AND ($3::varchar IS NULL OR store_code = $3)
        ORDER BY store_code, period`,
      [versionId, scenario, storeCode]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function upsertSalesDriverInput(row, actor) {
  if (!row?.version_id || !row?.store_code || !row?.period) throw new Error("version, store and period are required");
  const { rows } = await query(
    `INSERT INTO planning.sales_driver_input
       (version_id, scenario_code, scope, store_code, period, method, footfall, conversion, atv,
        direct_sales, adjustment_amount, adjustment_pct, trading_days, commentary, updated_by)
     VALUES ($1,COALESCE($2,'BASE'),$3,$4,$5,COALESCE($6,'CORE'),$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (version_id, scenario_code, store_code, period) DO UPDATE SET
       scope = EXCLUDED.scope, method = EXCLUDED.method, footfall = EXCLUDED.footfall,
       conversion = EXCLUDED.conversion, atv = EXCLUDED.atv, direct_sales = EXCLUDED.direct_sales,
       adjustment_amount = EXCLUDED.adjustment_amount, adjustment_pct = EXCLUDED.adjustment_pct,
       trading_days = EXCLUDED.trading_days, commentary = EXCLUDED.commentary,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
     RETURNING input_id`,
    [row.version_id, row.scenario_code, row.scope || "COMPANY_STORE", row.store_code, row.period, row.method,
     row.footfall ?? null, row.conversion ?? null, row.atv ?? null, row.direct_sales ?? null,
     row.adjustment_amount ?? null, row.adjustment_pct ?? null, row.trading_days ?? null, row.commentary || null, actorOf(actor)]);
  return { inputId: rows[0].input_id };
}

// Store → { entity_id, entity_code, region } from the Store Master. Entity is a
// DERIVED attribute of the store (never independently keyed). Empty if dim_store
// is not loaded.
async function storeMasterMap() {
  try {
    const { rows } = await query(
      `SELECT s.store_code, s.entity_id, s.region, e.entity_code
         FROM core.dim_store s LEFT JOIN core.dim_entity e ON e.entity_id = s.entity_id`);
    return new Map(rows.map((r) => [r.store_code, r]));
  } catch (e) { if (absent(e)) return new Map(); throw e; }
}

/*
 * Compute a version's company-store net sales from its driver inputs and write
 * the results to planning.plan_line (source SALES_DRIVER, nominal 'ST: Sales').
 * Blank driver fields fall back to the Assumption Register (company→region→
 * entity→store). Entity is derived from the Store Master. Idempotent: prior
 * SALES_DRIVER lines for the store are cleared and rewritten.
 */
export async function computeStoreSalesForVersion(versionId, { scenario = "BASE", storeCode = null } = {}, actor) {
  const inputs = await listSalesDriverInputs({ versionId, scenario, storeCode });
  if (!inputs.length) return { computed: 0, stores: 0 };
  const byStore = new Map();
  for (const r of inputs) { if (!byStore.has(r.store_code)) byStore.set(r.store_code, []); byStore.get(r.store_code).push(r); }

  const meta = await storeMasterMap();
  const assum = {};
  for (const code of ["FOOTFALL", "CONVERSION", "ATV"]) {
    assum[code] = await listAssumptions({ driverCode: code, scope: "COMPANY_STORE", scenario, includeDrafts: false });
  }

  let computed = 0;
  for (const [store, rows] of byStore) {
    const m = meta.get(store) || {};
    const resolveDriver = (code, period) => {
      const r = resolveAssumption(assum[code] || [], { driverCode: code, scope: "COMPANY_STORE", storeCode: store, region: m.region, entity: m.entity_code, period, scenario });
      return r ? r.value : null;
    };
    const lines = computeStoreSalesLines(rows, { nominal: "ST: Sales", resolveDriver });
    await query(
      `DELETE FROM planning.plan_line WHERE version_id=$1 AND scenario_code=$2 AND scope='COMPANY_STORE' AND store_code=$3 AND source='SALES_DRIVER'`,
      [versionId, scenario, store]);
    for (const ln of lines) {
      await query(
        `INSERT INTO planning.plan_line
           (version_id, scenario_code, scope, store_code, entity_id, nominal, period, amount, driver_code, source, lineage)
         VALUES ($1,$2,'COMPANY_STORE',$3,$4,$5,$6,$7,$8,'SALES_DRIVER',$9)`,
        [versionId, scenario, store, m.entity_id || null, ln.nominal, ln.period, ln.amount, ln.driver_code, JSON.stringify(ln.lineage)]);
      computed++;
    }
  }
  await audit({ actor, eventType: "planning.sales.compute", objectType: "plan_version", objectRef: String(versionId), detail: { scenario, stores: byStore.size, lines: computed } });
  return { computed, stores: byStore.size };
}

// Read the computed plan lines (what later phases and the P&L renderer consume).
export async function getPlanLines({ versionId, scenario = null, scope = null, storeCode = null, source = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.plan_line
        WHERE version_id = $1
          AND ($2::varchar IS NULL OR scenario_code = $2)
          AND ($3::varchar IS NULL OR scope = $3)
          AND ($4::varchar IS NULL OR store_code = $4)
          AND ($5::varchar IS NULL OR source = $5)
        ORDER BY scope, store_code, nominal, period`,
      [versionId, scenario, scope, storeCode, source]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}
