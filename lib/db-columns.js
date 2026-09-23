/*
 * Which optional columns a table actually has.
 *
 * Migrations are applied by hand here, so a column a later migration adds may
 * simply not be there. Readers used to cope with nested try/catch ladders of
 * progressively shorter column lists — but each tier was built on the one below
 * it, so every richer tier depended on every poorer one. When `approval_status`
 * turned out to be missing on the live database, the FX tier sat on top of it
 * and the whole chain fell through to the base columns: one absent column took
 * out four unrelated features, silently.
 *
 * Asking the catalogue cannot degrade that way. A missing column costs only
 * itself, and adding a new optional column to a reader can never cascade.
 *
 * No cache: applying a migration takes effect on the next read rather than at
 * the next cold start, which matters when someone is running migrations by hand
 * and refreshing to see whether it worked.
 */

import { query } from "./db";

// The subset of `candidates` that exists on schema.table. Returns [] if the
// catalogue can't be read, so callers fall back to the columns that always exist.
export async function presentColumns(schema, table, candidates = []) {
  if (!candidates.length) return [];
  try {
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = ANY($3)`,
      [schema, table, candidates]);
    const have = new Set(rows.map((r) => r.column_name));
    return candidates.filter((c) => have.has(c));   // caller's order, not the catalogue's
  } catch {
    return [];
  }
}

// A SELECT list: the columns that are always there, plus whichever optional ones
// this database actually has.
export async function selectList(schema, table, base, candidates = []) {
  const extra = await presentColumns(schema, table, candidates);
  return extra.length ? `${base}, ${extra.join(", ")}` : base;
}
