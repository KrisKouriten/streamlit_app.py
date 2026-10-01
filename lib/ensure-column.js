import { query } from "./db";
import { REPAIRS } from "./migration-repairs.js";

/*
 * Add an optional column on first use, from the fixed, additive list in
 * migration-repairs.js — so a feature that records a new column works before
 * its migration has been run by hand on the branch the app reads. Once per
 * process per column; a failure (no ALTER rights, say) is swallowed and the
 * caller's own best-effort write then simply skips the column.
 */
const done = new Set();
export async function ensureColumn(key) {
  if (done.has(key)) return;
  const r = REPAIRS.find((x) => x.key === key);
  if (!r) return;
  try { await query(r.sql); done.add(key); } catch { /* left to the caller's fallback */ }
}
