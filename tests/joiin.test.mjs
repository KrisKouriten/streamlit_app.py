import test from "node:test";
import assert from "node:assert/strict";
import { headerToYm, parseMoney, parseJoiinPnl, summariseJoiinPnl } from "../lib/joiin-rules.js";

test("headerToYm + parseMoney", () => {
  assert.equal(headerToYm("Jun 26"), "2026-06");
  assert.equal(headerToYm("Jan 2025"), "2025-01");
  assert.equal(parseMoney("£1,687,139"), 1687139);
  assert.equal(parseMoney("-£8,000"), -8000);
  assert.equal(parseMoney("£0"), 0);
  assert.equal(parseMoney("-"), null);
  assert.equal(parseMoney("(£8,000)"), -8000);
});

test("parseJoiinPnl: sections, accounts, computed lines; summarise reconciles to Net", () => {
  const md = [
    "|  | Jun 26 |",
    "| Revenue | - |",
    "|   ST: Sales | £1,000 |",
    "|   HO: Sales - TikTok | -£50 |",
    "|   Total | £950 |",
    "| Cost of Sales | - |",
    "|   ST: Cost of Goods Sold | £400 |",
    "|   Total | £400 |",
    "| Gross Profit | £550 |",
    "| Expenses | - |",
    "|   ST: Rent | £200 |",
    "|   Total | £200 |",
    "| Operating Profit | £350 |",
    "| Other Income | - |",
    "|   FR: Distribution Costs - Recharged | £10 |",
    "|   Total | £10 |",
    "| Other Expenses | - |",
    "|   Total | £0 |",
    "| Net Profit | £360 |",
  ].join("\n");
  const p = parseJoiinPnl(md);
  assert.deepEqual(p.months, ["2026-06"]);
  assert.equal(p.rows.length, 5);
  const get = (sec, acc) => p.rows.find((r) => r.section === sec && r.account === acc)?.value;
  assert.equal(get("Revenue", "ST: Sales"), 1000);
  assert.equal(get("Revenue", "HO: Sales - TikTok"), -50);
  assert.equal(get("Cost of Sales", "ST: Cost of Goods Sold"), 400);
  assert.equal(get("Expenses", "ST: Rent"), 200);
  assert.equal(get("Other Income", "FR: Distribution Costs - Recharged"), 10);
  const s = summariseJoiinPnl(p)["2026-06"];
  assert.equal(s.revenue, 950);
  assert.equal(s.grossProfit, 550);
  assert.equal(s.netResult, 360);       // GP 550 + opex -190
  assert.equal(s.net_memo, 360);        // matches the report's Net Profit line
});
