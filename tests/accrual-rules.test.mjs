import test from "node:test";
import assert from "node:assert/strict";
import { computeAccrualReview, ACCRUAL_TYPES, DEFAULT_MATERIALITY } from "../lib/accrual-rules.js";

const R = (unit, line, ym, value) => ({ unit, line_label: line, ym, value });

// Three prior months at 1000, target month at the given value — for one store/nominal.
function rentSeries(target, priors = [1000, 1000, 1000]) {
  const months = ["2026-01", "2026-02", "2026-03"];
  const rows = priors.map((v, i) => R("Camden", "ST: Rent", months[i], v));
  rows.push(R("Camden", "ST: Rent", "2026-04", target));
  return rows;
}

test("exports: three types, default materiality", () => {
  assert.equal(ACCRUAL_TYPES.length, 3);
  assert.deepEqual(ACCRUAL_TYPES.map((t) => t.code), ["COMPLETENESS", "REVERSAL", "DRIFT"]);
  assert.equal(DEFAULT_MATERIALITY, 250);
});

test("empty input is not ready", () => {
  const r = computeAccrualReview([]);
  assert.equal(r.ready, false);
  assert.equal(r.target, null);
});

test("COMPLETENESS: run-rate posted every prior month, £0 in target", () => {
  const r = computeAccrualReview(rentSeries(0), { targetMonth: "2026-04" });
  assert.equal(r.ready, true);
  assert.equal(r.target, "2026-04");
  assert.deepEqual(r.priorMonths, ["2026-01", "2026-02", "2026-03"]);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].type, "COMPLETENESS");
  assert.equal(r.lines[0].runRate, 1000);
  assert.equal(r.lines[0].posted, 0);
  assert.equal(r.lines[0].accrual, 1000);
  assert.equal(r.totals.totalAccrual, 1000);
  assert.equal(r.totals.flagged, 1);
});

test("REVERSAL: prior accrual reversed to negative in target", () => {
  const r = computeAccrualReview(rentSeries(-300), { targetMonth: "2026-04" });
  assert.equal(r.lines[0].type, "REVERSAL");
  assert.equal(r.lines[0].posted, -300);
  assert.equal(r.lines[0].accrual, 1300); // runRate 1000 − (−300)
});

test("DRIFT: posted but below run-rate by ≥ materiality", () => {
  const r = computeAccrualReview(rentSeries(600), { targetMonth: "2026-04" });
  assert.equal(r.lines[0].type, "DRIFT");
  assert.equal(r.lines[0].accrual, 400);
});

test("gap below materiality is ignored", () => {
  const r = computeAccrualReview(rentSeries(900), { targetMonth: "2026-04", materiality: 250 });
  assert.equal(r.lines.length, 0);
  assert.equal(r.totals.flagged, 0);
});

test("over-posted (posted ≥ run-rate) never flags", () => {
  const r = computeAccrualReview(rentSeries(1500), { targetMonth: "2026-04" });
  assert.equal(r.lines.length, 0);
});

test("revenue not posted is tracked separately, not accrued", () => {
  const rows = [
    R("Camden", "ST: Sales", "2026-01", 100000),
    R("Camden", "ST: Sales", "2026-02", 100000),
    R("Camden", "ST: Sales", "2026-03", 100000),
    // no April sales row
    ...rentSeries(0),
  ];
  const r = computeAccrualReview(rows, { targetMonth: "2026-04" });
  assert.equal(r.revenueMissing.count, 1);
  assert.equal(r.revenueMissing.items[0].nominal, "ST: Sales");
  assert.equal(r.revenueMissing.runRate, 100000);
  // revenue does not appear in the accrual lines
  assert.ok(r.lines.every((l) => l.kind === "COST"));
});

test("below-the-line nominals are excluded from accrual", () => {
  const rows = [
    R("Camden", "ST: Depreciation", "2026-01", 5000),
    R("Camden", "ST: Depreciation", "2026-02", 5000),
    R("Camden", "ST: Depreciation", "2026-03", 5000),
    R("Camden", "ST: Depreciation", "2026-04", 0),
  ];
  const r = computeAccrualReview(rows, { targetMonth: "2026-04" });
  assert.equal(r.lines.length, 0);
});

test("run-rate uses only same-year prior months", () => {
  const rows = [
    R("Camden", "ST: Rent", "2025-12", 9000), // prior year — ignored
    R("Camden", "ST: Rent", "2026-01", 1000),
    R("Camden", "ST: Rent", "2026-02", 1000),
    R("Camden", "ST: Rent", "2026-03", 0),
  ];
  const r = computeAccrualReview(rows, { targetMonth: "2026-03" });
  assert.equal(r.lines[0].runRate, 1000); // not skewed by 2025-12
});

test("byType / byNominal / byStore aggregate the flagged lines", () => {
  const rows = [
    ...rentSeries(0), // Camden Rent COMPLETENESS 1000
    R("Oxford", "ST: Salaries", "2026-01", 2000),
    R("Oxford", "ST: Salaries", "2026-02", 2000),
    R("Oxford", "ST: Salaries", "2026-03", 2000),
    R("Oxford", "ST: Salaries", "2026-04", 500), // DRIFT 1500
  ];
  const r = computeAccrualReview(rows, { targetMonth: "2026-04" });
  assert.equal(r.totals.flagged, 2);
  assert.equal(r.totals.totalAccrual, 2500);
  const byStore = Object.fromEntries(r.byStore.map((s) => [s.key, s.gap]));
  assert.equal(byStore["Oxford"], 1500);
  assert.equal(byStore["Camden"], 1000);
  const byNom = Object.fromEntries(r.byNominal.map((s) => [s.key, s.gap]));
  assert.equal(byNom["ST: Salaries"], 1500);
  // lines are sorted largest accrual first
  assert.equal(r.lines[0].accrual, 1500);
});

test("target defaults to the latest month present", () => {
  const r = computeAccrualReview(rentSeries(0));
  assert.equal(r.target, "2026-04");
});

test("run-rate basis is the default when no model is loaded", () => {
  const r = computeAccrualReview(rentSeries(600), { targetMonth: "2026-04" });
  assert.equal(r.modelLoaded, false);
  assert.equal(r.lines[0].basis, "RUN_RATE");
  assert.equal(r.lines[0].expected, 1000);
});

test("MODEL basis: FIXED expectation drives the variance, not run-rate", () => {
  // run-rate would be 1000, but the fixed model says 1500 — variance uses 1500
  const expectations = [{ store: "Camden", line_label: "ST: Rent", behaviour: "FIXED", monthly_amount: 1500 }];
  const r = computeAccrualReview(rentSeries(600), { targetMonth: "2026-04", expectations });
  assert.equal(r.modelLoaded, true);
  assert.equal(r.lines[0].basis, "MODEL");
  assert.equal(r.lines[0].expected, 1500);
  assert.equal(r.lines[0].accrual, 900); // 1500 − 600
  assert.equal(r.basisCounts.MODEL, 1);
  assert.equal(r.basisCounts.RUN_RATE, 0);
});

test("MODEL basis: VARIABLE expectation applies the rate to store revenue", () => {
  const rows = [
    R("Camden", "ST: Sales", "2026-04", 100000),
    R("Camden", "ST: COGS", "2026-04", 30000),
  ];
  const expectations = [{ store: "Camden", line_label: "ST: COGS", behaviour: "VARIABLE", pct_of_revenue: 0.4 }];
  const r = computeAccrualReview(rows, { targetMonth: "2026-04", expectations });
  const cogs = r.lines.find((l) => l.nominal === "ST: COGS");
  assert.equal(cogs.basis, "MODEL");
  assert.equal(cogs.expected, 40000); // 40% × 100,000
  assert.equal(cogs.accrual, 10000);  // 40,000 − 30,000
});

test("MODEL basis works in the first month with no prior history", () => {
  const rows = [R("Camden", "ST: Rent", "2026-01", 0)];
  const expectations = [{ store: "Camden", line_label: "ST: Rent", behaviour: "FIXED", monthly_amount: 5000 }];
  const r = computeAccrualReview(rows, { targetMonth: "2026-01", expectations });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].type, "COMPLETENESS");
  assert.equal(r.lines[0].accrual, 5000);
});

test("mixed: model where loaded, run-rate elsewhere", () => {
  const rows = [
    ...rentSeries(0), // Camden Rent — no model → run-rate 1000, COMPLETENESS
    R("Oxford", "ST: Salaries", "2026-04", 100),
  ];
  const expectations = [{ store: "Oxford", line_label: "ST: Salaries", behaviour: "FIXED", monthly_amount: 2000 }];
  const r = computeAccrualReview(rows, { targetMonth: "2026-04", expectations });
  assert.equal(r.basisCounts.MODEL, 1);
  assert.equal(r.basisCounts.RUN_RATE, 1);
  const rent = r.lines.find((l) => l.nominal === "ST: Rent");
  const sal = r.lines.find((l) => l.nominal === "ST: Salaries");
  assert.equal(rent.basis, "RUN_RATE");
  assert.equal(sal.basis, "MODEL");
  assert.equal(sal.accrual, 1900); // 2000 − 100
});
