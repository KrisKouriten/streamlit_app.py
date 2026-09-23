/*
 * Applying a missing column from inside the app — pure rules.
 *
 * WHY THIS EXISTS. Migrations are applied by hand in a SQL editor, and the
 * editor and the app kept disagreeing about which database was in front of you.
 * Neon opens every new editor tab on the project's primary branch, and the app
 * reads whichever DATABASE_URL variant Vercel resolves first, so "applied and
 * verified" meant nothing: five runs in a row reported success against a branch
 * the app has never read. Nothing on either side could tell.
 *
 * The app cannot be wrong about its own connection. So the repair runs here,
 * through the same pool every reader uses, and the check that says a column is
 * missing is the same check that says it is fixed.
 *
 * WHAT IT WILL AND WILL NOT DO. This is deliberately not a migration runner.
 * It holds a fixed list of single, additive, idempotent statements — ADD COLUMN
 * IF NOT EXISTS and nothing else. It cannot drop, rename, alter a type, write a
 * row, or run two statements at once, and it will only run a repair whose column
 * is genuinely absent when asked. A migration that creates a table, backfills
 * data or changes a type is not a candidate and is still applied by hand.
 *
 * The SQL here is pinned against db/migrations by tests/migration-repairs.test.mjs,
 * so a repair cannot drift from the migration it claims to be.
 */

// One entry per column a feature needs and cannot create for itself. `sql` is
// the statement, `migration` the file it comes from, `feature` what turning it
// on switches back on — the same wording the Columns check uses.
export const REPAIRS = [
  {
    key: "procurement_purchase.payment_method",
    table: "procurement_purchase",
    column: "payment_method",
    migration: "113_procurement_payment_method.sql",
    sql: "ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS payment_method varchar(12)",
    feature: "Cash vs trade pay on a paid invoice, which drives Cash spend",
  },
  {
    key: "procurement_purchase.trade_pay_ref",
    table: "procurement_purchase",
    column: "trade_pay_ref",
    migration: "115_procurement_trade_pay_ref.sql",
    sql: "ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS trade_pay_ref varchar(40)",
    feature: "Which trade-pay drawing a paid purchase settled on, so it reconciles to the facility",
  },
  {
    key: "procurement_dc.expected_payment_date",
    table: "procurement_dc",
    column: "expected_payment_date",
    migration: "114_procurement_dc_expected.sql",
    sql: "ALTER TABLE finance.procurement_dc ADD COLUMN IF NOT EXISTS expected_payment_date date",
    feature: "The month an open DC balance is expected to be paid, instead of the pickup + 180 estimate",
  },
];

/*
 * The whole safety model, in one regex.
 *
 * A single ALTER TABLE on the finance schema, adding one column, guarded by IF
 * NOT EXISTS, with a type drawn from a small alphabet. Anchored at both ends and
 * with no semicolon permitted, so a second statement cannot be appended — which
 * is what stops this from becoming a way to run arbitrary SQL through an admin
 * button.
 *
 * Nothing is interpolated into these statements: there is no caller input in
 * them at all, only the fixed list above. The check is here because a future
 * edit to that list should fail a test rather than reach a database.
 */
const ADDITIVE = /^ALTER TABLE finance\.[a-z_][a-z0-9_]* ADD COLUMN IF NOT EXISTS [a-z_][a-z0-9_]* [a-z][a-z0-9]*(\(\d+(,\s*\d+)?\))?$/;

export function isAdditive(sql) {
  const s = String(sql || "").trim();
  if (!s || s.length > 200) return false;
  return ADDITIVE.test(s);
}

// What can actually be applied right now. `missing` is [{table, column}] from
// the same catalogue read the Columns check uses, so a repair is only ever
// offered for a column that is genuinely absent — running one for a column that
// already exists is harmless, but offering it is misleading.
export function pendingRepairs(missing = []) {
  const want = new Set((missing || []).map((c) => `${c.table}.${c.column}`));
  return REPAIRS.filter((r) => want.has(r.key));
}

// Resolve the keys a caller asked for against what is genuinely pending. Anything
// else — an unknown key, or one whose column is already there — is dropped rather
// than run, so a stale page cannot replay a repair that has since been applied.
export function repairsToRun(keys = [], missing = []) {
  const asked = new Set((keys || []).map(String));
  return pendingRepairs(missing).filter((r) => asked.has(r.key));
}
