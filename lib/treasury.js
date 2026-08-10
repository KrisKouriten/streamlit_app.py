/*
 * Treasury — DB layer (migration 077). Reads and writes the five Treasury registers
 * and returns the summarised shapes the desk renders. All aggregation lives in
 * treasury-rules.js. Degrades to { ready:false } before migration 077 is applied.
 */

import { query, getPool } from "./db";
import { audit } from "./governance";
import {
  facilitySummary, termLoanSummary, hedgingSummary, salesIncomeSummary, cashReconSummary,
  isSalesStream, lcStage, lcStageLabel, facilityLifecycleSummary, reconcileDcFacility, parseFacilityCsv, unmatchedFacility,
} from "./treasury-rules.js";
import { facilityPosition } from "./suppliers.js";

const absent = (e) => e?.code === "42P01" || e?.code === "42703" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const safe = async (fn, fb) => { try { return await fn(); } catch (e) { if (absent(e)) return fb; throw e; } };
const nOrNull = (v) => (v == null || v === "" ? null : Number(v));

// ---- Bank trade facility (read-only register, seeded from HSBC) ----
const FACILITY_COLS = `id, reference, beneficiary, customer_reference, payment_currency, loan_amount, loan_currency,
  outstanding_amount, status, extension_settlement, product_type, loan_start_date, due_date, loan_period_days,
  payment_amount, payment_month, facility_payment_gbp, cost_driver`;

// pg returns date columns as JS Date objects; normalise them to plain ISO strings
// so the client never receives a Date (which would render as an invalid React child)
// and the month grouping keys on 'YYYY-MM' rather than a stringified Date.
const isoDate = (d) => (d == null ? null : (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)));

export async function getTradeFacility({ costDriver = null, product = null } = {}) {
  return safe(async () => {
    const { rows: raw } = await query(
      `SELECT ${FACILITY_COLS} FROM finance.bank_trade_facility
        WHERE ($1::varchar IS NULL OR cost_driver = $1)
          AND ($2::varchar IS NULL OR product_type = $2)
        ORDER BY payment_month, loan_start_date DESC`, [costDriver, product]);
    const rows = raw.map((r) => ({
      ...r,
      loan_start_date: isoDate(r.loan_start_date),
      due_date: isoDate(r.due_date),
      payment_month: isoDate(r.payment_month),
    }));
    return { ready: true, rows, summary: facilitySummary(rows) };
  }, { ready: false, rows: [], summary: null });
}

// Replace the whole bank trade facility register from an uploaded HSBC extract
// (Finance-only). Each upload is a full point-in-time statement, so the register
// is cleared and reloaded atomically — a parse error or a bad row rolls the whole
// thing back, leaving the previous register intact.
export async function uploadTradeFacility(csv, actor) {
  const { rows, errors } = parseFacilityCsv(csv);
  if (errors.length) throw new Error(errors.slice(0, 8).join(" "));
  if (!rows.length) throw new Error("No facility drawings found in the file.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM finance.bank_trade_facility");
    for (const r of rows) {
      await client.query(
        `INSERT INTO finance.bank_trade_facility
           (reference, beneficiary, customer_reference, payment_currency, loan_amount, loan_currency,
            outstanding_amount, status, product_type, loan_start_date, due_date, loan_period_days,
            payment_amount, payment_month, facility_payment_gbp, cost_driver, source_tag)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'CSV upload')`,
        [r.reference, r.beneficiary, r.customer_reference, r.payment_currency, r.loan_amount, r.loan_currency,
         r.outstanding_amount, r.status, r.product_type, r.loan_start_date, r.due_date, r.loan_period_days,
         r.payment_amount, r.payment_month, r.facility_payment_gbp, r.cost_driver]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e?.code === "42P01") throw new Error("The bank trade facility table is missing — run migration 077 first.");
    throw e;
  } finally { client.release(); }
  await audit({ actor, eventType: "treasury.facility.upload", objectType: "bank_trade_facility", objectRef: "replace", detail: { rows: rows.length } });
  return { ok: true, loaded: rows.length };
}

// Distinct customer references currently on the bank trade facility — used to
// suggest values when logging an LC so its customer reference matches the HSBC
// extract exactly. Never throws; empty before the facility table / data exists.
export async function facilityCustomerRefs() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT btrim(customer_reference) AS ref FROM finance.bank_trade_facility
        WHERE customer_reference IS NOT NULL AND btrim(customer_reference) <> '' ORDER BY 1`);
    return rows.map((r) => r.ref);
  } catch { return []; }
}

// ---- Bank term loans ----
const LOAN_COLS = `id, lender, reference, facility_type, currency, principal_gbp, balance_gbp, interest_rate,
  rate_basis, drawdown_date, maturity_date, repayment, notes, updated_at`;

export async function getTermLoans() {
  return safe(async () => {
    const { rows } = await query(`SELECT ${LOAN_COLS} FROM finance.bank_term_loan ORDER BY maturity_date NULLS LAST, id`);
    return { ready: true, rows, summary: termLoanSummary(rows) };
  }, { ready: false, rows: [], summary: null });
}

export async function saveTermLoan(r, actor) {
  if (!r.lender || !String(r.lender).trim()) throw new Error("Lender is required");
  const { rows } = await query(
    `INSERT INTO finance.bank_term_loan (id, lender, reference, facility_type, currency, principal_gbp, balance_gbp, interest_rate, rate_basis, drawdown_date, maturity_date, repayment, notes, updated_by, updated_at)
     VALUES (COALESCE($1, nextval('finance.bank_term_loan_id_seq')), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET lender=EXCLUDED.lender, reference=EXCLUDED.reference, facility_type=EXCLUDED.facility_type,
       currency=EXCLUDED.currency, principal_gbp=EXCLUDED.principal_gbp, balance_gbp=EXCLUDED.balance_gbp, interest_rate=EXCLUDED.interest_rate,
       rate_basis=EXCLUDED.rate_basis, drawdown_date=EXCLUDED.drawdown_date, maturity_date=EXCLUDED.maturity_date,
       repayment=EXCLUDED.repayment, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [r.id || null, r.lender.trim(), r.reference || null, r.facility_type || null, r.currency || "GBP",
     nOrNull(r.principal_gbp) || 0, nOrNull(r.balance_gbp) || 0, nOrNull(r.interest_rate), r.rate_basis || null,
     r.drawdown_date || null, r.maturity_date || null, r.repayment || null, r.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "treasury.term_loan.save", objectType: "bank_term_loan", objectRef: String(rows[0].id) });
  return { ok: true, id: rows[0].id };
}
export async function deleteTermLoan(id, actor) {
  await query(`DELETE FROM finance.bank_term_loan WHERE id = $1`, [id]);
  await audit({ actor, eventType: "treasury.term_loan.delete", objectType: "bank_term_loan", objectRef: String(id) });
  return { ok: true };
}

// ---- Hedging contracts ----
const HEDGE_COLS = `id, instrument, pair, notional, notional_ccy, rate, trade_date, value_date, counterparty, purpose, mtm_gbp, status, notes, updated_at`;

export async function getHedging() {
  return safe(async () => {
    const { rows } = await query(`SELECT ${HEDGE_COLS} FROM finance.hedging_contract ORDER BY value_date NULLS LAST, id`);
    return { ready: true, rows, summary: hedgingSummary(rows) };
  }, { ready: false, rows: [], summary: null });
}
export async function saveHedge(r, actor) {
  if (!r.instrument) throw new Error("Instrument is required");
  const { rows } = await query(
    `INSERT INTO finance.hedging_contract (id, instrument, pair, notional, notional_ccy, rate, trade_date, value_date, counterparty, purpose, mtm_gbp, status, notes, updated_by, updated_at)
     VALUES (COALESCE($1, nextval('finance.hedging_contract_id_seq')), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET instrument=EXCLUDED.instrument, pair=EXCLUDED.pair, notional=EXCLUDED.notional,
       notional_ccy=EXCLUDED.notional_ccy, rate=EXCLUDED.rate, trade_date=EXCLUDED.trade_date, value_date=EXCLUDED.value_date,
       counterparty=EXCLUDED.counterparty, purpose=EXCLUDED.purpose, mtm_gbp=EXCLUDED.mtm_gbp, status=EXCLUDED.status,
       notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [r.id || null, r.instrument, r.pair || null, nOrNull(r.notional) || 0, r.notional_ccy || null, nOrNull(r.rate),
     r.trade_date || null, r.value_date || null, r.counterparty || null, r.purpose || null, nOrNull(r.mtm_gbp),
     r.status || "OPEN", r.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "treasury.hedge.save", objectType: "hedging_contract", objectRef: String(rows[0].id) });
  return { ok: true, id: rows[0].id };
}
export async function deleteHedge(id, actor) {
  await query(`DELETE FROM finance.hedging_contract WHERE id = $1`, [id]);
  await audit({ actor, eventType: "treasury.hedge.delete", objectType: "hedging_contract", objectRef: String(id) });
  return { ok: true };
}

// ---- Sales income ----
export async function getSalesIncome() {
  return safe(async () => {
    const { rows } = await query(`SELECT id, stream, period, amount_gbp, received_gbp, notes FROM finance.sales_income ORDER BY period, stream`);
    return { ready: true, rows, summary: salesIncomeSummary(rows) };
  }, { ready: false, rows: [], summary: null });
}
export async function saveSalesIncome(r, actor) {
  if (!isSalesStream(r.stream)) throw new Error("Choose a valid income stream");
  if (!/^\d{4}-\d{2}$/.test(r.period || "")) throw new Error("Period must be YYYY-MM");
  await query(
    `INSERT INTO finance.sales_income (stream, period, amount_gbp, received_gbp, notes, source_tag, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,'MANUAL',$6,CURRENT_TIMESTAMP)
     ON CONFLICT (stream, period) DO UPDATE SET amount_gbp=EXCLUDED.amount_gbp, received_gbp=EXCLUDED.received_gbp,
       notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP`,
    [r.stream, r.period, nOrNull(r.amount_gbp) || 0, nOrNull(r.received_gbp), r.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "treasury.sales_income.save", objectType: "sales_income", objectRef: `${r.stream}·${r.period}` });
  return { ok: true };
}

// ---- Store cash reconciliation ----
export async function getCashRecon({ period = null } = {}) {
  return safe(async () => {
    const { rows } = await query(
      `SELECT id, store_code, store_name, period, expected_cash, banked_cash, status, notes
         FROM finance.store_cash_recon WHERE ($1::char(7) IS NULL OR period = $1) ORDER BY period DESC, store_code`, [period]);
    return { ready: true, rows, summary: cashReconSummary(rows) };
  }, { ready: false, rows: [], summary: null });
}
export async function saveCashRecon(r, actor) {
  if (!r.store_code || !String(r.store_code).trim()) throw new Error("Store code is required");
  if (!/^\d{4}-\d{2}$/.test(r.period || "")) throw new Error("Period must be YYYY-MM");
  await query(
    `INSERT INTO finance.store_cash_recon (store_code, store_name, period, expected_cash, banked_cash, status, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)
     ON CONFLICT (store_code, period) DO UPDATE SET store_name=EXCLUDED.store_name, expected_cash=EXCLUDED.expected_cash,
       banked_cash=EXCLUDED.banked_cash, status=EXCLUDED.status, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP`,
    [r.store_code.trim(), r.store_name || null, r.period, nOrNull(r.expected_cash) || 0, nOrNull(r.banked_cash) || 0,
     r.status || "OPEN", r.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "treasury.cash_recon.save", objectType: "store_cash_recon", objectRef: `${r.store_code}·${r.period}` });
  return { ok: true };
}

// ---- DC → LC → post-shipment loan lifecycle (Miniso imports) ----
// The merch-side LC pipeline (finance.procurement_lc) surfaced for Treasury: each
// LC with its parent purchase context and derived stage. Dates come through as
// 'YYYY-MM-DD' strings (never a Date). Degrades before migrations 083/084.
export async function getFacilityLifecycle() {
  return safe(async () => {
    const { rows } = await query(
      `SELECT l.lc_id, l.dc_reference, l.lc_reference, l.lc_bank, l.loan_type,
              to_char(l.lc_confirmed_date,'YYYY-MM-DD') AS lc_confirmed_date,
              to_char(l.lc_payment_date,'YYYY-MM-DD')   AS lc_payment_date,
              to_char(l.goods_arrived_date,'YYYY-MM-DD') AS goods_arrived_date,
              to_char(l.actual_payment_date,'YYYY-MM-DD') AS actual_payment_date,
              l.lc_settled, to_char(l.lc_settled_date,'YYYY-MM-DD') AS lc_settled_date,
              l.lc_amount, l.lc_settled_amount,
              p.reference AS purchase_ref, p.supplier, p.source, COALESCE(p.currency,'GBP') AS currency
         FROM finance.procurement_lc l
         JOIN finance.procurement_purchase p ON p.purchase_id = l.purchase_id
        ORDER BY COALESCE(l.actual_payment_date, l.goods_arrived_date, l.lc_confirmed_date) DESC NULLS LAST, l.lc_id DESC`);
    const withStage = rows.map((r) => {
      const stage = lcStage(r);
      return { ...r, lc_amount: r.lc_amount == null ? null : Number(r.lc_amount),
        lc_settled_amount: r.lc_settled_amount == null ? null : Number(r.lc_settled_amount),
        stage, stageLabel: lcStageLabel(stage) };
    });
    return { ready: true, rows: withStage, summary: facilityLifecycleSummary(withStage) };
  }, { ready: false, rows: [], summary: null });
}

// Reconcile the Miniso DCs / LCs (Procurement) against the bank trade facility
// drawings: per DC, its value vs LCs logged vs what HSBC has actually drawn,
// balance remaining, and which LCs haven't appeared on the facility yet.
// Degrades to { ready:false } before migration 093 (no procurement_dc).
export async function getDcFacilityReconciliation() {
  return safe(async () => {
    // LC customer_reference is post-094; fall back to NULL so this reads pre-094.
    const lcQuery = async () => {
      try { return (await query(`SELECT l.purchase_id, l.dc_reference, l.customer_reference, l.lc_reference, l.lc_amount, l.lc_settled, COALESCE(p.currency,'USD') AS currency
               FROM finance.procurement_lc l JOIN finance.procurement_purchase p ON p.purchase_id = l.purchase_id`)).rows; }
      catch (e) { if (e?.code !== "42703") throw e;
        return (await query(`SELECT l.purchase_id, l.dc_reference, NULL::varchar AS customer_reference, l.lc_reference, l.lc_amount, l.lc_settled, COALESCE(p.currency,'USD') AS currency
               FROM finance.procurement_lc l JOIN finance.procurement_purchase p ON p.purchase_id = l.purchase_id`)).rows; }
    };
    const [{ rows: dcs }, lcs, { rows: facility }] = await Promise.all([
      query(`SELECT d.dc_id, d.purchase_id, d.dc_reference, d.dc_value, COALESCE(d.currency, p.currency, 'USD') AS currency, p.reference AS purchase_ref
               FROM finance.procurement_dc d JOIN finance.procurement_purchase p ON p.purchase_id = d.purchase_id`),
      lcQuery(),
      query(`SELECT reference, customer_reference, loan_amount, outstanding_amount,
                    to_char(due_date,'YYYY-MM-DD') AS due_date, status
               FROM finance.bank_trade_facility`),
    ]);
    const lcClean = lcs.map((l) => ({ ...l, lc_amount: l.lc_amount == null ? null : Number(l.lc_amount) }));
    const recon = reconcileDcFacility(
      dcs.map((d) => ({ ...d, dc_value: d.dc_value == null ? null : Number(d.dc_value) })),
      lcClean, facility);
    // Facility drawings with no matching LC in Procurement (add the LC to clear).
    const orphans = unmatchedFacility(lcClean, facility);
    return { ready: true, ...recon, orphans };
  }, { ready: false, rows: [], totals: null, orphans: [] });
}

// The whole Treasury picture for the desk in one read.
export async function getTreasuryOverview() {
  const [facility, loans, hedging, sales, recon, lifecycle, position, dcRecon] = await Promise.all([
    getTradeFacility(), getTermLoans(), getHedging(), getSalesIncome(), getCashRecon(),
    getFacilityLifecycle(), facilityPosition("HSBC").catch(() => null),
    getDcFacilityReconciliation().catch(() => ({ ready: false, rows: [], totals: null })),
  ]);
  return { facility, loans, hedging, sales, recon, lifecycle, position, dcRecon };
}
