import test from "node:test";
import assert from "node:assert/strict";
import { sumRow, kpiFromPack, variance, SCOPE_MAP, assembleDashboard } from "../lib/ma-dashboard-rules.js";

test("sumRow sums a board-pack row's values across months, guarding missing", () => {
  const row = { values: { "2026-06": 100, "2026-07": 50 } };
  assert.equal(sumRow(row, ["2026-06", "2026-07"]), 150);
  assert.equal(sumRow(row, ["2026-06"]), 100);
  assert.equal(sumRow(row, ["2026-05"]), 0); // absent month
  assert.equal(sumRow(null, ["2026-06"]), null);
});

test("kpiFromPack finds the matching non-section row and sums it", () => {
  const rows = [
    { kind: "section", label: "Store Sales", values: {} },
    { kind: "total", label: "Total Store Sales", values: { "2026-06": 1687139 } },
    { kind: "computed", label: "Store EBITDA", values: { "2026-06": -161929 } },
  ];
  const def = SCOPE_MAP.find((d) => d.scope === "store");
  assert.equal(kpiFromPack(rows, def.sales, ["2026-06"]), 1687139);
  assert.equal(kpiFromPack(rows, def.ebitda, ["2026-06"]), -161929);
  // a section header with the same words must not be picked for sales
  assert.notEqual(kpiFromPack(rows, /store sales/i, ["2026-06"]), null);
});

test("head office & franchise KPI labels match the board-pack lines", () => {
  const ho = [{ kind: "computed", label: "Total Wholesale Sales", values: { "2026-06": 808149 } },
    { kind: "computed", label: "Wholesale EBITDA", values: { "2026-06": -309523 } }];
  const hoDef = SCOPE_MAP.find((d) => d.scope === "head_office");
  assert.equal(kpiFromPack(ho, hoDef.sales, ["2026-06"]), 808149);
  assert.equal(kpiFromPack(ho, hoDef.ebitda, ["2026-06"]), -309523);

  const fr = [{ kind: "total", label: "Total Franchise Revenue", values: { "2026-06": 123729 } },
    { kind: "computed", label: "Franchise EBITDA", values: { "2026-06": 123723 } }];
  const frDef = SCOPE_MAP.find((d) => d.scope === "franchise");
  assert.equal(kpiFromPack(fr, frDef.sales, ["2026-06"]), 123729);
  assert.equal(kpiFromPack(fr, frDef.ebitda, ["2026-06"]), 123723);
});

test("variance: delta, pct and favourability", () => {
  const v = variance(1200, 1000);
  assert.equal(v.delta, 200);
  assert.ok(Math.abs(v.pct - 0.2) < 1e-9);
  assert.equal(v.fav, true);           // higher actual is favourable by default

  const under = variance(800, 1000);
  assert.equal(under.delta, -200);
  assert.equal(under.fav, false);

  // EBITDA less negative than forecast is still favourable (delta >= 0)
  const loss = variance(-150, -200);
  assert.equal(loss.delta, 50);
  assert.equal(loss.fav, true);

  // no forecast → null delta/pct, no crash
  const noFc = variance(500, null);
  assert.equal(noFc.delta, null);
  assert.equal(noFc.pct, null);
});

test("assembleDashboard: group sums scopes; current vs ytd period; trend", () => {
  const packs = {
    store: { loaded: true, years: ["2026"], months: ["2026-06", "2026-07"], rows: [
      { kind: "total", label: "Total Store Sales", values: { "2026-06": 1000, "2026-07": 1200 } },
      { kind: "computed", label: "Store EBITDA", values: { "2026-06": -100, "2026-07": -50 } },
    ] },
    head_office: { loaded: true, years: ["2026"], months: ["2026-06", "2026-07"], rows: [
      { kind: "computed", label: "Total Wholesale Sales", values: { "2026-06": 800, "2026-07": 800 } },
      { kind: "computed", label: "Wholesale EBITDA", values: { "2026-06": -300, "2026-07": -300 } },
    ] },
    franchise: { loaded: true, years: ["2026"], months: ["2026-06", "2026-07"], rows: [
      { kind: "total", label: "Total Franchise Revenue", values: { "2026-06": 120, "2026-07": 120 } },
      { kind: "computed", label: "Franchise EBITDA", values: { "2026-06": 100, "2026-07": 100 } },
    ] },
  };
  const forecast = { byScope: {
    STORES: { months: { "2026-06": { sales: 1100, ebitda: -80 }, "2026-07": { sales: 1100, ebitda: -80 } } },
    HEAD_OFFICE: { months: { "2026-06": { sales: 900, ebitda: -250 }, "2026-07": { sales: 900, ebitda: -250 } } },
    FRANCHISE: { months: { "2026-06": { sales: 110, ebitda: 90 }, "2026-07": { sales: 110, ebitda: 90 } } },
  } };

  // current month → latest only (2026-07)
  const cur = assembleDashboard(packs, forecast, "current");
  assert.deepEqual(cur.months, ["2026-07"]);
  assert.equal(cur.group.revenue.actual, 1200 + 800 + 120);   // 2120
  assert.equal(cur.group.ebitda.actual, -50 + -300 + 100);    // -250
  assert.equal(cur.group.ebitda.forecast, -80 + -250 + 90);   // -240
  assert.equal(cur.group.ebitda.fav, false);                  // -250 < -240, unfavourable

  // ytd → both months summed
  const ytd = assembleDashboard(packs, forecast, "ytd");
  assert.deepEqual(ytd.months, ["2026-06", "2026-07"]);
  assert.equal(ytd.scopes[0].revenue.actual, 2200);           // store sales 1000+1200
  assert.equal(ytd.trend.length, 2);
  assert.equal(ytd.trend[0].actual, -100 + -300 + 100);       // Jun group EBITDA -300
});
