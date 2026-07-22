import test from "node:test";
import assert from "node:assert/strict";
import { headerToYm, parseMoney, parseJoiinPnl, summariseJoiinPnl, parseBoardPack } from "../lib/joiin-rules.js";

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

test("parseBoardPack: markdown-padded board pack → ordered kinds; totals relabelled; % as fraction", () => {
  const md = [
    "|  | Jun 26 |",
    "| Store Sales | - |",
    "|   ST: Sales | £1,687,139 |",
    "|   Total | £1,687,139 |",
    "| Store Gross Profit | 1,012,607 |",
    "| Gross Margin % | 60% |",
    "| Store EBITDA | -161,929 |",
  ].join("\n");
  const p = parseBoardPack(md);
  assert.deepEqual(p.months, ["2026-06"]);
  assert.deepEqual(p.rows.map((r) => [r.kind, r.label]), [
    ["section", "Store Sales"],
    ["line", "ST: Sales"],
    ["total", "Total Store Sales"],   // relabelled with the section it closes
    ["computed", "Store Gross Profit"],
    ["pct", "Gross Margin %"],
    ["computed", "Store EBITDA"],
  ]);
  assert.equal(p.rows[1].values["2026-06"], 1687139);
  assert.equal(p.rows[3].values["2026-06"], 1012607);
  assert.equal(p.rows[4].values["2026-06"], 0.6);   // % stored as a fraction
  assert.equal(p.rows[5].values["2026-06"], -161929);
});
