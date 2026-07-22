import { query } from "./db";
import { audit } from "./governance";
import { validateVersion, versionTransitionError, compareVersions } from "./forecast-version-rules.js";

/*
 * Forecast & budget versions — DB layer. A version is a frozen snapshot of the
 * working forecast lines (finance.forecast_line) captured into
 * finance.forecast_version(+_line). Validity and lifecycle live in
 * forecast-version-rules.js; this layer is the reads and writes.
 */

const tableMissing = (e) => e?.code === "42P01";
const columnMissing = (e) => e?.code === "42703";

// Copy the current forecast lines into a new version. Returns { versionId, lineCount }.
export async function createVersionFromCurrent({ label, kind, fiscalYear = null, notes = null }, actor) {
  const err = validateVersion({ label, kind, fiscalYear });
  if (err) throw new Error(err);

  // How many lines are there to capture? Refuse an empty snapshot.
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM finance.forecast_line`);
  const lineCount = cnt[0]?.n || 0;
  if (!lineCount) throw new Error("There is no forecast loaded to snapshot — load the Forecast Builder first");

  const { rows } = await query(
    `INSERT INTO finance.forecast_version (label, kind, fiscal_year, notes, line_count, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING version_id`,
    [String(label).trim(), kind, fiscalYear || null, notes || null, lineCount, actor?.email || actor?.name || "system"]
  );
  const versionId = rows[0].version_id;

  try {
    await query(
      `INSERT INTO finance.forecast_version_line (version_id, scope, unit, entity, line_label, cost_type, ym, value)
       SELECT $1, scope, unit, entity, line_label, cost_type, ym, value FROM finance.forecast_line`,
      [versionId]
    );
  } catch (e) {
    if (!columnMissing(e)) throw e;
    // A database still missing forecast_line.entity (pre-018): snapshot without it.
    await query(
      `INSERT INTO finance.forecast_version_line (version_id, scope, unit, line_label, cost_type, ym, value)
       SELECT $1, scope, unit, line_label, cost_type, ym, value FROM finance.forecast_line`,
      [versionId]
    );
  }

  await audit({ actor, eventType: "forecast_version.create", objectType: "forecast_version", objectRef: String(versionId), detail: { label, kind, lineCount } });
  return { versionId, lineCount };
}

// List versions (optionally filtered by kind). Newest first.
export async function listVersions({ kind = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT version_id, label, kind, status, fiscal_year, notes, line_count,
              created_by, created_at, approved_by, approved_at, archived_at
       FROM finance.forecast_version
       ${kind ? "WHERE kind = $1" : ""}
       ORDER BY created_at DESC`,
      kind ? [kind] : []
    );
    return { ready: true, versions: rows };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, versions: [] };
    throw e;
  }
}

export async function getVersion(versionId) {
  const { rows } = await query(
    `SELECT version_id, label, kind, status, fiscal_year, notes, line_count,
            created_by, created_at, approved_by, approved_at, archived_at
     FROM finance.forecast_version WHERE version_id = $1`,
    [versionId]
  );
  return rows[0] || null;
}

export async function getVersionLines(versionId) {
  const { rows } = await query(
    `SELECT scope, unit, entity, line_label, cost_type, ym, value
     FROM finance.forecast_version_line WHERE version_id = $1`,
    [versionId]
  );
  return rows;
}

// Latest APPROVED version of a kind — the one the dashboard compares against by
// default (e.g. the approved budget). Returns { version, lines } or null.
export async function getLatestApproved(kind) {
  const { rows } = await query(
    `SELECT version_id FROM finance.forecast_version
     WHERE kind = $1 AND status = 'APPROVED' ORDER BY approved_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [kind]
  );
  if (!rows.length) return null;
  const version = await getVersion(rows[0].version_id);
  const lines = await getVersionLines(rows[0].version_id);
  return { version, lines };
}

async function requireStatusFor(action, versionId) {
  const v = await getVersion(versionId);
  if (!v) throw new Error("Version not found");
  const err = versionTransitionError(action, v.status);
  if (err) throw new Error(err);
  return v;
}

export async function approveVersion(versionId, actor) {
  await requireStatusFor("approve", versionId);
  await query(
    `UPDATE finance.forecast_version
     SET status = 'APPROVED', approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE version_id = $1`,
    [versionId, actor?.email || actor?.name || "system"]
  );
  await audit({ actor, eventType: "forecast_version.approve", objectType: "forecast_version", objectRef: String(versionId) });
}

export async function archiveVersion(versionId, actor) {
  await requireStatusFor("archive", versionId);
  await query(
    `UPDATE finance.forecast_version SET status = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP WHERE version_id = $1`,
    [versionId]
  );
  await audit({ actor, eventType: "forecast_version.archive", objectType: "forecast_version", objectRef: String(versionId) });
}

export async function deleteVersion(versionId, actor) {
  await requireStatusFor("delete", versionId);
  await query(`DELETE FROM finance.forecast_version WHERE version_id = $1`, [versionId]); // lines cascade
  await audit({ actor, eventType: "forecast_version.delete", objectType: "forecast_version", objectRef: String(versionId) });
}

// Line-for-line diff between two versions. Returns the rules' diff plus the two
// versions' metadata for labelling.
export async function compareVersionsById(aId, bId) {
  const [a, b, la, lb] = await Promise.all([getVersion(aId), getVersion(bId), getVersionLines(aId), getVersionLines(bId)]);
  if (!a || !b) throw new Error("One or both versions were not found");
  return { a, b, ...compareVersions(la, lb) };
}
