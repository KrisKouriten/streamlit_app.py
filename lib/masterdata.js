import { query } from "./db";
import { DIMENSIONS, statusFor } from "./masterdata-rules.js";

/*
 * Master data — DB layer. For each governed dimension, count its rows and find
 * when it was last changed (from the audit trail), so the hub can show a single
 * governed view with lineage. All reads are guarded: a missing table just reads
 * as an empty dimension rather than crashing the hub.
 */

async function countOf(table) {
  try {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0].n;
  } catch {
    return 0; // table absent or unreadable → treat as empty
  }
}

async function lastChange(objectType) {
  try {
    const { rows } = await query(
      `SELECT occurred_at, actor_email FROM governance.audit_event
       WHERE object_type = $1 ORDER BY occurred_at DESC LIMIT 1`, [objectType]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function getMasterDataOverview() {
  const rows = await Promise.all(DIMENSIONS.map(async (d) => {
    const [count, last] = await Promise.all([countOf(d.table), lastChange(d.objectType)]);
    return {
      key: d.key, label: d.label, table: d.table, screen: d.screen,
      count,
      lastChangedAt: last?.occurred_at || null,
      lastChangedBy: last?.actor_email || null,
      status: statusFor({ count, screen: d.screen }),
    };
  }));
  return rows;
}
