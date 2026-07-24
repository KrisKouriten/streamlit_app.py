import { query } from "./db";
import { audit } from "./governance";

/*
 * Report Builder — saved-report store (DB layer). Mirrors pl-format-store's
 * shape. Every write is audited; reads degrade to empty when migration 037
 * hasn't run yet (Postgres 42P01).
 */

const tableMissing = (e) => e?.code === "42P01";

export async function listReports() {
  try {
    const { rows } = await query(
      `SELECT report_id, name, dataset_key, params, version, owner, updated_by, updated_at
       FROM finance.report_def WHERE is_active ORDER BY updated_at DESC`
    );
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

export async function getReport(id) {
  try {
    const { rows } = await query(`SELECT * FROM finance.report_def WHERE report_id = $1 AND is_active`, [id]);
    return rows[0] || null;
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

export async function createReport({ name, datasetKey, params = {}, actor }) {
  const { rows } = await query(
    `INSERT INTO finance.report_def (name, dataset_key, params, owner, updated_by)
     VALUES ($1,$2,$3,$4,$4) RETURNING report_id`,
    [name, datasetKey, JSON.stringify(params || {}), actor]
  );
  await audit({ actor, eventType: "report.create", objectType: "report_def", objectRef: String(rows[0].report_id), detail: { name, datasetKey } });
  return rows[0].report_id;
}

export async function updateReport({ id, name, params, actor }) {
  await query(
    `UPDATE finance.report_def
     SET name = COALESCE($2, name), params = COALESCE($3, params), version = version + 1,
         updated_by = $4, updated_at = CURRENT_TIMESTAMP
     WHERE report_id = $1`,
    [id, name ?? null, params ? JSON.stringify(params) : null, actor]
  );
  await audit({ actor, eventType: "report.update", objectType: "report_def", objectRef: String(id), detail: { name } });
}

export async function deleteReport(id, actor) {
  await query(`UPDATE finance.report_def SET is_active = false, updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE report_id = $1`, [id, actor]);
  await audit({ actor, eventType: "report.delete", objectType: "report_def", objectRef: String(id) });
}
