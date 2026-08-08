import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normHeader, ownershipFromOperator, cleanNum, cleanFlag, toIsoDate, dateKey,
  parseSalesRows, storeTradingWindows,
} from "../lib/store-sales-import-rules.js";

test("normHeader strips to lowercase alphanumerics", () => {
  assert.equal(normHeader("Net Sales (£)"), "netsales");
  assert.equal(normHeader("Store No."), "storeno");
  assert.equal(normHeader("  Footfall In "), "footfallin");
});

test("ownershipFromOperator: company vs franchise", () => {
  assert.equal(ownershipFromOperator("Kouriten"), "COMPANY");
  assert.equal(ownershipFromOperator("Miniso UK"), "COMPANY");
  assert.equal(ownershipFromOperator(""), "COMPANY");
  assert.equal(ownershipFromOperator(null), "COMPANY");
  assert.equal(ownershipFromOperator("FD Retailing"), "FRANCHISE");
});

test("cleanNum strips currency + commas; blanks/None → null", () => {
  assert.equal(cleanNum("£1,026.36"), 1026.36);
  assert.equal(cleanNum("1234"), 1234);
  assert.equal(cleanNum(500), 500);
  assert.equal(cleanNum("None"), null);
  assert.equal(cleanNum(""), null);
  assert.equal(cleanNum(null), null);
});

test("cleanFlag reads 1/0/true/false/yes/no", () => {
  assert.equal(cleanFlag(1), true);
  assert.equal(cleanFlag("0"), false);
  assert.equal(cleanFlag("Yes"), true);
  assert.equal(cleanFlag("no"), false);
  assert.equal(cleanFlag("", true), true);   // default when blank
  assert.equal(cleanFlag(null, false), false);
});

test("toIsoDate handles Date, ISO, UK and Excel serial", () => {
  assert.equal(toIsoDate(new Date(Date.UTC(2026, 0, 2))), "2026-01-02");
  assert.equal(toIsoDate("2026-01-02 00:00:00"), "2026-01-02");
  assert.equal(toIsoDate("02/01/2026"), "2026-01-02");   // DD/MM/YYYY
  assert.equal(toIsoDate(46023), "2026-01-01");          // Excel serial (1900 system)
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate("not a date"), null);
});

test("dateKey builds YYYYMMDD integer", () => {
  assert.equal(dateKey("2026-01-02"), 20260102);
  assert.equal(dateKey(null), null);
});

const HEADER = [
  "Store Name", "Store No.", "Franchise Name", "Date", "Net Sales (£)", "Tax (£)", "Gross Sales (£)",
  "Wholesale Cost SB-Adj (£)", "Write-Off Adj (£)", "True Cost of Sale (£)", "Surprise Bag Item Cost (£)",
  "Gross Profit (£)", "Margin % (original file)", "Valid Day", "Margin % (adjusted)", "Data Flag",
  "Match Status", "Net Units Sold", "No of Trans", "Return Trans Count", "Net Transactions",
  "Footfall In", "Footfall Out", "Gross Return Value (£)", "Net Return Value (£)", "ATV", "ATU", "Conversion",
];
function row(store, code, franchise, date, net, gross, gp, valid, units, transGross, retTrans, netTrans, footIn, netRet) {
  const r = new Array(HEADER.length).fill(null);
  r[0] = store; r[1] = code; r[2] = franchise; r[3] = date; r[4] = net; r[6] = gross;
  r[11] = gp; r[13] = valid; r[17] = units; r[18] = transGross; r[19] = retTrans;
  r[20] = netTrans; r[21] = footIn; r[24] = netRet;
  return r;
}

test("parseSalesRows maps the Combined layout and derives fields", () => {
  const matrix = [
    HEADER,
    row("Ballymena", "GB022", "FD Retailing", "2026-01-02", "1026.36", "1221.08", "608.95", 1, 100, 90, 2, 88, 400, "12.50"),
    row("Bluewater", "GB100", "Kouriten", "2026-02-10", "5000", "6000", "3000", 1, 500, 300, 5, 295, 1200, "0"),
    row("Total", null, null, null, null, null, null, null, null, null, null, null, null, null), // artefact → skipped
    row("Ballymena", "GB022", "FD Retailing", "2026-01-12", "204.96", "245.95", "-450.11", 0, 20, 18, 0, 18, 90, "0"), // invalid day kept
  ];
  const out = parseSalesRows(matrix);
  assert.equal(out.rows.length, 3);
  assert.equal(out.skipped, 1);           // the Total row
  assert.deepEqual(out.stores.sort(), ["GB022", "GB100"]);
  assert.deepEqual(out.months, ["2026-01", "2026-02"]);
  assert.deepEqual(out.years, [2026]);
  assert.equal(out.dateMin, "2026-01-02");
  assert.equal(out.dateMax, "2026-02-10");

  const b = out.rows[0];
  assert.equal(b.storeName, "Ballymena");
  assert.equal(b.storeCode, "GB022");
  assert.equal(b.ownershipType, "FRANCHISE");
  assert.equal(b.dateKey, 20260102);
  assert.equal(b.netSales, 1026.36);
  assert.equal(b.grossProfit, 608.95);
  assert.equal(b.transactions, 88);       // net transactions preferred
  assert.equal(b.transactionsGross, 90);
  assert.equal(b.returnTransactions, 2);
  assert.equal(b.footfall, 400);
  assert.equal(b.isValidDay, true);

  const co = out.rows[1];
  assert.equal(co.ownershipType, "COMPANY");   // Kouriten → company-operated
  assert.equal(out.rows[2].isValidDay, false); // the flagged day
});

test("parseSalesRows falls back to net→gross transactions and store name as code", () => {
  const matrix = [
    HEADER,
    (() => { const r = row("Popup", "", "", "2026-03-01", "100", "120", "60", 1, 10, 9, 0, null, 40, null); return r; })(),
  ];
  const out = parseSalesRows(matrix);
  assert.equal(out.rows[0].storeCode, "Popup");     // blank code → name
  assert.equal(out.rows[0].transactions, 9);        // net blank → gross used
  assert.equal(out.rows[0].operator, null);
});

test("parseSalesRows warns when no header is found", () => {
  const out = parseSalesRows([["nothing", "useful"], ["1", "2"]]);
  assert.equal(out.rows.length, 0);
  assert.ok(out.warnings.length > 0);
});

test("storeTradingWindows computes first/last per store", () => {
  const rows = [
    { storeCode: "A", storeName: "Alpha", operator: "Kouriten", ownershipType: "COMPANY", dateIso: "2026-01-05" },
    { storeCode: "A", storeName: "Alpha", operator: "Kouriten", ownershipType: "COMPANY", dateIso: "2026-01-02" },
    { storeCode: "A", storeName: "Alpha", operator: "Kouriten", ownershipType: "COMPANY", dateIso: "2026-03-20" },
    { storeCode: "B", storeName: "Beta", operator: "FD", ownershipType: "FRANCHISE", dateIso: "2026-02-01" },
  ];
  const w = storeTradingWindows(rows).sort((a, b) => a.storeCode.localeCompare(b.storeCode));
  assert.equal(w[0].first, "2026-01-02");
  assert.equal(w[0].last, "2026-03-20");
  assert.equal(w[1].storeCode, "B");
  assert.equal(w[1].first, "2026-02-01");
});
