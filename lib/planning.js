import { query } from "./db";
import { audit } from "./governance";
import { validateDriverDefinition, validateAssumption, resolveAssumption, computeStoreSalesLines, computeFixedCostLines, computePctOfSalesLines, validateCostRule, computePayrollLines, validatePayrollRule, PAYROLL_RATE_DRIVERS, DEFAULT_PAYROLL_NOMINALS, unmappedNominals } from "./planning-rules.js";
import { getFormatSpec, SCOPE_KINDS } from "./pl-format-store.js";
import { renderFormat } from "./pl-format.js";

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

// The store master, for the planning UI's store filter. Ownership maps to the
// planning scope: COMPANY → COMPANY_STORE, FRANCHISE → FRANCHISE_STORE.
// Empty if dim_store is not loaded (only demo rows exist pre-real-load).
export async function listPlanStores({ scope = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT s.store_code, s.store_name, s.ownership_type, s.region,
              e.entity_code, e.entity_name
         FROM core.dim_store s LEFT JOIN core.dim_entity e ON e.entity_id = s.entity_id
        WHERE s.status IS NULL OR s.status <> 'CLOSED'
        ORDER BY s.store_code`);
    const scoped = rows.map((r) => ({
      ...r,
      scope: r.ownership_type === "FRANCHISE" ? "FRANCHISE_STORE" : "COMPANY_STORE",
    }));
    return scope ? scoped.filter((r) => r.scope === scope) : scoped;
  } catch (e) { if (absent(e)) return []; throw e; }
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

// ---- Cost rules (fixed + % of sales) — Phase 2b -------------------------

export async function listCostRules({ versionId, scenario = null, scope = null, storeCode = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.cost_rule
        WHERE version_id = $1
          AND ($2::varchar IS NULL OR scenario_code = $2)
          AND ($3::varchar IS NULL OR scope = $3)
          AND ($4::varchar IS NULL OR store_code = $4)
        ORDER BY scope, store_code, nominal`,
      [versionId, scenario, scope, storeCode]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function upsertCostRule(rule, actor) {
  const err = validateCostRule(rule);
  if (err) throw new Error(err);
  if (rule.rule_id) {
    await query(
      `UPDATE planning.cost_rule SET
         nominal=$2, behaviour=$3, monthly_amount=$4, annual_increase_pct=COALESCE($5,0), rate=$6,
         sales_base=COALESCE($7,'ST: Sales'), start_period=$8, end_period=$9, department=$10,
         commentary=$11, updated_at=CURRENT_TIMESTAMP
       WHERE rule_id=$1`,
      [rule.rule_id, rule.nominal, rule.behaviour, rule.monthly_amount ?? null, rule.annual_increase_pct ?? null,
       rule.rate ?? null, rule.sales_base || null, rule.start_period || null, rule.end_period || null,
       rule.department || null, rule.commentary || null]);
    return { ruleId: rule.rule_id };
  }
  const { rows } = await query(
    `INSERT INTO planning.cost_rule
       (version_id, scenario_code, scope, store_code, department, nominal, behaviour, monthly_amount,
        annual_increase_pct, rate, sales_base, start_period, end_period, commentary, created_by)
     VALUES ($1,COALESCE($2,'BASE'),$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,COALESCE($11,'ST: Sales'),$12,$13,$14,$15)
     RETURNING rule_id`,
    [rule.version_id, rule.scenario_code, rule.scope, rule.store_code || null, rule.department || null,
     rule.nominal, rule.behaviour, rule.monthly_amount ?? null, rule.annual_increase_pct ?? null, rule.rate ?? null,
     rule.sales_base || null, rule.start_period || null, rule.end_period || null, rule.commentary || null, actorOf(actor)]);
  await audit({ actor, eventType: "planning.cost_rule.upsert", objectType: "cost_rule", objectRef: String(rows[0].rule_id), detail: { nominal: rule.nominal, behaviour: rule.behaviour } });
  return { ruleId: rows[0].rule_id };
}

export async function deleteCostRule(ruleId, actor) {
  await query(`DELETE FROM planning.cost_rule WHERE rule_id=$1`, [ruleId]);
  await audit({ actor, eventType: "planning.cost_rule.delete", objectType: "cost_rule", objectRef: String(ruleId) });
  return { ok: true };
}

export async function upsertCostOverride(ruleId, period, amount, reason, actor) {
  if (!/^\d{4}-\d{2}$/.test(period || "")) throw new Error("Period must be YYYY-MM");
  await query(
    `INSERT INTO planning.cost_override (rule_id, period, amount, reason, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (rule_id, period) DO UPDATE SET amount=EXCLUDED.amount, reason=EXCLUDED.reason`,
    [ruleId, period, amount, reason || null, actorOf(actor)]);
  return { ok: true };
}

export async function listCostOverrides(ruleId) {
  try {
    const { rows } = await query(`SELECT period, amount, reason FROM planning.cost_override WHERE rule_id=$1 ORDER BY period`, [ruleId]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

/*
 * Compute a version's cost plan lines from its cost rules and write to plan_line
 * (source FIXED / PCT_OF_SALES). Percentage-of-sales rules read the store's
 * already-computed sales from plan_line (nominal = the rule's sales_base), so the
 * cost recalculates whenever sales change — run computeStoreSalesForVersion first.
 * Idempotent: prior FIXED / PCT_OF_SALES lines for the scope are cleared and rewritten.
 */
export async function computeCostsForVersion(versionId, { scenario = "BASE", storeCode = null } = {}, actor) {
  const rules = await listCostRules({ versionId, scenario, storeCode });
  await query(
    `DELETE FROM planning.plan_line
      WHERE version_id=$1 AND scenario_code=$2 AND source IN ('FIXED','PCT_OF_SALES')
        AND ($3::varchar IS NULL OR store_code=$3)`,
    [versionId, scenario, storeCode]);
  if (!rules.length) return { written: 0, rules: 0 };
  const meta = await storeMasterMap();
  let written = 0;
  for (const rule of rules) {
    let lines = [];
    if (rule.behaviour === "FIXED_MONTHLY") {
      const overrides = await listCostOverrides(rule.rule_id);
      lines = computeFixedCostLines(rule, overrides);
    } else if (rule.behaviour === "PCT_OF_SALES") {
      const { rows: sales } = await query(
        `SELECT period, SUM(amount) AS amount FROM planning.plan_line
          WHERE version_id=$1 AND scenario_code=$2 AND nominal=$3
            AND ($4::varchar IS NULL OR store_code=$4) AND ($5::varchar IS NULL OR store_code=$5)
          GROUP BY period`,
        [versionId, scenario, rule.sales_base, rule.store_code, storeCode]);
      lines = computePctOfSalesLines(rule, Object.fromEntries(sales.map((s) => [s.period, Number(s.amount)])));
    }
    const m = meta.get(rule.store_code) || {};
    for (const ln of lines) {
      await query(
        `INSERT INTO planning.plan_line
           (version_id, scenario_code, scope, store_code, entity_id, department, nominal, period, amount, driver_code, source, lineage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [versionId, scenario, rule.scope, rule.store_code || null, m.entity_id || null, rule.department || null,
         ln.nominal, ln.period, ln.amount, ln.driver_code, ln.source, JSON.stringify(ln.lineage)]);
      written++;
    }
  }
  await audit({ actor, eventType: "planning.costs.compute", objectType: "plan_version", objectRef: String(versionId), detail: { scenario, rules: rules.length, lines: written } });
  return { written, rules: rules.length };
}

// ---- Payroll chain — Phase 2c -------------------------------------------

export async function listPayrollRules({ versionId, scenario = null, scope = null, storeCode = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.payroll_rule
        WHERE version_id = $1
          AND ($2::varchar IS NULL OR scenario_code = $2)
          AND ($3::varchar IS NULL OR scope = $3)
          AND ($4::varchar IS NULL OR store_code = $4)
        ORDER BY scope, store_code, department`,
      [versionId, scenario, scope, storeCode]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function upsertPayrollRule(rule, actor) {
  const err = validatePayrollRule(rule);
  if (err) throw new Error(err);
  if (rule.rule_id) {
    await query(
      `UPDATE planning.payroll_rule SET
         monthly_basic=$2, annual_increase_pct=COALESCE($3,0), start_period=$4, end_period=$5,
         holiday_pct=$6, pension_pct=$7, er_ni_pct=$8, ni_threshold_monthly=$9,
         nominal_basic=COALESCE($10,$16), nominal_holiday=COALESCE($11,$17),
         nominal_pension=COALESCE($12,$18), nominal_er_ni=COALESCE($13,$19),
         department=$14, commentary=$15, updated_at=CURRENT_TIMESTAMP
       WHERE rule_id=$1`,
      [rule.rule_id, rule.monthly_basic, rule.annual_increase_pct ?? null, rule.start_period, rule.end_period,
       rule.holiday_pct ?? null, rule.pension_pct ?? null, rule.er_ni_pct ?? null, rule.ni_threshold_monthly ?? null,
       rule.nominal_basic || null, rule.nominal_holiday || null, rule.nominal_pension || null, rule.nominal_er_ni || null,
       rule.department || null, rule.commentary || null,
       DEFAULT_PAYROLL_NOMINALS.basic, DEFAULT_PAYROLL_NOMINALS.holiday, DEFAULT_PAYROLL_NOMINALS.pension, DEFAULT_PAYROLL_NOMINALS.er_ni]);
    return { ruleId: rule.rule_id };
  }
  const { rows } = await query(
    `INSERT INTO planning.payroll_rule
       (version_id, scenario_code, scope, store_code, department, monthly_basic, annual_increase_pct,
        start_period, end_period, holiday_pct, pension_pct, er_ni_pct, ni_threshold_monthly,
        nominal_basic, nominal_holiday, nominal_pension, nominal_er_ni, commentary, created_by)
     VALUES ($1,COALESCE($2,'BASE'),$3,$4,$5,$6,COALESCE($7,0),$8,$9,$10,$11,$12,$13,
             COALESCE($14,$20),COALESCE($15,$21),
             COALESCE($16,$22),COALESCE($17,$23),$18,$19)
     RETURNING rule_id`,
    [rule.version_id, rule.scenario_code, rule.scope, rule.store_code || null, rule.department || null,
     rule.monthly_basic, rule.annual_increase_pct ?? null, rule.start_period, rule.end_period,
     rule.holiday_pct ?? null, rule.pension_pct ?? null, rule.er_ni_pct ?? null, rule.ni_threshold_monthly ?? null,
     rule.nominal_basic || null, rule.nominal_holiday || null, rule.nominal_pension || null, rule.nominal_er_ni || null,
     rule.commentary || null, actorOf(actor),
     DEFAULT_PAYROLL_NOMINALS.basic, DEFAULT_PAYROLL_NOMINALS.holiday, DEFAULT_PAYROLL_NOMINALS.pension, DEFAULT_PAYROLL_NOMINALS.er_ni]);
  await audit({ actor, eventType: "planning.payroll_rule.upsert", objectType: "payroll_rule", objectRef: String(rows[0].rule_id), detail: { scope: rule.scope, store: rule.store_code } });
  return { ruleId: rows[0].rule_id };
}

export async function deletePayrollRule(ruleId, actor) {
  await query(`DELETE FROM planning.payroll_rule WHERE rule_id=$1`, [ruleId]);
  await audit({ actor, eventType: "planning.payroll_rule.delete", objectType: "payroll_rule", objectRef: String(ruleId) });
  return { ok: true };
}

export async function upsertPayrollOverride(ruleId, period, monthlyBasic, reason, actor) {
  if (!/^\d{4}-\d{2}$/.test(period || "")) throw new Error("Period must be YYYY-MM");
  await query(
    `INSERT INTO planning.payroll_override (rule_id, period, monthly_basic, reason, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (rule_id, period) DO UPDATE SET monthly_basic=EXCLUDED.monthly_basic, reason=EXCLUDED.reason`,
    [ruleId, period, monthlyBasic, reason || null, actorOf(actor)]);
  return { ok: true };
}

export async function listPayrollOverrides(ruleId) {
  try {
    const { rows } = await query(`SELECT period, monthly_basic, reason FROM planning.payroll_override WHERE rule_id=$1 ORDER BY period`, [ruleId]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

/*
 * Compute a version's payroll chain from its payroll rules and write the four
 * component lines (basic / holiday / pension / employer NI) to plan_line
 * (source PAYROLL). Blank rates on a rule fall back to the Assumption Register
 * (company→region→entity→store) via the PAYROLL_* drivers. Entity is derived from
 * the Store Master. Idempotent: prior PAYROLL lines for the scope are rewritten.
 */
export async function computePayrollForVersion(versionId, { scenario = "BASE", storeCode = null } = {}, actor) {
  const rules = await listPayrollRules({ versionId, scenario, storeCode });
  await query(
    `DELETE FROM planning.plan_line
      WHERE version_id=$1 AND scenario_code=$2 AND source='PAYROLL'
        AND ($3::varchar IS NULL OR store_code=$3)`,
    [versionId, scenario, storeCode]);
  if (!rules.length) return { written: 0, rules: 0 };
  const meta = await storeMasterMap();
  // Pre-load register candidates for each payroll rate driver.
  const assum = {};
  for (const code of Object.values(PAYROLL_RATE_DRIVERS)) {
    assum[code] = await listAssumptions({ driverCode: code, scenario, includeDrafts: false });
  }
  let written = 0;
  for (const rule of rules) {
    const m = meta.get(rule.store_code) || {};
    const fromRegister = (code, period) => {
      const r = resolveAssumption(assum[code] || [], { driverCode: code, scope: rule.scope, storeCode: rule.store_code, region: m.region, entity: m.entity_code, period, scenario });
      return r ? Number(r.value) : 0;
    };
    // A rate set on the rule wins; otherwise fall back to the register (using the rule's start period as context).
    const rates = {
      holiday_pct: rule.holiday_pct != null ? Number(rule.holiday_pct) : fromRegister(PAYROLL_RATE_DRIVERS.holiday_pct, rule.start_period),
      pension_pct: rule.pension_pct != null ? Number(rule.pension_pct) : fromRegister(PAYROLL_RATE_DRIVERS.pension_pct, rule.start_period),
      er_ni_pct: rule.er_ni_pct != null ? Number(rule.er_ni_pct) : fromRegister(PAYROLL_RATE_DRIVERS.er_ni_pct, rule.start_period),
      ni_threshold_monthly: rule.ni_threshold_monthly != null ? Number(rule.ni_threshold_monthly) : fromRegister(PAYROLL_RATE_DRIVERS.ni_threshold_monthly, rule.start_period),
    };
    const overrides = await listPayrollOverrides(rule.rule_id);
    const lines = computePayrollLines(rule, rates, overrides);
    for (const ln of lines) {
      await query(
        `INSERT INTO planning.plan_line
           (version_id, scenario_code, scope, store_code, entity_id, department, nominal, period, amount, driver_code, source, lineage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PAYROLL',$11)`,
        [versionId, scenario, rule.scope, rule.store_code || null, m.entity_id || null, rule.department || null,
         ln.nominal, ln.period, ln.amount, ln.driver_code, JSON.stringify(ln.lineage)]);
      written++;
    }
  }
  await audit({ actor, eventType: "planning.payroll.compute", objectType: "plan_version", objectRef: String(versionId), detail: { scenario, rules: rules.length, lines: written } });
  return { written, rules: rules.length };
}

// ---- Scope P&L assembly — Phase 3a --------------------------------------

// Planning scope → the pl_format scope_kind whose template renders it.
const SCOPE_FORMAT_KIND = {
  COMPANY_STORE: "store",
  FRANCHISE_STORE: "franchise",
  HEAD_OFFICE: "head_office",
  CONSOLIDATION_ADJUSTMENT: "consolidated",
};

// Minimal fallback layout when a scope has no governed template: one line per
// nominal + a total, so HO / consolidated still render something honest.
function flatFormat(accounts) {
  const accs = [...accounts].sort();
  return [
    { kind: "section", label: "Plan lines" },
    ...accs.map((a) => ({ kind: "line", label: a, accounts: [a] })),
    { kind: "total", label: "Total", of: accs, strong: true },
  ];
}

/*
 * Assemble a scope's budgeted P&L from the computed plan lines, rendered through
 * the SAME governed pl_format template the actuals board packs use. Aggregates
 * planning.plan_line by nominal × period into the { account → { period → amount } }
 * map renderFormat consumes, so a plan and an actual of the same scope render
 * identically. Also returns `unmapped` — present nominals no template line claims
 * (which would silently drop out of the P&L) — the seam's honesty check.
 *   opts: { scenario, scope, storeCode?, entityId?, months? }
 */
export async function getScopePL(versionId, { scenario = "BASE", scope = "COMPANY_STORE", storeCode = null, entityId = null, months = null } = {}) {
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT nominal, period, SUM(amount) AS amount
         FROM planning.plan_line
        WHERE version_id = $1 AND scenario_code = $2 AND scope = $3
          AND ($4::varchar IS NULL OR store_code = $4)
          AND ($5::bigint IS NULL OR entity_id = $5)
        GROUP BY nominal, period`,
      [versionId, scenario, scope, storeCode, entityId]));
  } catch (e) { if (!absent(e)) throw e; }

  const cols = months && months.length ? months : [...new Set(rows.map((r) => r.period))].sort();
  const accountVals = {};
  for (const r of rows) (accountVals[r.nominal] ||= {})[r.period] = Number(r.amount);
  const present = Object.keys(accountVals);

  const kind = SCOPE_FORMAT_KIND[scope] || "store";
  const spec = (await getFormatSpec(kind)) || flatFormat(present);
  const pnl = renderFormat(spec, accountVals, cols);
  const formatName = SCOPE_KINDS.find((s) => s.kind === kind)?.name || kind;

  return {
    scope, scenario, formatKind: kind, formatName,
    cols, rows: pnl, accountVals, present,
    unmapped: unmappedNominals(spec, present),
  };
}

// ---- Consolidation — Phase 4 -------------------------------------------

export async function listConsolidationAdjustments({ versionId, scenario = null, status = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT * FROM planning.consolidation_adjustment
        WHERE version_id = $1
          AND ($2::varchar IS NULL OR scenario_code = $2)
          AND ($3::varchar IS NULL OR status = $3)
        ORDER BY period, nominal, adj_id`,
      [versionId, scenario, status]);
    return rows;
  } catch (e) { if (absent(e)) return []; throw e; }
}

export async function upsertConsolidationAdjustment(a, actor) {
  if (!a?.version_id) throw new Error("A version is required");
  if (!a?.nominal || !String(a.nominal).trim()) throw new Error("A nominal is required");
  if (!/^\d{4}-\d{2}$/.test(a.period || "")) throw new Error("Period must be YYYY-MM");
  if (a.amount == null || !Number.isFinite(Number(a.amount))) throw new Error("An amount is required");
  if (!a?.reason || !String(a.reason).trim()) throw new Error("A documented reason is required"); // no unexplained plug
  if (a.adj_id) {
    await query(
      `UPDATE planning.consolidation_adjustment SET
         kind=COALESCE($2,'MANAGEMENT'), nominal=$3, period=$4, amount=$5, entity_id=$6,
         counterparty_entity_id=$7, reason=$8, updated_at=CURRENT_TIMESTAMP
       WHERE adj_id=$1`,
      [a.adj_id, a.kind || null, a.nominal, a.period, a.amount, a.entity_id || null, a.counterparty_entity_id || null, a.reason]);
    return { adjId: a.adj_id };
  }
  const { rows } = await query(
    `INSERT INTO planning.consolidation_adjustment
       (version_id, scenario_code, kind, nominal, period, amount, entity_id, counterparty_entity_id, reason, created_by)
     VALUES ($1,COALESCE($2,'BASE'),COALESCE($3,'MANAGEMENT'),$4,$5,$6,$7,$8,$9,$10)
     RETURNING adj_id`,
    [a.version_id, a.scenario_code, a.kind || null, a.nominal, a.period, a.amount,
     a.entity_id || null, a.counterparty_entity_id || null, a.reason, actorOf(actor)]);
  await audit({ actor, eventType: "planning.cons_adj.upsert", objectType: "consolidation_adjustment", objectRef: String(rows[0].adj_id), detail: { nominal: a.nominal, period: a.period, amount: a.amount } });
  return { adjId: rows[0].adj_id };
}

export async function setConsolidationAdjustmentApproval(adjId, status, actor) {
  if (!["DRAFT", "APPROVED"].includes(status)) throw new Error("Unknown status");
  await query(
    `UPDATE planning.consolidation_adjustment SET status=$2, reviewed_by=$3, updated_at=CURRENT_TIMESTAMP WHERE adj_id=$1`,
    [adjId, status, actorOf(actor)]);
  await audit({ actor, eventType: "planning.cons_adj.approval", objectType: "consolidation_adjustment", objectRef: String(adjId), detail: { status } });
  return { ok: true };
}

export async function deleteConsolidationAdjustment(adjId, actor) {
  await query(`DELETE FROM planning.consolidation_adjustment WHERE adj_id=$1`, [adjId]);
  await audit({ actor, eventType: "planning.cons_adj.delete", objectType: "consolidation_adjustment", objectRef: String(adjId) });
  return { ok: true };
}

// The scope columns of the Consolidated P&L, left → right.
const CONS_COLUMNS = [
  { key: "COMPANY_STORE", label: "Company Stores" },
  { key: "HEAD_OFFICE", label: "Head Office" },
  { key: "FRANCHISE_STORE", label: "Franchise Stores" },
  { key: "ADJUSTMENTS", label: "Adjustments" },
  { key: "CONSOLIDATED", label: "Consolidated" },
];

/*
 * The Consolidated P&L: Σ approved COMPANY_STORE + HEAD_OFFICE + FRANCHISE_STORE
 * plan_line + Σ APPROVED consolidation_adjustment, all rendered through the SAME
 * governed `consolidated` pl_format template (never a hard-coded layout). Returns one
 * row per template line with the annual total per column (Company Stores / Head Office
 * / Franchise / Adjustments / Consolidated), so the Consolidated column reconciles to
 * the sum of the scope columns + adjustments by construction.
 */
export async function getConsolidatedPL(versionId, { scenario = "BASE", months = null } = {}) {
  // Per-scope { nominal → { period → amount } } from plan_line.
  const byScope = {};
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT scope, nominal, period, SUM(amount) AS amount
         FROM planning.plan_line
        WHERE version_id = $1 AND scenario_code = $2
          AND scope IN ('COMPANY_STORE','HEAD_OFFICE','FRANCHISE_STORE')
        GROUP BY scope, nominal, period`,
      [versionId, scenario]));
  } catch (e) { if (!absent(e)) throw e; }
  for (const r of rows) {
    (byScope[r.scope] ||= {});
    (byScope[r.scope][r.nominal] ||= {})[r.period] = Number(r.amount);
  }

  // Approved adjustments → their own column.
  const adj = {};
  try {
    const { rows: ar } = await query(
      `SELECT nominal, period, SUM(amount) AS amount
         FROM planning.consolidation_adjustment
        WHERE version_id = $1 AND scenario_code = $2 AND status = 'APPROVED'
        GROUP BY nominal, period`,
      [versionId, scenario]);
    for (const r of ar) (adj[r.nominal] ||= {})[r.period] = Number(r.amount);
  } catch (e) { if (!absent(e)) throw e; }

  // Consolidated = element-wise sum of the three scopes + adjustments.
  const columnVals = {
    COMPANY_STORE: byScope.COMPANY_STORE || {},
    HEAD_OFFICE: byScope.HEAD_OFFICE || {},
    FRANCHISE_STORE: byScope.FRANCHISE_STORE || {},
    ADJUSTMENTS: adj,
  };
  const consolidated = {};
  for (const src of Object.values(columnVals)) {
    for (const [nom, byPeriod] of Object.entries(src)) {
      const t = (consolidated[nom] ||= {});
      for (const [p, v] of Object.entries(byPeriod)) t[p] = (t[p] || 0) + v;
    }
  }
  columnVals.CONSOLIDATED = consolidated;

  const present = [...new Set(Object.values(columnVals).flatMap((cv) => Object.keys(cv)))];
  const cols = months && months.length
    ? months
    : [...new Set(Object.values(columnVals).flatMap((cv) => Object.values(cv).flatMap((bp) => Object.keys(bp))))].sort();

  const spec = (await getFormatSpec("consolidated")) || flatFormat(present);

  // Render the SAME template for each column; zip the aligned rows by index.
  const rendered = Object.fromEntries(CONS_COLUMNS.map((c) => [c.key, renderFormat(spec, columnVals[c.key], cols)]));
  const template = rendered.CONSOLIDATED;
  const outRows = template.map((row, i) => ({
    kind: row.kind, label: row.label, strong: row.strong, tone: row.tone, isPct: row.isPct,
    cols: Object.fromEntries(CONS_COLUMNS.map((c) => [c.key, rendered[c.key][i]?.total ?? 0])),
  }));

  return {
    scenario,
    columns: CONS_COLUMNS,
    rows: outRows,
    unmapped: unmappedNominals(spec, present),
  };
}
