import { query } from "./db";
import { audit } from "./governance";
import { mapProfitAndLoss, ACCOUNT_MAP } from "./xero-rules.js";

export { mapProfitAndLoss, ACCOUNT_MAP } from "./xero-rules.js";

/*
 * Xero finance feed — write path. Feed-agnostic: ingestExtract takes a normalized
 * extract (already mapped to Finance OS account codes by lib/xero-rules) and
 * upserts it into finance.fact_financials / fact_bank_position tagged
 * source_system = 'XERO'. It never talks to Xero directly — the deployed app
 * can't reach the connector, so a Claude session (or a future scheduled routine)
 * produces the extract and calls this. Idempotent per (entity, scenario, period).
 */

const XERO = "XERO";

// extract: {
//   entityCode, dateKey (int YYYYMMDD), periodLabel,
//   lines: [{ account_code, amount_gbp }],
//   bank?: { available, facilityLimit, facilityUsed, headroom, reconciled, accountName },
//   source?: { org, refreshedAt },
// }
export async function ingestExtract(extract, actor) {
  const who = actor || { email: "system", name: "system" };
  const { rows: ent } = await query(`SELECT entity_id FROM core.dim_entity WHERE entity_code = $1`, [extract.entityCode]);
  if (!ent.length) throw new Error(`Unknown entity ${extract.entityCode}`);
  const entityId = ent[0].entity_id;
  const { rows: sc } = await query(`SELECT scenario_id FROM core.dim_scenario WHERE scenario_code = 'XERO-ACT'`);
  if (!sc.length) throw new Error("XERO-ACT scenario missing — run migration 006");
  const scenarioId = sc[0].scenario_id;
  const { rows: accts } = await query(`SELECT account_id, account_code FROM core.dim_account`);
  const acctId = Object.fromEntries(accts.map((a) => [a.account_code, a.account_id]));

  // Idempotent: replace this entity+scenario+period+source slice.
  await query(
    `DELETE FROM finance.fact_financials
     WHERE entity_id = $1 AND scenario_id = $2 AND date_key = $3 AND source_system = $4`,
    [entityId, scenarioId, extract.dateKey, XERO]
  );
  for (const l of extract.lines) {
    const id = acctId[l.account_code];
    if (!id) throw new Error(`No dim_account for ${l.account_code}`);
    await query(
      `INSERT INTO finance.fact_financials
         (date_key, entity_id, account_id, scenario_id, amount_local, amount_gbp, currency_code, source_system, source_reference, loaded_at)
       VALUES ($1,$2,$3,$4,$5,$5,'GBP',$6,$7,CURRENT_TIMESTAMP)`,
      [extract.dateKey, entityId, id, scenarioId, l.amount_gbp, XERO, extract.source?.org || null]
    );
  }

  if (extract.bank) {
    const b = extract.bank;
    await query(
      `DELETE FROM finance.fact_bank_position WHERE entity_id = $1 AND date_key = $2 AND source_system = $3`,
      [entityId, extract.dateKey, XERO]
    );
    await query(
      `INSERT INTO finance.fact_bank_position
         (date_key, entity_id, bank_name, account_name, currency_code, ledger_balance, available_balance,
          facility_limit, facility_used, headroom, is_reconciled, source_system)
       VALUES ($1,$2,$3,$4,'GBP',$5,$6,$7,$8,$9,$10,$11)`,
      [extract.dateKey, entityId, b.bankName || "Xero", b.accountName || "Cash",
       b.available ?? 0, b.available ?? 0, b.facilityLimit ?? 0, b.facilityUsed ?? 0, b.headroom ?? 0,
       b.reconciled ?? true, XERO]
    );
  }

  await query(
    `INSERT INTO governance.data_refresh_log (source_system, status, rows_loaded, started_at, completed_at)
     VALUES ($1, 'SUCCESS', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`Xero:${extract.source?.org || extract.entityCode}`, extract.lines.length]
  );
  await query(`UPDATE finance.xero_org_map SET last_loaded_at = CURRENT_TIMESTAMP WHERE entity_id = $1`, [entityId]);
  await audit({
    actor: who, eventType: "finance.xero-ingest", objectType: "fact_financials", objectRef: extract.entityCode,
    detail: { dateKey: extract.dateKey, lines: extract.lines.length, org: extract.source?.org },
  });
  return { entityId, lines: extract.lines.length };
}
