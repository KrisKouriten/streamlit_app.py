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
  assert.equal(opex.value, "2 drawings");
  assert.match(opex.note, /ignored/);
});

test("facilityCheck flags drawings it cannot price, naming the currency", () => {
  const c = facilityCheck([
    { cost_driver: "Miniso LC", due_date: "2026-10", payment_amount: 191040, payment_currency: "USD" },
    { cost_driver: "Local Purchase", due_date: "2026-10", payment_amount: 117398, payment_currency: "GBP" },
  ], []);   // no SPOT rates at all
  assert.equal(c.status, WARN);
  const usd = c.detail.find((d) => /Unpriced \(USD\)/.test(d.label));
  assert.equal(usd.value, "1");
  assert.match(usd.note, /no SPOT rate for USD/);
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
