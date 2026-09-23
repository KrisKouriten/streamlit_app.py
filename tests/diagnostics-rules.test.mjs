import test from "node:test";
import assert from "node:assert/strict";
import {
  schemaCheck, facilityCheck, fxCheck, budgetCheck, paymentMethodCheck,
  overallStatus, CRITICAL_TABLES, OK, WARN, FAIL,
} from "../lib/diagnostics-rules.js";

const ALL_TABLES = CRITICAL_TABLES.map((t) => t.table);

test("schemaCheck names the missing table AND the migration that creates it", () => {
  assert.equal(schemaCheck(ALL_TABLES).status, OK);
  // The exact failure that cost an afternoon: 077 never applied.
  const c = schemaCheck(ALL_TABLES.filter((t) => t !== "bank_trade_facility"));
  assert.equal(c.status, FAIL);
  assert.equal(c.detail.length, 1);
  assert.equal(c.detail[0].label, "finance.bank_trade_facility");
  assert.equal(c.detail[0].value, "077_treasury.sql");
  assert.match(c.detail[0].note, /Trade-pay spend/);
  // An empty database is a fail, not a pass by absence.
  assert.equal(schemaCheck([]).status, FAIL);
});

test("facilityCheck distinguishes missing table, empty register and loaded data", () => {
  // null = no table at all. [] = table there, nothing uploaded. Different fixes.
  const absent = facilityCheck(null);
  assert.equal(absent.status, FAIL);
  assert.match(absent.remedy, /077/);

  const empty = facilityCheck([]);
  assert.equal(empty.status, WARN);
  assert.match(empty.remedy, /Upload HSBC extract/);
  assert.ok(!/077/.test(empty.remedy));   // not a migration problem, so don't send them to one
});

test("facilityCheck: every drawing priced and dated is a clean pass", () => {
  const c = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", facility_payment_gbp: 218309 },
    { cost_driver: "Local Purchase", due_date: "2026-10", payment_amount: 117398, payment_currency: "GBP" },
  ], []);
  assert.equal(c.status, OK);
  assert.match(c.summary, /2 procurement drawings/);
});

test("facilityCheck names an unrecognised cost driver and how many it drops", () => {
  const c = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", facility_payment_gbp: 100 },
    { cost_driver: "Miniso Facility", due_date: "2026-10", facility_payment_gbp: 200 },
    { cost_driver: "Opex", due_date: "2026-10", facility_payment_gbp: 999 },
    { cost_driver: "Opex", due_date: "2026-10", facility_payment_gbp: 888 },
  ], []);
  assert.equal(c.status, WARN);
  const opex = c.detail.find((d) => /Opex/.test(d.label));
  // The count alone was not enough. A month reading light on the desk could not
  // be tied to this warning without querying the table by hand, so the value the
  // drawings carry, and the months they would have landed in, are reported too.
  assert.equal(opex.value, "2 drawings · £1,887");
  assert.match(opex.note, /ignored/);
  assert.match(opex.note, /would fall in 2026-10/);
});

test("facilityCheck reports the span when dropped drawings cross months", () => {
  const c = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", facility_payment_gbp: 100 },
    { cost_driver: "Miniso L/C", due_date: "2026-11", facility_payment_gbp: 127493 },
    { cost_driver: "Miniso L/C", due_date: "2027-01", facility_payment_gbp: 6000 },
  ], []);
  // "Miniso L/C" with a slash matches none of the patterns, so it is dropped
  // everywhere — the shape of fault that makes one month read light.
  const dropped = c.detail.find((d) => /Miniso L\/C/.test(d.label));
  assert.equal(dropped.value, "2 drawings · £133,493");
  assert.match(dropped.note, /would fall in 2026-11 to 2027-01, 2 months/);
});

test("facilityCheck counts a dropped drawing with no GBP figure without inventing one", () => {
  const c = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", facility_payment_gbp: 100 },
    { cost_driver: "Opex", due_date: "2026-10", facility_payment_gbp: 500 },
    { cost_driver: "Opex", due_date: "2026-10", payment_amount: 999, payment_currency: "USD" },
  ], []);
  const opex = c.detail.find((d) => /Opex/.test(d.label));
  assert.equal(opex.value, "2 drawings · £500");     // the USD one is not guessed at
  assert.match(opex.note, /1 with no GBP figure/);
});

test("facilityCheck flags drawings it cannot price, naming the currency", () => {
  const c = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", payment_amount: 191040, payment_currency: "USD" },
    { cost_driver: "Local Purchase", due_date: "2026-10", payment_amount: 117398, payment_currency: "GBP" },
  ], []);   // no SPOT rates at all
  assert.equal(c.status, WARN);
  const usd = c.detail.find((d) => /Unpriced \(USD\)/.test(d.label));
  // An unpriced row has no GBP by definition, so it is stated in its own
  // currency. "1 drawing" alone left you no way to judge whether it mattered.
  assert.equal(usd.value, "1 drawing · USD 191,040");
  assert.match(usd.note, /no SPOT rate for USD/);
  assert.match(usd.note, /would fall in 2026-10/);
  assert.match(c.remedy, /SPOT rate|GBP column/);
  // With the rate set, the same data passes.
  const ok = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", payment_amount: 191040, payment_currency: "USD" },
  ], ["USD"]);
  assert.equal(ok.status, OK);
});

test("facilityCheck: loaded but nothing recognised is FAIL, not WARN", () => {
  // A register full of drawings that all read as nil is worse than an empty one:
  // it looks like the feed is working.
  const c = facilityCheck([
    { cost_driver: "Opex", due_date: "2026-10", facility_payment_gbp: 100 },
    { cost_driver: "Capex", due_date: "2026-10", facility_payment_gbp: 200 },
  ], []);
  assert.equal(c.status, FAIL);
  assert.match(c.summary, /none recognised as procurement/);
  assert.match(c.remedy, /Miniso LC/);
});

test("facilityCheck flags a drawing with no month to land in", () => {
  const c = facilityCheck([
    { cost_driver: "Local Purchase", facility_payment_gbp: 100 },   // no dates
  ], []);
  assert.equal(c.status, WARN);
  assert.ok(c.detail.some((d) => /No due date or payment month/.test(d.label)));
});

test("fxCheck only complains about a currency something actually uses", () => {
  assert.equal(fxCheck([], []).status, OK);                       // nothing foreign in use
  assert.equal(fxCheck(["GBP"], []).status, OK);                  // GBP needs no rate
  const miss = fxCheck(["USD"], [{ currency: "EUR", rate_type: "SPOT", rate: 1.17 }]);
  assert.equal(miss.status, WARN);
  assert.match(miss.summary, /USD/);
  assert.equal(fxCheck(["USD"], [{ currency: "USD", rate_type: "SPOT", rate: 1.34 }]).status, OK);
  // A HEDGED rate is not a SPOT rate.
  assert.equal(fxCheck(["USD"], [{ currency: "USD", rate_type: "HEDGED", rate: 1.3 }]).status, WARN);
  assert.equal(fxCheck(["USD"], null).status, FAIL);
});

test("budgetCheck reports coverage per source and spots a missing one", () => {
  assert.equal(budgetCheck(null).status, FAIL);
  assert.equal(budgetCheck([]).status, WARN);
  const oneSided = budgetCheck([{ source: "LOCAL", ym: "2026-09" }]);
  assert.equal(oneSided.status, WARN);
  assert.match(oneSided.summary, /MINISO/);
  const both = budgetCheck([
    { source: "MINISO", ym: "2026-09" }, { source: "MINISO", ym: "2026-10" },
    { source: "LOCAL", ym: "2026-09" },
  ]);
  assert.equal(both.status, OK);
  const miniso = both.detail.find((d) => d.label === "MINISO");
  assert.equal(miniso.value, "2 months");
  assert.equal(miniso.note, "2026-09 → 2026-10");
});

test("paymentMethodCheck counts untagged paid purchases", () => {
  assert.equal(paymentMethodCheck({ paid: 0, tagged: 0 }).status, OK);
  assert.equal(paymentMethodCheck({ paid: 5, tagged: 5 }).status, OK);
  const c = paymentMethodCheck({ paid: 5, tagged: 2 });
  assert.equal(c.status, WARN);
  assert.match(c.summary, /3 of 5/);
  assert.equal(paymentMethodCheck().status, OK);
});

test("overallStatus takes the worst — a FAIL is never softened by passes", () => {
  assert.equal(overallStatus([{ status: OK }, { status: OK }]), OK);
  assert.equal(overallStatus([{ status: OK }, { status: WARN }]), WARN);
  assert.equal(overallStatus([{ status: OK }, { status: WARN }, { status: FAIL }]), FAIL);
  assert.equal(overallStatus([]), OK);
});

test("every CRITICAL_TABLES migration filename exists and creates that table", async () => {
  // The point of the schema check is to send you to the right file. A name that
  // doesn't exist is worse than no name, and these were wrong once already —
  // three of six were guessed from the table name rather than checked.
  const fs = await import("node:fs");
  for (const t of CRITICAL_TABLES) {
    const path = `db/migrations/${t.migration}`;
    assert.ok(fs.existsSync(path), `${t.migration} does not exist (named for ${t.table})`);
    const sql = fs.readFileSync(path, "utf8");
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+finance\\.${t.table}\\b`),
      `${t.migration} does not create finance.${t.table}`);
  }
});

// ---- Column-level gaps ----
import { columnCheck, CRITICAL_COLUMNS } from "../lib/diagnostics-rules.js";

const ALL_COLUMNS = CRITICAL_COLUMNS.map((c) => ({ table: c.table, column: c.column }));

test("columnCheck names the missing column AND the migration that adds it", () => {
  assert.equal(columnCheck(ALL_COLUMNS).status, OK);
  // The exact failure this check was built for: 082 never applied, so the close
  // desk's reader lost approval_status — and, through chained fallbacks, the FX
  // columns with it. The table was present throughout, so schemaCheck passed.
  const c = columnCheck(ALL_COLUMNS.filter((x) => x.column !== "approval_status"));
  assert.equal(c.status, FAIL);
  assert.equal(c.detail.length, 1);
  assert.equal(c.detail[0].label, "finance.procurement_purchase.approval_status");
  assert.equal(c.detail[0].value, "082_procurement_approval.sql");
  assert.match(c.summary, /the table is there, so nothing errors/);
  // An unreadable catalogue is a WARN, not a false all-clear.
  assert.equal(columnCheck(null).status, WARN);
  // Nothing present at all is a FAIL listing everything.
  assert.equal(columnCheck([]).detail.length, CRITICAL_COLUMNS.length);
});

test("every CRITICAL_COLUMNS migration exists and adds that column", async () => {
  // Same discipline as the table check: a filename that doesn't exist sends
  // someone hunting, which is worse than naming none.
  const fs = await import("node:fs");
  for (const c of CRITICAL_COLUMNS) {
    const path = `db/migrations/${c.migration}`;
    assert.ok(fs.existsSync(path), `${c.migration} does not exist (named for ${c.column})`);
    const sql = fs.readFileSync(path, "utf8");
    assert.match(sql, new RegExp(`\\b${c.column}\\b`), `${c.migration} never mentions ${c.column}`);
  }
});

test("schemaCheck covers the LC and DC tables the Miniso desk needs", () => {
  // A live database turned up with neither procurement_lc nor procurement_dc
  // while Schema still read "all critical tables present" — because neither was
  // on the list. Miniso settles by letter of credit, so their absence is not a
  // cosmetic gap: the desk shows a request with no LCs and no DCs and looks
  // merely empty.
  const names = CRITICAL_TABLES.map((t) => t.table);
  assert.ok(names.includes("procurement_lc"), "procurement_lc must be checked");
  assert.ok(names.includes("procurement_dc"), "procurement_dc must be checked");
  const c = schemaCheck(names.filter((t) => t !== "procurement_dc"));
  assert.equal(c.status, FAIL);
  assert.equal(c.detail[0].value, "093_procurement_dc.sql");
});

// ---- Which database is answering ----
import { connectionCheck } from "../lib/diagnostics-rules.js";

test("connectionCheck names the database and host, and never a password", () => {
  const c = connectionCheck({
    envKey: "DATABASE_URL",
    host: "ep-cool-frost-12345-pooler.eu-west-2.aws.neon.tech",
    database: "neondb",
    server: "neondb as neondb_owner",
  });
  assert.equal(c.status, OK);
  assert.match(c.summary, /neondb at ep-cool-frost-12345-pooler/);
  assert.match(c.remedy, /Apply migrations to THIS database/);
  const blob = JSON.stringify(c);
  assert.ok(!/password|secret|:\/\//.test(blob), "must not carry a connection string or credential");
});

test("connectionCheck flags a fallback variable, since DATABASE_URL wins", () => {
  // Several DATABASE_URLs are set on the project and only the first match is
  // used — so which one is in play is worth saying out loud.
  const plain = connectionCheck({ envKey: "DATABASE_URL", host: "h", database: "d" });
  assert.equal(plain.detail.find((d) => d.label === "From variable").note, null);
  const fallback = connectionCheck({ envKey: "Finance_DATABASE_URL", host: "h", database: "d" });
  assert.match(fallback.detail.find((d) => d.label === "From variable").note, /DATABASE_URL is checked first/);
});

test("connectionCheck warns rather than guessing when there is no connection", () => {
  const c = connectionCheck({});
  assert.equal(c.status, WARN);
  assert.match(c.remedy, /DATABASE_URL is set/);
  assert.equal(connectionCheck().status, WARN);
});
