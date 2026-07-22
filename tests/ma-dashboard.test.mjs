import test from "node:test";
import assert from "node:assert/strict";
import { ebitda, variance, SCOPE_MAP, assembleDashboard, BELOW_EBITDA } from "../lib/ma-dashboard-rules.js";

test("ebitda: revenue − cogs − expenses + otherIncome − otherExpenses", () => {
  assert.equal(ebitda({ revenue: 1000, cogs: 400, expenses: 300 }), 300);
  assert.equal(ebitda({ revenue: 1000, cogs: 400, expenses: 300, otherIncome: 50, otherExpenses: 20 }), 330);
  assert.equal(ebitda({}), 0);
});

test("BELOW_EBITDA matches the board pack's below-EBITDA lines", () => {
  assert.ok(BELOW_EBITDA.test("ST: Depreciation - Fixtures & Fittings"));
  assert.ok(BELOW_EBITDA.test("HO: Bank facility fee"));
  assert.ok(BELOW_EBITDA.test("ST: Bank Charges"));
  assert.ok(BELOW_EBITDA.test("Bank Revaluations"));
  assert.equal(BELOW_EBITDA.test("ST: Rent"), false);
});

test("variance: delta, pct and favourability", () => {
  const v = variance(1200, 1000);
  assert.equal(v.delta, 200);
  assert.ok(Math.abs(v.pct - 0.2) < 1e-9);
  assert.equal(v.fav, true);
  const loss = variance(-150, -200);        // less negative than forecast is favourable
  assert.equal(loss.delta, 50);
  assert.equal(loss.fav, true);
  const noFc = variance(500, null);
  assert.equal(noFc.delta, null);
  assert.equal(noFc.pct, null);
});

test("assembleDashboard: group sums scopes; current vs ytd; year filter; trend", () => {
  const actualByScope = {
    store: { months: ["2026-06", "2026-07"], years: ["2026"], byMonth: {
      "2026-06": { revenue: 1000, ebitda: -100 }, "2026-07": { revenue: 1200, ebitda: -50 } } },
    head_office: { months: ["2026-06", "2026-07"], years: ["2026"], byMonth: {
      "2026-06": { revenue: 800, ebitda: -300 }, "2026-07": { revenue: 800, ebitda: -300 } } },
    franchise: { months: ["2026-06", "2026-07"], years: ["2026"], byMonth: {
      "2026-06": { revenue: 120, ebitda: 100 }, "2026-07": { revenue: 120, ebitda: 100 } } },
  };
  const forecast = { byScope: {
    STORES: { months: { "2026-07": { sales: 1100, ebitda: -80 } } },
    HEAD_OFFICE: { months: { "2026-07": { sales: 900, ebitda: -250 } } },
    FRANCHISE: { months: { "2026-07": { sales: 110, ebitda: 90 } } },
  } };

  const cur = assembleDashboard(actualByScope, forecast, "current");
  assert.deepEqual(cur.months, ["2026-07"]);
  assert.equal(cur.group.revenue.actual, 1200 + 800 + 120);   // 2120
  assert.equal(cur.group.ebitda.actual, -50 + -300 + 100);    // -250
  assert.equal(cur.group.ebitda.forecast, -80 + -250 + 90);   // -240
  assert.equal(cur.group.ebitda.fav, false);                  // -250 < -240

  const ytd = assembleDashboard(actualByScope, forecast, "ytd");
  assert.deepEqual(ytd.months, ["2026-06", "2026-07"]);
  assert.equal(ytd.scopes[0].revenue.actual, 2200);           // store revenue 1000+1200
  assert.equal(ytd.trend.length, 2);
  assert.equal(ytd.trend[0].actual, -100 + -300 + 100);       // Jun group EBITDA -300
  // Backward-compat: default carries compare="forecast" and the forecast bases.
  assert.equal(cur.compare, "forecast");
  assert.equal(cur.group.revenueBases.forecast, 1100 + 900 + 110);
});

test("assembleDashboard: budget comparison drives the headline variance when selected", () => {
  const actualByScope = {
    store: { months: ["2026-07"], years: ["2026"], byMonth: { "2026-07": { revenue: 1000, ebitda: -100 } } },
    head_office: { months: ["2026-07"], years: ["2026"], byMonth: { "2026-07": { revenue: 500, ebitda: -200 } } },
    franchise: { months: ["2026-07"], years: ["2026"], byMonth: { "2026-07": { revenue: 100, ebitda: 50 } } },
  };
  const forecast = { byScope: { STORES: { months: { "2026-07": { sales: 1100, ebitda: -80 } } } } };
  const budget = { byScope: { STORES: { months: { "2026-07": { sales: 900, ebitda: -120 } } } } };

  const b = assembleDashboard(actualByScope, forecast, "current", null, { budget, compare: "budget" });
  assert.equal(b.compare, "budget");
  // Store headline variance now measures actual vs budget (revenue 1000 vs 900).
  assert.equal(b.scopes[0].revenue.forecast, 900);   // "forecast" field holds the chosen basis value
  assert.equal(b.scopes[0].revenue.delta, 100);
  // Both bases are still exposed for the UI.
  assert.equal(b.scopes[0].revenueBases.forecast, 1100);
  assert.equal(b.scopes[0].revenueBases.budget, 900);
});

test("assembleDashboard: prior-year is derived from actuals shifted a year", () => {
  const actualByScope = {
    store: { months: ["2025-07", "2026-07"], years: ["2025", "2026"], byMonth: {
      "2025-07": { revenue: 800, ebitda: -150 }, "2026-07": { revenue: 1000, ebitda: -100 } } },
    head_office: { months: ["2026-07"], years: ["2026"], byMonth: { "2026-07": { revenue: 500, ebitda: -200 } } },
    franchise: { months: ["2026-07"], years: ["2026"], byMonth: { "2026-07": { revenue: 100, ebitda: 50 } } },
  };
  const py = assembleDashboard(actualByScope, null, "current", "2026", { compare: "priorYear" });
  // Store prior-year revenue = July 2025 actual = 800; variance = 1000 - 800.
  assert.equal(py.scopes[0].revenueBases.priorYear, 800);
  assert.equal(py.scopes[0].revenue.forecast, 800);
  assert.equal(py.scopes[0].revenue.delta, 200);
  // Head office has no 2025 actual → prior-year null, no false comparison.
  assert.equal(py.scopes[1].revenueBases.priorYear, null);
});
