import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, mapRows, CATEGORIES } from "../lib/intercompany-rules.js";

test("parseCsv handles quoted fields with embedded commas", () => {
  const { headers, records } = parseCsv('A,B,C\n1,"two, and a half",3\n');
  assert.deepEqual(headers, ["A", "B", "C"]);
  assert.equal(records[0].B, "two, and a half");
});

test("Cash ledger maps entities, amount and reconciliation flags", () => {
  const csv = [
    "Credit Entity (CF Out),Date,Currency,Amount,Payment Reference (Unique ID),Debit Entity (CF In),Credit - Bank Account Reconciled (Intercompany-Cash),Debit - Bank Account Reconciled (Intercompany-Cash),Xero Balance Sheet Reconciled,Cashflow Reconciled",
    "Kouriten Limited,2026-07-01,GBP,17000,KL-KEAL IC 010726,Kouriten Ealing Limited,Yes,Yes,No,No",
  ].join("\n");
  const { headers, records } = parseCsv(csv);
  const { records: mapped, errors } = mapRows("CASH", headers, records);
  assert.equal(errors.length, 0);
  assert.equal(mapped.length, 1);
  const m = mapped[0];
  assert.equal(m.creditName, "Kouriten Limited");
  assert.equal(m.debitName, "Kouriten Ealing Limited");
  assert.equal(m.gross_amount, 17000);
  assert.equal(m.recon_credit, true);
  assert.equal(m.recon_balance_sheet, false);
  assert.equal(m.recon_cashflow, false);
});

test("Inventory ledger keeps gross/net/vat distinct and reads invoice + reference", () => {
  const csv = [
    "Credit Entity (CF Out),Date,Currency,Gross Amount,Net Amount,VAT,Kouriten Invoice Number,Reference,Debit Entity (CF In)",
    'Kouriten Limited,2026-06-30,GBP,"28,858.79","24,048.97","4,809.82",INV-6068,INV-6068-30Jun26,Kouriten Brent Cross Limited',
  ].join("\n");
  const { headers, records } = parseCsv(csv);
  const { records: mapped } = mapRows("INVENTORY_RECHARGES", headers, records);
  const m = mapped[0];
  assert.equal(m.gross_amount, 28858.79);
  assert.equal(m.net_amount, 24048.97);
  assert.equal(m.vat_amount, 4809.82);
  assert.equal(m.invoice_number, "INV-6068");
});

test("Disbursements ledger reads supplier, nominal, settled", () => {
  const csv = [
    "Credit Entity (CF Out),Date,Invoice Number,Currency,Gross Amount,Supplier Name,Nominal,Payment Method,Payment Reference,Debit Entity (CF In),Settled on Xero (Intercompany-Disbursements),Xero Balance Sheet Reconciled",
    "Kouriten Limited,2026-07-10,21785,GBP,69.60,Design360,Capex,TradePay,Desi360TP150726,Kouriten Brent Cross Limited,Yes,No",
  ].join("\n");
  const { headers, records } = parseCsv(csv);
  const { records: mapped } = mapRows("DISBURSEMENTS", headers, records);
  const m = mapped[0];
  assert.equal(m.supplier_name, "Design360");
  assert.equal(m.nominal, "Capex");
  assert.equal(m.gross_amount, 69.6);
  assert.equal(m.settled, true);
  assert.equal(m.recon_balance_sheet, false);
});

test("a row missing an entity or amount is reported, not silently kept", () => {
  const csv = [
    "Credit Entity (CF Out),Date,Currency,Amount,Payment Reference (Unique ID),Debit Entity (CF In)",
    "Kouriten Limited,2026-07-01,GBP,,REF1,Kouriten Ealing Limited",
    ",2026-07-01,GBP,500,REF2,Kouriten Ealing Limited",
  ].join("\n");
  const { headers, records } = parseCsv(csv);
  const { records: mapped, errors } = mapRows("CASH", headers, records);
  assert.equal(mapped.length, 0);
  assert.equal(errors.length, 2);
});

test("every category exposes a CSV template and reconciliation set", () => {
  for (const k of Object.keys(CATEGORIES)) {
    assert.ok(CATEGORIES[k].csvTemplate.includes("Credit Entity"));
    assert.ok(CATEGORIES[k].recon.length >= 1);
  }
});
