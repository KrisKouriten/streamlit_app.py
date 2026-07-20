import { query } from "./db";
import { audit } from "./governance";
import { CATEGORIES, parseCsv, mapRows } from "./intercompany-rules.js";

export { CATEGORIES, parseCsv, mapRows } from "./intercompany-rules.js";

const RECON_FLAGS = ["recon_credit", "recon_debit", "recon_balance_sheet", "recon_cashflow", "settled"];

async function entityMap() {
  const { rows } = await query(`SELECT entity_id, entity_name, legal_name FROM core.dim_entity WHERE is_active`);
  const m = new Map();
  for (const r of rows) {
    if (r.legal_name) m.set(r.legal_name.toLowerCase().trim(), r.entity_id);
    if (r.entity_name) m.set(r.entity_name.toLowerCase().trim(), r.entity_id);
  }
  return m;
}

export async function listEntitiesForPicker() {
  const { rows } = await query(
    `SELECT entity_id, entity_name FROM core.dim_entity WHERE is_active ORDER BY entity_name`);
  return rows;
}

export async function listTxns(category, { limit = 1000 } = {}) {
  const { rows } = await query(
    `SELECT t.*, ce.entity_name AS credit_name, de.entity_name AS debit_name
     FROM finance.intercompany_txn t
     LEFT JOIN core.dim_entity ce ON ce.entity_id = t.credit_entity_id
     LEFT JOIN core.dim_entity de ON de.entity_id = t.debit_entity_id
     WHERE t.category = $1 ORDER BY t.txn_date DESC, t.txn_id DESC LIMIT $2`,
    [category, limit]);
  return rows;
}

export async function getSummary(category) {
  const { rows } = await query(
    `SELECT count(*)::int AS n, COALESCE(SUM(gross_amount),0) AS total,
            count(*) FILTER (WHERE recon_balance_sheet)::int AS bs_reconciled
     FROM finance.intercompany_txn WHERE category = $1`, [category]);
  return rows[0];
}

async function insertTxn(t, source, actor) {
  await query(
    `INSERT INTO finance.intercompany_txn
       (category, txn_date, credit_entity_id, debit_entity_id, currency, gross_amount, net_amount, vat_amount,
        reference, invoice_number, supplier_name, nominal, payment_method,
        recon_credit, recon_debit, recon_balance_sheet, recon_cashflow, settled, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [t.category, t.txn_date || null, t.creditEntityId || null, t.debitEntityId || null, t.currency || "GBP",
     t.gross_amount ?? null, t.net_amount ?? null, t.vat_amount ?? null, t.reference || null, t.invoice_number || null,
     t.supplier_name || null, t.nominal || null, t.payment_method || null,
     !!t.recon_credit, !!t.recon_debit, !!t.recon_balance_sheet, !!t.recon_cashflow, !!t.settled, source, actor.email]);
}

export async function createTxn(rec, actor) {
  if (!CATEGORIES[rec.category]) throw new Error("Unknown category");
  if (!rec.creditEntityId || !rec.debitEntityId) throw new Error("Credit and debit entity are required");
  if (rec.gross_amount == null || !Number.isFinite(Number(rec.gross_amount))) throw new Error("A valid amount is required");
  await insertTxn({ ...rec, gross_amount: Number(rec.gross_amount) }, "MANUAL", actor);
  await audit({ actor, eventType: "intercompany.create", objectType: "intercompany_txn", objectRef: rec.category });
}

// Parse a CSV for one category, resolve entity names, insert the good rows.
export async function ingestCsv(category, csvText, actor) {
  if (!CATEGORIES[category]) throw new Error("Unknown category");
  const { headers, records } = parseCsv(csvText);
  const { records: mapped, errors } = mapRows(category, headers, records);
  const em = await entityMap();
  let inserted = 0;
  const rowErrors = [...errors];
  for (const m of mapped) {
    const cid = em.get((m.creditName || "").toLowerCase().trim());
    const did = em.get((m.debitName || "").toLowerCase().trim());
    if (!cid || !did) { rowErrors.push({ reason: `unknown entity: ${!cid ? m.creditName : m.debitName}` }); continue; }
    await insertTxn({ ...m, creditEntityId: cid, debitEntityId: did }, "CSV", actor);
    inserted++;
  }
  await audit({ actor, eventType: "intercompany.csv-upload", objectType: "intercompany_txn", objectRef: category, detail: { inserted, errors: rowErrors.length } });
  return { inserted, errors: rowErrors, parsed: records.length };
}

export async function toggleRecon(txnId, flag, value, actor) {
  if (!RECON_FLAGS.includes(flag)) throw new Error("Invalid flag");
  await query(`UPDATE finance.intercompany_txn SET ${flag} = $2 WHERE txn_id = $1`, [txnId, !!value]);
  await audit({ actor, eventType: "intercompany.recon", objectType: "intercompany_txn", objectRef: String(txnId), detail: { flag, value } });
}
