import { test } from "node:test";
import assert from "node:assert/strict";
import { STORE_FORMAT, FRANCHISE_FORMAT, renderFormat, buildGenericFormat, classifyEntity } from "../lib/pl-format.js";
import { parseJoiinByCompany } from "../lib/joiin-rules.js";

const cols = ["2026-01"];
const av = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { "2026-01": v }]));

test("STORE_FORMAT: subtotals, gross profit, EBITDA and margins compute", () => {
  const rows = renderFormat(STORE_FORMAT, av({
    "ST: Sales": 1000,
    "ST: Cost of Goods Sold": 400,
    "ST: Employers National Insurance": 50,
    "ST: Salaries - Basic Pay": 150,
    "ST: Rent": 100,
    "ST: Advertising & Marketing": 20,
    "ST: Audit & Accountancy fees": 10,
  }), cols);
  const get = (l) => rows.find((r) => r.label === l);
  assert.equal(get("Total Store Cost of Sales").values["2026-01"], 400);
  assert.equal(get("Store Gross Profit").values["2026-01"], 600); // 1000 - 400
  assert.equal(get("Gross Margin %").values["2026-01"], 0.6);
  assert.equal(get("Total Store Staff Costs").values["2026-01"], 200); // 50 + 150
  assert.equal(get("Total Store Establishment Costs").values["2026-01"], 100);
  assert.equal(get("Total Store Marketing Expenses").values["2026-01"], 20);
  // G&A = marketing(20) + legal(10); Store Total Expenses = staff(200)+est(100)+G&A&legal(30)=330
  assert.equal(get("Store Total Expenses").values["2026-01"], 330);
  assert.equal(get("Store EBITDA").values["2026-01"], 270); // 600 - 330
  assert.equal(Number(get("Store EBITDA %").values["2026-01"].toFixed(3)), 0.27);
});

test("FRANCHISE_FORMAT: revenue total and EBITDA", () => {
  const rows = renderFormat(FRANCHISE_FORMAT, av({
    "FR: Franchise Fee - Royalties": 80,
    "FR: Franchise Fee - Marketing": 20,
    "FR: Advertising & Marketing": 5,
    "FR: Audit & Accountancy fees": 3,
  }), cols);
  const get = (l) => rows.find((r) => r.label === l);
  assert.equal(get("Total Franchise Revenue").values["2026-01"], 100);
  assert.equal(get("Franchise EBITDA").values["2026-01"], 92); // 100 - 5 - 3
});

test("buildGenericFormat derives Net Profit from sections", () => {
  const accts = [
    { section: "Revenue", account: "ST: Sales" },
    { section: "Cost of Sales", account: "ST: Cost of Goods Sold" },
    { section: "Expenses", account: "ST: Rent" },
  ];
  const fmt = buildGenericFormat(accts);
  const rows = renderFormat(fmt, av({ "ST: Sales": 1000, "ST: Cost of Goods Sold": 400, "ST: Rent": 300 }), cols);
  const get = (l) => rows.find((r) => r.label === l);
  assert.equal(get("Gross Profit").values["2026-01"], 600);
  assert.equal(get("Operating Profit").values["2026-01"], 300); // 600 - 300
});

test("classifyEntity routes store / franchise / generic", () => {
  assert.equal(classifyEntity("Kouriten West London Limited", ["ST: Sales", "ST: Rent"]), "store");
  assert.equal(classifyEntity("Kouriten Franchise Limited", ["FR: Franchise Fee - Royalties"]), "franchise");
  assert.equal(classifyEntity("Kouriten Limited", ["HO: Freight"]), "generic");
});

test("parseJoiinByCompany: entities as columns, drops Total column and computed lines", () => {
  const md = [
    "|  | Kouriten West London Limited | Kouriten Limited | Total |",
    "|---|---|---|---|",
    "| Revenue | - | - | - |",
    "|   ST: Sales | £1,000 | £0 | £1,000 |",
    "|   HO: Stock Sales - Franchise | £0 | £500 | £500 |",
    "|   Total | £1,000 | £500 | £1,500 |",
    "| Cost of Sales | - | - | - |",
    "|   ST: Cost of Goods Sold | £400 | £0 | £400 |",
    "|   Total | £400 | £0 | £400 |",
    "| Gross Profit | £600 | £500 | £1,100 |",
    "| Net Profit | £600 | £500 | £1,100 |",
  ].join("\n");
  const { entities, rows } = parseJoiinByCompany(md, "2026-06");
  assert.deepEqual(entities, ["Kouriten West London Limited", "Kouriten Limited"]);
  // no "Total" entity, no Gross/Net Profit rows, no section-total rows
  const wl = rows.filter((r) => r.entity_name === "Kouriten West London Limited");
  assert.equal(wl.find((r) => r.account === "ST: Sales").value, 1000);
  assert.equal(wl.find((r) => r.account === "ST: Cost of Goods Sold").value, 400);
  assert.ok(!rows.some((r) => r.account === "Total" || r.account === "Gross Profit" || r.account === "Net Profit"));
  assert.equal(rows.find((r) => r.entity_name === "Kouriten Limited" && r.account === "HO: Stock Sales - Franchise").value, 500);
});
