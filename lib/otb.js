/*
 * Merchandising Open-to-Buy — DB layer. Reads and writes the merch.* model
 * (migration 065); the calculation itself lives in otb-rules.js. Degrades to
 * []/null before the schema exists (42P01 / 3F000) like the rest of the codebase,
 * and every mutation is audited. The approved-store-sales read is a pluggable
 * adapter so OTB can reconcile to whichever forecast stack Finance nominates.
 */

import { query } from "./db";
import { audit } from "./governance";
import { getPlanLines } from "./planning.js";
import {
  plannedCostOfSales, targetStockFromWeeks, availableWarehouse, inTransitAvailable,
  clearanceReduction, computeRemainingOtb, OTB_CHANNELS, reconcileStore,
} from "./otb-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (absent(e)) return fallback; throw e; } };

// ---- Channels & versions ----
export async function listChannels() {
  return safe(async () => (await query(`SELECT channel_code, channel_name, sort_order, active FROM merch.channel WHERE active ORDER BY sort_order`)).rows, []);
}

const VERSION_COLS = `otb_version_id, label, fiscal_year, sales_source, plan_version_id, forecast_version_id,
  scenario_code, inventory_through, status, approved_by, approved_at, notes, created_by, created_at, updated_at`;

export async function listOtbVersions() {
  return safe(async () => (await query(`SELECT ${VERSION_COLS} FROM merch.otb_version ORDER BY created_at DESC`)).rows, []);
}

export async function getOtbVersion(id) {
  return safe(async () => (await query(`SELECT ${VERSION_COLS} FROM merch.otb_version WHERE otb_version_id = $1`, [id])).rows[0] || null, null);
}

export async function createOtbVersion(input, actor) {
  const { rows } = await query(
    `INSERT INTO merch.otb_version (label, fiscal_year, sales_source, plan_version_id, forecast_version_id, scenario_code, inventory_through, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING otb_version_id`,
    [input.label, input.fiscal_year || null, input.sales_source || "MANUAL", input.plan_version_id || null,
     input.forecast_version_id || null, input.scenario_code || "BASE", input.inventory_through || null,
     input.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "otb.version.create", objectType: "otb_version", objectRef: String(rows[0].otb_version_id), detail: { label: input.label } });
  return { ok: true, otbVersionId: rows[0].otb_version_id };
}

const isLocked = (v) => v?.status === "LOCKED";

// Approve / lock / reopen / archive an OTB version. Locked versions are frozen;
// procurement requests retain the version they were approved against.
export async function setOtbVersionApproval(id, action, actor, note) {
  const v = await getOtbVersion(id);
  if (!v) throw new Error("OTB version not found");
  const map = {
    approve: { from: ["DRAFT"], to: "APPROVED" },
    lock: { from: ["DRAFT", "APPROVED"], to: "LOCKED" },
    reopen: { from: ["APPROVED", "LOCKED"], to: "DRAFT" },
    archive: { from: ["DRAFT", "APPROVED", "LOCKED"], to: "ARCHIVED" },
  }[action];
  if (!map) throw new Error(`Unknown action '${action}'`);
  if (!map.from.includes(v.status)) throw new Error(`Cannot ${action} an OTB version that is ${v.status}`);
  const stampApproved = map.to === "APPROVED" || map.to === "LOCKED";
  await query(
    `UPDATE merch.otb_version SET status = $2,
       approved_by = CASE WHEN $3 THEN $4 ELSE approved_by END,
       approved_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE approved_at END,
       updated_at = CURRENT_TIMESTAMP WHERE otb_version_id = $1`,
    [id, map.to, stampApproved, actorOf(actor)]);
  await query(`INSERT INTO merch.otb_approval (otb_version_id, action, actor, note) VALUES ($1,$2,$3,$4)`,
    [id, action.toUpperCase(), actorOf(actor), note || null]);
  await audit({ actor, eventType: `otb.version.${action}`, objectType: "otb_version", objectRef: String(id), detail: { to: map.to } });
  return { ok: true, status: map.to };
}

async function assertEditable(versionId) {
  const v = await getOtbVersion(versionId);
  if (!v) throw new Error("OTB version not found");
  if (isLocked(v)) throw new Error("This OTB version is locked — reopen it to make changes");
  return v;
}

// ---- Store-level channel sales split ----
export async function getStoreSales(versionId, { scenario = "BASE" } = {}) {
  return safe(async () => (await query(
    `SELECT id, store_code, period, channel_code, sales_amount, approved_store_sales, mix_pct, source, commentary
       FROM merch.otb_store_sales WHERE otb_version_id = $1 AND scenario_code = $2
       ORDER BY store_code, period, channel_code`, [versionId, scenario])).rows, []);
}

export async function saveStoreSales(versionId, rows, actor) {
  await assertEditable(versionId);
  const scenario = rows[0]?.scenario_code || "BASE";
  for (const r of rows) {
    await query(
      `INSERT INTO merch.otb_store_sales (otb_version_id, scenario_code, store_code, period, channel_code, sales_amount, approved_store_sales, mix_pct, source, commentary, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
       ON CONFLICT (otb_version_id, scenario_code, store_code, period, channel_code) DO UPDATE SET
         sales_amount = EXCLUDED.sales_amount, approved_store_sales = EXCLUDED.approved_store_sales,
         mix_pct = EXCLUDED.mix_pct, source = EXCLUDED.source, commentary = EXCLUDED.commentary, updated_at = CURRENT_TIMESTAMP`,
      [versionId, r.scenario_code || scenario, r.store_code, r.period, r.channel_code, Number(r.sales_amount) || 0,
       r.approved_store_sales == null ? null : Number(r.approved_store_sales), r.mix_pct == null ? null : Number(r.mix_pct),
       r.source || "PCT_MIX", r.commentary || null]);
  }
  await audit({ actor, eventType: "otb.store_sales.save", objectType: "otb_version", objectRef: String(versionId), detail: { rows: rows.length } });
  return { ok: true };
}

/*
 * The pluggable approved-store-sales adapter. Returns [{ store_code, period,
 * approved_sales }]. PLANNING reads the driver engine's plan_line (ST: Sales);
 * FORECAST_VERSION is reserved for the legacy stack; MANUAL (the default until
 * Finance nominates the source) uses the approved figure entered on the split.
 */
export async function getApprovedStoreSales(version, { scenario = "BASE", storeCode = null } = {}) {
  if (!version) return [];
  if (version.sales_source === "PLANNING" && version.plan_version_id) {
    const lines = await safe(() => getPlanLines({
      versionId: version.plan_version_id, scenario: version.scenario_code || scenario,
      scope: "COMPANY_STORE", storeCode, source: "SALES_DRIVER",
    }), []);
    return (lines || []).filter((l) => l.nominal === "ST: Sales")
      .map((l) => ({ store_code: l.store_code, period: l.period, approved_sales: Number(l.amount) || 0 }));
  }
  // FORECAST_VERSION and MANUAL: the reconciliation uses the approved figure stored
  // on the split rows (entered by finance) until the source is confirmed & wired.
  return [];
}

// Reconcile the channel splits to approved store sales, per store, with tolerance.
export async function reconcileVersion(versionId, { scenario = "BASE" } = {}) {
  const version = await getOtbVersion(versionId);
  if (!version) return { ready: false, stores: [] };
  const [sales, assumptions] = await Promise.all([getStoreSales(versionId, { scenario }), getAssumptions(versionId)]);
  const tol = assumptions[0] || {};
  const approved = await getApprovedStoreSales(version, { scenario });
  const approvedMap = {};
  for (const a of approved) approvedMap[`${a.store_code}:${a.period}`] = (approvedMap[`${a.store_code}:${a.period}`] || 0) + a.approved_sales;

  const byStore = {};
  for (const r of sales) {
    const key = r.store_code;
    byStore[key] = byStore[key] || { store_code: key, channelAmounts: {}, approvedFromSplit: 0 };
    byStore[key].channelAmounts[r.channel_code] = (byStore[key].channelAmounts[r.channel_code] || 0) + Number(r.sales_amount || 0);
    if (r.approved_store_sales != null) byStore[key].approvedFromSplit += Number(r.approved_store_sales);
  }
  const stores = Object.values(byStore).map((s) => {
    // Prefer the live adapter figure; fall back to the manually-stored approved value.
    const adapterApproved = Object.keys(approvedMap).filter((k) => k.startsWith(`${s.store_code}:`)).reduce((t, k) => t + approvedMap[k], 0);
    const approvedStoreSales = adapterApproved || s.approvedFromSplit;
    const rec = reconcileStore({
      approvedStoreSales, channelAmounts: s.channelAmounts,
      tolerancePct: tol.tolerance_pct != null ? Number(tol.tolerance_pct) : 1.0,
      toleranceAbs: tol.tolerance_abs != null ? Number(tol.tolerance_abs) : null,
    });
    return { store_code: s.store_code, channelAmounts: s.channelAmounts, ...rec };
  });
  return { ready: true, salesSource: version.sales_source, stores };
}

// ---- Assumptions ----
export async function getAssumptions(versionId) {
  return safe(async () => (await query(
    `SELECT id, channel_code, cos_rate, gross_margin_rate, freight_pct, duty_pct, fx_rate, target_stock_weeks,
            clearance_realisation, transit_confidence, tolerance_pct, tolerance_abs, notes
       FROM merch.otb_assumption WHERE otb_version_id = $1 ORDER BY channel_code`, [versionId])).rows, []);
}

export async function saveAssumption(versionId, a, actor) {
  await assertEditable(versionId);
  const n = (v) => (v == null || v === "" ? null : Number(v));
  await query(
    `INSERT INTO merch.otb_assumption (otb_version_id, channel_code, cos_rate, gross_margin_rate, freight_pct, duty_pct, fx_rate, target_stock_weeks, clearance_realisation, transit_confidence, tolerance_pct, tolerance_abs, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
     ON CONFLICT (otb_version_id, channel_code) DO UPDATE SET
       cos_rate = EXCLUDED.cos_rate, gross_margin_rate = EXCLUDED.gross_margin_rate, freight_pct = EXCLUDED.freight_pct,
       duty_pct = EXCLUDED.duty_pct, fx_rate = EXCLUDED.fx_rate, target_stock_weeks = EXCLUDED.target_stock_weeks,
       clearance_realisation = EXCLUDED.clearance_realisation, transit_confidence = EXCLUDED.transit_confidence,
       tolerance_pct = EXCLUDED.tolerance_pct, tolerance_abs = EXCLUDED.tolerance_abs, notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [versionId, a.channel_code, n(a.cos_rate), n(a.gross_margin_rate), n(a.freight_pct) || 0, n(a.duty_pct) || 0,
     n(a.fx_rate) || 1, n(a.target_stock_weeks), n(a.clearance_realisation) ?? 0.7, n(a.transit_confidence) ?? 1.0,
     n(a.tolerance_pct) ?? 1.0, n(a.tolerance_abs), a.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "otb.assumption.save", objectType: "otb_version", objectRef: String(versionId), detail: { channel: a.channel_code } });
  return { ok: true };
}

// ---- Inventory positions (populated by inventory-ingest) ----
export async function getInventoryPositions(versionId) {
  return safe(async () => (await query(
    `SELECT id, channel_code, location_type, store_code, units, stock_value, reserved_value, damaged_value,
            confidence, stock_age_days, weeks_cover, data_through, source_tag
       FROM merch.otb_inventory_position WHERE otb_version_id = $1 ORDER BY channel_code, location_type, store_code`, [versionId])).rows, []);
}

// ---- Minimum stock rules ----
export async function listMinStockRules() {
  return safe(async () => (await query(`SELECT id, level, match_value, channel_code, basis, amount, active, notes FROM merch.min_stock_rule ORDER BY level, match_value`)).rows, []);
}
export async function saveMinStockRule(r, actor) {
  const { rows } = await query(
    `INSERT INTO merch.min_stock_rule (id, level, match_value, channel_code, basis, amount, active, notes, updated_by, updated_at)
     VALUES (COALESCE($1, nextval('merch.min_stock_rule_id_seq')), $2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET level=EXCLUDED.level, match_value=EXCLUDED.match_value, channel_code=EXCLUDED.channel_code,
       basis=EXCLUDED.basis, amount=EXCLUDED.amount, active=EXCLUDED.active, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [r.id || null, r.level, r.match_value || null, r.channel_code || null, r.basis, Number(r.amount) || 0, r.active !== false, r.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "otb.min_stock.save", objectType: "min_stock_rule", objectRef: String(rows[0].id) });
  return { ok: true, id: rows[0].id };
}
export async function deleteMinStockRule(id, actor) {
  await query(`DELETE FROM merch.min_stock_rule WHERE id = $1`, [id]);
  await audit({ actor, eventType: "otb.min_stock.delete", objectType: "min_stock_rule", objectRef: String(id) });
  return { ok: true };
}

// ---- Registers: new stores / closures / clearance (generic helpers) ----
export async function listNewStores(versionId) {
  return safe(async () => (await query(`SELECT * FROM merch.new_store_requirement WHERE otb_version_id = $1 ORDER BY planned_opening`, [versionId])).rows, []);
}
export async function saveNewStore(versionId, r, actor) {
  await assertEditable(versionId);
  const { rows } = await query(
    `INSERT INTO merch.new_store_requirement (id, otb_version_id, store_code, store_name, planned_opening, store_format, channel_code, opening_stock_value, fitout_inventory_value, phase, approved, notes, updated_at)
     VALUES (COALESCE($1, nextval('merch.new_store_requirement_id_seq')), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET store_code=EXCLUDED.store_code, store_name=EXCLUDED.store_name, planned_opening=EXCLUDED.planned_opening,
       store_format=EXCLUDED.store_format, channel_code=EXCLUDED.channel_code, opening_stock_value=EXCLUDED.opening_stock_value,
       fitout_inventory_value=EXCLUDED.fitout_inventory_value, phase=EXCLUDED.phase, approved=EXCLUDED.approved, notes=EXCLUDED.notes, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [r.id || null, versionId, r.store_code || null, r.store_name || null, r.planned_opening || null, r.store_format || null,
     r.channel_code, Number(r.opening_stock_value) || 0, Number(r.fitout_inventory_value) || 0, r.phase || "INITIAL", r.approved === true, r.notes || null]);
  await audit({ actor, eventType: "otb.new_store.save", objectType: "otb_version", objectRef: String(versionId) });
  return { ok: true, id: rows[0].id };
}
export async function listClosures(versionId) {
  return safe(async () => (await query(`SELECT * FROM merch.store_closure WHERE otb_version_id = $1 ORDER BY closure_date`, [versionId])).rows, []);
}
export async function saveClosure(versionId, r, actor) {
  await assertEditable(versionId);
  const { rows } = await query(
    `INSERT INTO merch.store_closure (id, otb_version_id, store_code, closure_date, channel_code, current_stock_value, transferable_value, non_transferable_value, write_off_value, transfer_destination, recovery_value, notes, updated_at)
     VALUES (COALESCE($1, nextval('merch.store_closure_id_seq')), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET store_code=EXCLUDED.store_code, closure_date=EXCLUDED.closure_date, channel_code=EXCLUDED.channel_code,
       current_stock_value=EXCLUDED.current_stock_value, transferable_value=EXCLUDED.transferable_value, non_transferable_value=EXCLUDED.non_transferable_value,
       write_off_value=EXCLUDED.write_off_value, transfer_destination=EXCLUDED.transfer_destination, recovery_value=EXCLUDED.recovery_value, notes=EXCLUDED.notes, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [r.id || null, versionId, r.store_code || null, r.closure_date || null, r.channel_code, Number(r.current_stock_value) || 0,
     Number(r.transferable_value) || 0, Number(r.non_transferable_value) || 0, Number(r.write_off_value) || 0,
     r.transfer_destination || null, r.recovery_value == null ? null : Number(r.recovery_value), r.notes || null]);
  await audit({ actor, eventType: "otb.closure.save", objectType: "otb_version", objectRef: String(versionId) });
  return { ok: true, id: rows[0].id };
}
export async function listClearance(versionId) {
  return safe(async () => (await query(`SELECT * FROM merch.clearance_plan WHERE otb_version_id = $1 ORDER BY start_date`, [versionId])).rows, []);
}
export async function saveClearance(versionId, r, actor) {
  await assertEditable(versionId);
  const n = (v) => (v == null || v === "" ? null : Number(v));
  const { rows } = await query(
    `INSERT INTO merch.clearance_plan (id, otb_version_id, location, channel_code, category, units, stock_value, stock_age_days, proposed_markdown_pct, expected_units_cleared, expected_revenue, expected_margin, realisation_rate, start_date, end_date, status, owner, notes, updated_at)
     VALUES (COALESCE($1, nextval('merch.clearance_plan_id_seq')), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET location=EXCLUDED.location, channel_code=EXCLUDED.channel_code, category=EXCLUDED.category,
       units=EXCLUDED.units, stock_value=EXCLUDED.stock_value, stock_age_days=EXCLUDED.stock_age_days, proposed_markdown_pct=EXCLUDED.proposed_markdown_pct,
       expected_units_cleared=EXCLUDED.expected_units_cleared, expected_revenue=EXCLUDED.expected_revenue, expected_margin=EXCLUDED.expected_margin,
       realisation_rate=EXCLUDED.realisation_rate, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, status=EXCLUDED.status, owner=EXCLUDED.owner, notes=EXCLUDED.notes, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [r.id || null, versionId, r.location || null, r.channel_code, r.category || null, n(r.units) || 0, n(r.stock_value) || 0,
     n(r.stock_age_days), n(r.proposed_markdown_pct), n(r.expected_units_cleared), n(r.expected_revenue), n(r.expected_margin),
     n(r.realisation_rate) ?? 0.7, r.start_date || null, r.end_date || null, r.status || "PLANNED", r.owner || null, r.notes || null]);
  await audit({ actor, eventType: "otb.clearance.save", objectType: "otb_version", objectRef: String(versionId) });
  return { ok: true, id: rows[0].id };
}

// ---- Commitments ----
export async function listCommitments(versionId) {
  return safe(async () => (await query(`SELECT id, channel_code, period, kind, amount, reference, source FROM merch.otb_commitment WHERE otb_version_id = $1 ORDER BY channel_code, period`, [versionId])).rows, []);
}

// ---- The compute engine ----
export async function computeOtb(versionId, { scenario = "BASE" } = {}, actor) {
  const version = await assertEditable(versionId);
  const [sales, assumptions, inv, newStores, closures, clearance, commitments] = await Promise.all([
    getStoreSales(versionId, { scenario }), getAssumptions(versionId), getInventoryPositions(versionId),
    listNewStores(versionId), listClosures(versionId), listClearance(versionId), listCommitments(versionId),
  ]);
  const asmByCh = Object.fromEntries(assumptions.map((a) => [a.channel_code, a]));
  const results = [];
  for (const ch of OTB_CHANNELS) {
    const a = asmByCh[ch] || {};
    const salesTotal = sales.filter((s) => s.channel_code === ch).reduce((t, s) => t + Number(s.sales_amount || 0), 0);
    const plannedCos = plannedCostOfSales(salesTotal, { cosRate: a.cos_rate, grossMarginRate: a.gross_margin_rate }) ?? 0;
    const targetClosingStock = targetStockFromWeeks(plannedCos, a.target_stock_weeks) ?? 0;
    const chInv = inv.filter((i) => i.channel_code === ch);
    const openingStoreStock = chInv.filter((i) => i.location_type === "STORE").reduce((t, i) => t + Number(i.stock_value || 0), 0);
    const openingWarehouseStock = chInv.filter((i) => i.location_type === "WAREHOUSE")
      .reduce((t, i) => t + availableWarehouse({ stockValue: i.stock_value, reservedValue: i.reserved_value, damagedValue: i.damaged_value }), 0);
    const inTransit = chInv.filter((i) => i.location_type === "IN_TRANSIT")
      .reduce((t, i) => t + inTransitAvailable({ value: i.stock_value, confidence: i.confidence }), 0);
    const approvedNew = newStores.filter((n) => n.channel_code === ch && n.approved);
    const newStoreStock = approvedNew.reduce((t, n) => t + Number(n.opening_stock_value || 0), 0);
    const fitoutInventory = approvedNew.reduce((t, n) => t + Number(n.fitout_inventory_value || 0), 0);
    const closureTransferable = closures.filter((c) => c.channel_code === ch).reduce((t, c) => t + Number(c.transferable_value || 0), 0);
    const clearanceRed = clearance.filter((c) => c.channel_code === ch)
      .reduce((t, c) => t + clearanceReduction({ stockValue: c.stock_value, realisationRate: c.realisation_rate }), 0);
    const openCommitments = commitments.filter((c) => c.channel_code === ch && c.kind === "OPEN_COMMITMENT").reduce((t, c) => t + Number(c.amount || 0), 0);
    const approvedRequests = commitments.filter((c) => c.channel_code === ch && c.kind === "APPROVED_REQUEST").reduce((t, c) => t + Number(c.amount || 0), 0);
    const { components, remainingOtb } = computeRemainingOtb({
      plannedCos, targetClosingStock, newStoreStock, fitoutInventory, adjustments: 0,
      openingStoreStock, openingWarehouseStock, inTransit, closureTransferable, openCommitments, approvedRequests, clearanceReduction: clearanceRed,
    });
    results.push({ channel: ch, salesTotal, components, remainingOtb });
  }
  // Persist the auditable component ledger (period='ALL' — a channel pool for the horizon).
  await query(`DELETE FROM merch.otb_component WHERE otb_version_id = $1 AND scenario_code = $2`, [versionId, scenario]);
  for (const r of results) {
    for (const c of r.components) {
      await query(`INSERT INTO merch.otb_component (otb_version_id, scenario_code, channel_code, period, component_code, amount, lineage) VALUES ($1,$2,$3,'ALL',$4,$5,$6)`,
        [versionId, scenario, r.channel, c.code, c.amount, JSON.stringify({ sign: c.sign, salesTotal: r.salesTotal })]);
    }
    await query(`INSERT INTO merch.otb_component (otb_version_id, scenario_code, channel_code, period, component_code, amount, lineage) VALUES ($1,$2,$3,'ALL','REMAINING_OTB',$4,$5)`,
      [versionId, scenario, r.channel, r.remainingOtb, JSON.stringify({ salesTotal: r.salesTotal })]);
  }
  await query(`UPDATE merch.otb_version SET updated_at = CURRENT_TIMESTAMP WHERE otb_version_id = $1`, [versionId]);
  await audit({ actor, eventType: "otb.compute", objectType: "otb_version", objectRef: String(versionId), detail: { scenario, channels: results.map((r) => ({ channel: r.channel, remainingOtb: r.remainingOtb })) } });
  return { ok: true, results };
}

// The computed components, shaped for the OTB summary (per channel + total).
export async function getOtbSummary(versionId, { scenario = "BASE" } = {}) {
  const rows = await safe(async () => (await query(
    `SELECT channel_code, component_code, amount FROM merch.otb_component WHERE otb_version_id = $1 AND scenario_code = $2`, [versionId, scenario])).rows, []);
  const byChannel = {};
  for (const ch of OTB_CHANNELS) byChannel[ch] = {};
  for (const r of rows) { byChannel[r.channel_code] = byChannel[r.channel_code] || {}; byChannel[r.channel_code][r.component_code] = Number(r.amount); }
  const total = {};
  for (const ch of OTB_CHANNELS) for (const [code, v] of Object.entries(byChannel[ch] || {})) total[code] = (total[code] || 0) + v;
  return { byChannel, total, computed: rows.length > 0 };
}

// Remaining OTB available to a procurement request for a channel (the version pool),
// net of commitments already recorded for that channel/period.
export async function availableOtb({ versionId, channel, period = null, scenario = "BASE" }) {
  const summary = await getOtbSummary(versionId, { scenario });
  const approvedOtb = summary.byChannel[channel]?.REMAINING_OTB || 0;
  const commits = await listCommitments(versionId);
  const openCommit = commits.filter((c) => c.channel_code === channel && (!period || c.period === period) && c.kind === "OPEN_COMMITMENT").reduce((t, c) => t + Number(c.amount || 0), 0);
  const approvedReq = commits.filter((c) => c.channel_code === channel && (!period || c.period === period) && c.kind === "APPROVED_REQUEST").reduce((t, c) => t + Number(c.amount || 0), 0);
  // REMAINING_OTB already nets version-level commitments; this exposes the pool +
  // the period breakdown for the request screen.
  return { approvedOtb, openCommitments: openCommit, approvedRequests: approvedReq, remaining: approvedOtb };
}

// ---- Channel transfers ----
export async function listTransfers(versionId) {
  return safe(async () => (await query(`SELECT * FROM merch.otb_transfer WHERE otb_version_id = $1 ORDER BY created_at DESC`, [versionId])).rows, []);
}
export async function saveTransfer(versionId, t, actor) {
  await query(
    `INSERT INTO merch.otb_transfer (otb_version_id, from_channel, to_channel, period, amount, reason, sales_mix_impact, margin_impact, cash_impact, requested_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUESTED')`,
    [versionId, t.from_channel, t.to_channel, t.period, Number(t.amount) || 0, t.reason || null, t.sales_mix_impact || null, t.margin_impact || null, t.cash_impact || null, actorOf(actor)]);
  await audit({ actor, eventType: "otb.transfer.request", objectType: "otb_version", objectRef: String(versionId), detail: { from: t.from_channel, to: t.to_channel, amount: t.amount } });
  return { ok: true };
}
export async function setTransferStatus(transferId, status, actor) {
  await query(`UPDATE merch.otb_transfer SET status = $2, approver = $3 WHERE id = $1`, [transferId, status, actorOf(actor)]);
  await audit({ actor, eventType: "otb.transfer.decision", objectType: "otb_transfer", objectRef: String(transferId), detail: { status } });
  return { ok: true };
}
