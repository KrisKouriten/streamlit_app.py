/*
 * Treasury — DB layer (migration 077). Reads and writes the five Treasury registers
 * and returns the summarised shapes the desk renders. All aggregation lives in
 * treasury-rules.js. Degrades to { ready:false } before migration 077 is applied.
 */

import { query } from "./db";
import { audit } from "./governance";
import {
  facilitySummary, termLoanSummary, hedgingSummary, salesIncomeSummary, cashReconSummary,
  isSalesStream,
} from "./treasury-rules.js";

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

// The whole Treasury picture for the desk in one read.
export async function getTreasuryOverview() {
  const [facility, loans, hedging, sales, recon] = await Promise.all([
    getTradeFacility(), getTermLoans(), getHedging(), getSalesIncome(), getCashRecon(),
  ]);
  return { facility, loans, hedging, sales, recon };
}
