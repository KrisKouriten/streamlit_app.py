import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveScope, scopeAllows, mayCompareAcrossScope } from "../lib/intelligence/permission-rules.js";
import { classifyQuestion, validatePageContext } from "../lib/intelligence/context-rules.js";
import { assessConfidence, ageDays, CONFIDENCE } from "../lib/intelligence/confidence-rules.js";
import { makeSource, validateClaims } from "../lib/intelligence/source-rules.js";

/* ---------------- permission-rules ---------------- */

test("finance/admin roles resolve to an unrestricted scope (matches today's app)", () => {
  for (const role of ["ADMIN", "EXEC", "FINANCE"]) {
    const scope = resolveScope({ roles: [role] });
    assert.equal(scope.unrestricted, true);
    assert.equal(mayCompareAcrossScope(scope), true);
    assert.equal(scopeAllows(scope, { entityId: 7 }), true);
  }
});

test("a role with no finance grant resolves to a withheld scope", () => {
  const scope = resolveScope({ roles: ["OPS"] });
  assert.equal(scope.unrestricted, false);
  assert.equal(mayCompareAcrossScope(scope), false);
  assert.equal(scopeAllows(scope, { entityId: 7 }), false);
  assert.match(scope.note, /withheld/i);
});

test("a scoped (future) allow-list is honoured by scopeAllows", () => {
  const scope = { unrestricted: false, entityIds: [1, 2], storeIds: [10] };
  assert.equal(scopeAllows(scope, { entityId: 1 }), true);
  assert.equal(scopeAllows(scope, { entityId: 99 }), false);
  assert.equal(scopeAllows(scope, { storeId: 10 }), true);
});

test("resolveScope tolerates a missing/blank session", () => {
  assert.equal(resolveScope(undefined).unrestricted, false);
  assert.equal(resolveScope({}).unrestricted, false);
});

/* ---------------- context-rules ---------------- */

test("question classification picks the right type", () => {
  assert.equal(classifyQuestion("Why is EBITDA below forecast?"), "DIAGNOSTIC");
  assert.equal(classifyQuestion("What action should we take to recover sales?"), "PRESCRIPTIVE");
  assert.equal(classifyQuestion("Draft the weekly CEO update"), "REPORTING");
  assert.equal(classifyQuestion("Explain how this KPI is calculated"), "EXPLANATORY");
  assert.equal(classifyQuestion("What tasks are overdue and awaiting approval?"), "OPERATIONAL");
  assert.equal(classifyQuestion("What is the current run rate for the full-year forecast?"), "PREDICTIVE");
  assert.equal(classifyQuestion("Show the largest variances"), "DESCRIPTIVE");
});

test("validatePageContext requires a pageId and allow-lists filters", () => {
  assert.equal(validatePageContext(null).ok, false);
  assert.equal(validatePageContext({}).ok, false);
  const r = validatePageContext({
    pageId: "store-performance",
    route: "/finance-os/store-sales/league",
    filters: { period: "2026-06", store: "GLA", junk: "drop-me", note: "x".repeat(200) },
    selectedRecord: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.context.pageId, "store-performance");
  assert.equal(r.context.filters.period, "2026-06");
  assert.equal(r.context.filters.store, "GLA");
  assert.equal("junk" in r.context.filters, false); // not on the allow-list
});

/* ---------------- confidence-rules ---------------- */

test("HIGH when sources are fresh, approved and the period is complete", () => {
  const now = new Date("2026-07-27").getTime();
  const r = assessConfidence(
    [{ label: "Joiin board pack", dataThrough: "2026-07-25", approved: true }],
    { nowMs: now }
  );
  assert.equal(r.level, CONFIDENCE.HIGH);
});

test("LOW when a source is missing", () => {
  const now = new Date("2026-07-27").getTime();
  const r = assessConfidence(
    [{ label: "Cash flow", missing: true }, { label: "Sales", dataThrough: "2026-07-26" }],
    { nowMs: now }
  );
  assert.equal(r.level, CONFIDENCE.LOW);
  assert.deepEqual(r.missingSources, ["Cash flow"]);
});

test("MEDIUM when a working forecast or a stale source is used", () => {
  const now = new Date("2026-07-27").getTime();
  const stale = assessConfidence([{ label: "Inventory", dataThrough: "2026-07-10" }], { nowMs: now });
  assert.equal(stale.level, CONFIDENCE.MEDIUM);
  assert.deepEqual(stale.staleSources, ["Inventory"]);

  const wf = assessConfidence([{ label: "Sales", dataThrough: "2026-07-26" }], { nowMs: now, hasUnapprovedForecast: true });
  assert.equal(wf.level, CONFIDENCE.MEDIUM);
  assert.match(wf.reasons.join(" "), /working \(unapproved\) forecast/i);
});

test("ageDays is null-safe", () => {
  assert.equal(ageDays(null, Date.now()), null);
  assert.equal(ageDays("not-a-date", Date.now()), null);
});

/* ---------------- source-rules ---------------- */

test("makeSource defaults the label to the module", () => {
  const s = makeSource({ module: "Store Sales & KPI", dataThrough: "2026-07-22" });
  assert.equal(s.label, "Store Sales & KPI");
  assert.equal(s.dataThrough, "2026-07-22");
});

test("validateClaims flags a figure not present in the supplied facts", () => {
  const facts = [420000, 96000.5];
  const ok = validateClaims([{ value: 420000 }, { value: "£96,000.50" }], facts);
  assert.equal(ok.ok, true);

  const bad = validateClaims([{ value: 999999, sourceLabel: "made up" }], facts);
  assert.equal(bad.ok, false);
  assert.equal(bad.unverified.length, 1);
});

test("validateClaims ignores non-numeric prose claims", () => {
  const r = validateClaims([{ value: "materially adverse" }], [1, 2, 3]);
  assert.equal(r.ok, true);
});
