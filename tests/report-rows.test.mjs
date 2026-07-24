import test from "node:test";
import assert from "node:assert/strict";
import { pnlToTab, bsToTab } from "../lib/report-rows.js";

test("pnlToTab flattens sections into section/line/total rows plus computed lines", () => {
  const pnl = {
    months: ["2026-05", "2026-06"],
    sections: [
      { name: "Revenue", rows: [{ account: "Sales", months: { "2026-05": 100, "2026-06": 120 }, total: 220 }], total: { months: { "2026-05": 100, "2026-06": 120 }, total: 220 } },
      { name: "Cost of Sales", rows: [{ account: "COGS", months: { "2026-05": 40, "2026-06": 50 }, total: 90 }], total: { months: { "2026-05": 40, "2026-06": 50 }, total: 90 } },
    ],
    computed: {
      grossProfit: { months: { "2026-05": 60, "2026-06": 70 }, total: 130 },
      operatingProfit: { months: { "2026-05": 50, "2026-06": 55 }, total: 105 },
      netProfit: { months: { "2026-05": 45, "2026-06": 50 }, total: 95 },
    },
  };
  const tab = pnlToTab(pnl);
  assert.deepEqual(tab.months, ["2026-05", "2026-06"]);
  assert.equal(tab.year, "2026");
  const kinds = tab.rows.map((r) => `${r.kind}:${r.label}`);
  assert.ok(kinds.includes("section:Revenue"));
  assert.ok(kinds.includes("line:Sales"));
  assert.ok(kinds.includes("total:Total Revenue"));
  assert.ok(kinds.includes("calc:Gross profit"));
  assert.ok(kinds.includes("calc:Net profit"));
  const gp = tab.rows.find((r) => r.label === "Gross profit");
  assert.equal(gp.total, 130);
  assert.equal(gp.tone, "gp");
});

test("bsToTab builds a single as-at column with section totals", () => {
  const bs = {
    asAt: "2026-06",
    sections: [
      { name: "Current Assets", rows: [{ account: "Cash", value: 100 }, { account: "Debtors", value: 50 }], total: 150 },
      { name: "Equity", rows: [{ account: "Retained earnings", value: 150 }], total: 150 },
    ],
  };
  const tab = bsToTab(bs);
  assert.deepEqual(tab.months, ["2026-06"]);
  assert.equal(tab.year, "2026");
  const cash = tab.rows.find((r) => r.label === "Cash");
  assert.equal(cash.values["2026-06"], 100);
  assert.equal(cash.total, 100);
  const tot = tab.rows.find((r) => r.label === "Total Current Assets");
  assert.equal(tot.total, 150);
  assert.equal(tot.strong, true);
});

test("pnlToTab tolerates a P&L with no computed block", () => {
  const tab = pnlToTab({ months: [], sections: [], computed: null });
  assert.deepEqual(tab.rows, []);
  assert.equal(tab.year, null);
});
