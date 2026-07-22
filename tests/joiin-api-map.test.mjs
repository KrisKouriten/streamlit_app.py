import { test } from "node:test";
import assert from "node:assert/strict";
import { numFrom, mapReportRows, mapCompanies } from "../lib/joiin-api-map.js";

test("numFrom coerces number, string, and nested-array shapes", () => {
  assert.equal(numFrom(1234.5), 1234.5);
  assert.equal(numFrom("1,234.50"), 1234.5);
  assert.equal(numFrom("£1,000"), 1000);
  assert.equal(numFrom([["123.45"]]), 123.45);
  assert.equal(numFrom([678.9]), 678.9);
  assert.equal(numFrom(null), 0);
});

test("mapReportRows flattens sections → account rows (nested value)", () => {
  const json = {
    sections: [
      { name: "Revenue", accounts: [{ displayName: "ST: Sales", value: [["1000"]] }] },
      { name: "Cost of Sales", accounts: [{ displayName: "ST: Cost of Goods Sold", value: [["400"]] }] },
    ],
  };
  const rows = mapReportRows(json);
  assert.deepEqual(rows, [
    { section: "Revenue", account: "ST: Sales", value: 1000 },
    { section: "Cost of Sales", account: "ST: Cost of Goods Sold", value: 400 },
  ]);
});

test("mapReportRows handles a flat accounts fallback", () => {
  const rows = mapReportRows({ accounts: [{ name: "HO: Freight", amount: 131760.27 }] });
  assert.deepEqual(rows, [{ section: "P&L", account: "HO: Freight", value: 131760.27 }]);
});

test("mapCompanies normalises id/name", () => {
  assert.deepEqual(mapCompanies({ companies: [{ id: "abc", name: "Kouriten Limited" }] }), [{ id: "abc", name: "Kouriten Limited" }]);
});
