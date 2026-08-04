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
