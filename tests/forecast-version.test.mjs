import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVersion,
  versionTransitionError,
  priorYearMonth,
  priorYearMonths,
  lineKey,
  compareVersions,
  KINDS,
  STATUSES,
} from "../lib/forecast-version-rules.js";

test("validateVersion enforces label, kind and fiscal-year shape", () => {
  assert.equal(validateVersion({ label: "FY26 Budget", kind: "BUDGET" }), null);
  assert.equal(validateVersion({ label: "Q3 Reforecast", kind: "FORECAST", fiscalYear: "2026" }), null);
  assert.match(validateVersion({ label: "", kind: "BUDGET" }), /needs a label/);
  assert.match(validateVersion({ label: "x", kind: "NOPE" }), /BUDGET or FORECAST/);
  assert.match(validateVersion({ label: "x", kind: "BUDGET", fiscalYear: "26" }), /4-digit year/);
  assert.equal(validateVersion({ label: "x", kind: "BUDGET", fiscalYear: "" }), null);
});

test("lifecycle: approve only from draft; archive from draft or approved; delete only draft", () => {
  assert.equal(versionTransitionError("approve", "DRAFT"), null);
  assert.match(versionTransitionError("approve", "APPROVED"), /Cannot approve/);
  assert.equal(versionTransitionError("archive", "DRAFT"), null);
  assert.equal(versionTransitionError("archive", "APPROVED"), null);
  assert.match(versionTransitionError("archive", "ARCHIVED"), /Cannot archive/);
  assert.equal(versionTransitionError("delete", "DRAFT"), null);
  assert.match(versionTransitionError("delete", "APPROVED"), /Only a draft/);
  assert.match(versionTransitionError("delete", "ARCHIVED"), /Only a draft/);
  assert.match(versionTransitionError("frobnicate", "DRAFT"), /Unknown action/);
  assert.match(versionTransitionError("approve", "WAT"), /Unknown status/);
});

test("KINDS and STATUSES are the expected sets", () => {
  assert.deepEqual(KINDS, ["BUDGET", "FORECAST"]);
  assert.deepEqual(STATUSES, ["DRAFT", "APPROVED", "ARCHIVED"]);
});

test("prior-year month shift", () => {
  assert.equal(priorYearMonth("2026-06"), "2025-06");
  assert.equal(priorYearMonth("2026-01"), "2025-01");
  assert.equal(priorYearMonth("bad"), "bad");
  assert.deepEqual(priorYearMonths(["2026-05", "2026-06"]), ["2025-05", "2025-06"]);
});

test("lineKey is stable across the grain", () => {
  assert.equal(
    lineKey({ scope: "STORES", unit: "Oxford St", line_label: "ST: Rent", cost_type: "FIXED", ym: "2026-06" }),
    "STORES|Oxford St|ST: Rent|FIXED|2026-06"
  );
  assert.equal(lineKey({ scope: "HEAD_OFFICE", line_label: "HO: Freight", cost_type: "FIXED" }), "HEAD_OFFICE||HO: Freight|FIXED|");
});

test("compareVersions reports added / removed / changed / unchanged and the net delta", () => {
  const a = [
    { scope: "STORES", unit: "A", line_label: "Sales", cost_type: "SALES", ym: "2026-06", value: 100 },
    { scope: "STORES", unit: "A", line_label: "Rent", cost_type: "FIXED", ym: "2026-06", value: 10 },
    { scope: "STORES", unit: "A", line_label: "Gone", cost_type: "FIXED", ym: "2026-06", value: 5 },
  ];
  const b = [
    { scope: "STORES", unit: "A", line_label: "Sales", cost_type: "SALES", ym: "2026-06", value: 120 }, // changed +20
    { scope: "STORES", unit: "A", line_label: "Rent", cost_type: "FIXED", ym: "2026-06", value: 10 }, // unchanged
    { scope: "STORES", unit: "A", line_label: "New", cost_type: "FIXED", ym: "2026-06", value: 8 }, // added +8
  ];
  const { rows, summary } = compareVersions(a, b);
  assert.equal(summary.changed, 1);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.unchanged, 1);
  // net delta = +20 (sales) + 8 (new) - 5 (removed) = 23
  assert.equal(summary.deltaValue, 23);
  // rows sorted by absolute delta, largest first
  assert.equal(rows[0].line_label, "Sales");
  assert.equal(rows[0].delta, 20);
  // unchanged line is not in rows
  assert.ok(!rows.some((r) => r.line_label === "Rent"));
});
