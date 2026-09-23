import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REPAIRS, isAdditive, pendingRepairs, repairsToRun } from "../lib/migration-repairs.js";

// ---- The safety model ----
// Everything this feature is allowed to do is decided by isAdditive. If it ever
// accepts something that is not a single additive column add, an admin button
// becomes a way to run arbitrary SQL, so these are the tests that matter most.

test("isAdditive accepts exactly the shape ADD COLUMN IF NOT EXISTS", () => {
  assert.equal(isAdditive("ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS payment_method varchar(12)"), true);
  assert.equal(isAdditive("ALTER TABLE finance.procurement_dc ADD COLUMN IF NOT EXISTS expected_payment_date date"), true);
  assert.equal(isAdditive("ALTER TABLE finance.x ADD COLUMN IF NOT EXISTS y numeric(18,2)"), true);
});

test("isAdditive refuses anything that could destroy or write data", () => {
  const refused = [
    "DROP TABLE finance.procurement_purchase",
    "ALTER TABLE finance.procurement_purchase DROP COLUMN payment_method",
    "ALTER TABLE finance.procurement_purchase ALTER COLUMN payment_method TYPE text",
    "ALTER TABLE finance.procurement_purchase RENAME COLUMN payment_method TO x",
    "DELETE FROM finance.procurement_purchase",
    "UPDATE finance.procurement_purchase SET payment_method = 'CASH'",
    "TRUNCATE finance.procurement_purchase",
    "GRANT ALL ON SCHEMA finance TO PUBLIC",
    // No IF NOT EXISTS — would throw on a second run, so not idempotent.
    "ALTER TABLE finance.procurement_purchase ADD COLUMN payment_method varchar(12)",
    // Another schema.
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin boolean",
    "ALTER TABLE merch.otb ADD COLUMN IF NOT EXISTS x date",
    "",
    null,
    undefined,
  ];
  for (const sql of refused) assert.equal(isAdditive(sql), false, `should refuse: ${sql}`);
});

test("isAdditive refuses a second statement smuggled onto the end", () => {
  // The anchors and the absence of ';' from the alphabet are what stop this.
  // Without them, an edit to REPAIRS could append anything at all.
  assert.equal(isAdditive("ALTER TABLE finance.x ADD COLUMN IF NOT EXISTS y date; DROP TABLE finance.x"), false);
  assert.equal(isAdditive("ALTER TABLE finance.x ADD COLUMN IF NOT EXISTS y date;"), false);
  assert.equal(isAdditive("ALTER TABLE finance.x ADD COLUMN IF NOT EXISTS y date --"), false);
  assert.equal(isAdditive("ALTER TABLE finance.x ADD COLUMN IF NOT EXISTS y date DEFAULT (SELECT 1)"), false);
  assert.equal(isAdditive("ALTER TABLE finance.x ADD COLUMN IF NOT EXISTS y date\nDROP TABLE finance.x"), false);
});

test("every repair on the list passes its own safety check", () => {
  for (const r of REPAIRS) assert.equal(isAdditive(r.sql), true, `${r.key} is not an additive column add`);
});

// ---- Pinned against the migrations they claim to be ----

test("every repair names a migration that exists and adds that column", async () => {
  for (const r of REPAIRS) {
    const path = `db/migrations/${r.migration}`;
    assert.ok(fs.existsSync(path), `${r.migration} does not exist (named for ${r.column})`);
    const sql = await fs.promises.readFile(path, "utf8");
    assert.match(sql, new RegExp(`\\b${r.column}\\b`), `${r.migration} never mentions ${r.column}`);
    // The statement must be the one the migration actually runs, not a
    // paraphrase of it — a repair that drifts from its migration would leave
    // the app and a fresh database with different schemas.
    const want = `ADD COLUMN IF NOT EXISTS ${r.column} `;
    assert.ok(sql.includes(want), `${r.migration} does not ${want.trim()}`);
    const type = r.sql.split(want)[1];
    assert.ok(type, `${r.key} does not add ${r.column}`);
    assert.ok(sql.includes(`${want}${type}`), `${r.migration} adds ${r.column} with a different type than the repair`);
  }
});

test("repair keys match table.column, and are unique", () => {
  const seen = new Set();
  for (const r of REPAIRS) {
    assert.equal(r.key, `${r.table}.${r.column}`);
    assert.equal(seen.has(r.key), false, `duplicate repair for ${r.key}`);
    seen.add(r.key);
  }
});

// ---- Only ever offered, and only ever run, for a column that is absent ----

test("pendingRepairs offers only what is genuinely missing", () => {
  assert.deepEqual(pendingRepairs([]).map((r) => r.key), []);
  assert.deepEqual(
    pendingRepairs([{ table: "procurement_dc", column: "expected_payment_date" }]).map((r) => r.key),
    ["procurement_dc.expected_payment_date"]);
  assert.equal(pendingRepairs([{ table: "procurement_purchase", column: "currency" }]).length, 0);
  // Both missing — the state the app is in right now.
  assert.equal(pendingRepairs([
    { table: "procurement_purchase", column: "payment_method" },
    { table: "procurement_dc", column: "expected_payment_date" },
  ]).length, 2);
});

test("repairsToRun drops anything not currently missing", () => {
  const missing = [{ table: "procurement_dc", column: "expected_payment_date" }];
  // Asked for both, but only one is actually absent — a stale page must not
  // replay a repair that has since been applied.
  assert.deepEqual(
    repairsToRun(["procurement_purchase.payment_method", "procurement_dc.expected_payment_date"], missing).map((r) => r.key),
    ["procurement_dc.expected_payment_date"]);
  // An unknown key is dropped, not run, whatever it says.
  assert.deepEqual(repairsToRun(["users.is_admin", "DROP TABLE finance.x"], missing).map((r) => r.key), []);
  assert.deepEqual(repairsToRun([], missing).map((r) => r.key), []);
  assert.deepEqual(repairsToRun(null, missing).map((r) => r.key), []);
});
