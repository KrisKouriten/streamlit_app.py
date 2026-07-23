/*
 * Entity-map resolution — pure, import-free, unit-tested.
 * Decides the effective company-name → Joiin-id map from the hardcoded seed and
 * whatever the database holds. The seed is the safety net; once the table is
 * populated it is the source of truth (so a company can be retired via `active`
 * or added without a code change). Guards against ever handing back an empty
 * map — an empty map would make the Joiin refresh pull nothing.
 */

export function resolveEntityMap(seed, rows, tableExists) {
  // No table yet, or no rows: fall back to the code constant unchanged.
  if (!tableExists || !Array.isArray(rows) || rows.length === 0) return { ...seed };

  const out = {};
  for (const r of rows) {
    if (r && r.active !== false && r.joiin_id) out[r.entity_name] = r.joiin_id;
  }
  // Never leave the map empty (e.g. everything deactivated) — that would silently
  // stop the refresh. Fall back to the seed in that pathological case.
  return Object.keys(out).length ? out : { ...seed };
}
