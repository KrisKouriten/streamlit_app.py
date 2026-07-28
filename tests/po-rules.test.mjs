import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePo, rechargeTotal, rechargeError, equalSplit, rechargeAmounts,
  invoiceOutcome, canSubmitForSignoff, poTransitionError, isEditablePo, PO_STATUSES, PO_TRANSITIONS,
} from "../lib/po-rules.js";

const goodPo = {
  po_date: "2026-07-01", supplier: "Acme Media Ltd", currency: "GBP",
  payment_value: 12000, vat_amount: 2400, po_category: "Marketing",
  xero_po_number: "PO-1042", department: "Marketing", is_marketing: false,
};

test("validatePo happy path", () => {
  assert.equal(validatePo(goodPo), null);
});

test("validatePo catches each missing/!bad field", () => {
  assert.match(validatePo({ ...goodPo, po_date: "" }), /P.O date/);
  assert.match(validatePo({ ...goodPo, supplier: "  " }), /supplier/);
  assert.match(validatePo({ ...goodPo, currency: "" }), /currency/);
  assert.match(validatePo({ ...goodPo, payment_value: 0 }), /greater than zero/);
  assert.match(validatePo({ ...goodPo, vat_amount: -5 }), /VAT/);
  assert.match(validatePo({ ...goodPo, po_category: "" }), /category/);
  assert.match(validatePo({ ...goodPo, xero_po_number: "" }), /Xero/);
  assert.match(validatePo({ ...goodPo, department: "" }), /department/);
});

test("rechargeTotal and rechargeError", () => {
  assert.equal(rechargeTotal([{ pct: 60 }, { pct: 40 }]), 100);
  assert.equal(rechargeError([{ pct: 60 }, { pct: 40 }]), null);
  assert.match(rechargeError([{ pct: 60 }, { pct: 30 }]), /must total 100%.*90%/);
  assert.match(rechargeError([]), /at least one store/);
  assert.match(rechargeError([{ pct: -10 }, { pct: 110 }]), /negative/);
  assert.equal(rechargeError([{ pct: 10 }], { enabled: false }), null);
});

test("equalSplit sums to exactly 100 including awkward counts", () => {
  for (const n of [1, 2, 3, 6, 7, 11]) {
    const stores = Array.from({ length: n }, (_, i) => ({ store_code: `S${i}` }));
    const split = equalSplit(stores);
    assert.equal(split.length, n);
    assert.equal(rechargeTotal(split), 100, `n=${n} must total 100`);
  }
  // 3-way: 33.34 / 33.33 / 33.33
  const three = equalSplit([{ store_code: "a" }, { store_code: "b" }, { store_code: "c" }]);
  assert.deepEqual(three.map((s) => s.pct), [33.34, 33.33, 33.33]);
});

test("rechargeAmounts derives the £ share", () => {
  const out = rechargeAmounts([{ pct: 25 }, { pct: 75 }], 12000);
  assert.deepEqual(out.map((l) => l.amount), [3000, 9000]);
});

test("invoiceOutcome follows the marketing levy logic", () => {
  assert.equal(invoiceOutcome({ isMarketing: true, marketingLevy: true }).code, "LEVY_NO_INVOICE");
  assert.equal(invoiceOutcome({ isMarketing: true, marketingLevy: false }).code, "FINANCE_TO_INVOICE");
  assert.equal(invoiceOutcome({ isMarketing: false, rechargeEnabled: true }).code, "STANDARD");
  assert.equal(invoiceOutcome({ isMarketing: false, rechargeEnabled: false }).code, "NONE");
});

test("canSubmitForSignoff enforces fields, levy answer and 100% recharge", () => {
  // no recharge, non-marketing → fine
  assert.equal(canSubmitForSignoff({ ...goodPo, recharge_enabled: false }), null);
  // marketing without a levy answer → blocked
  assert.match(canSubmitForSignoff({ ...goodPo, is_marketing: true, marketing_levy: null }), /marketing levy/);
  // recharge on but not 100% → blocked
  assert.match(
    canSubmitForSignoff({ ...goodPo, recharge_enabled: true }, [{ pct: 50 }, { pct: 30 }]),
    /must total 100%/
  );
  // recharge on and 100% → fine
  assert.equal(
    canSubmitForSignoff({ ...goodPo, is_marketing: true, marketing_levy: true, recharge_enabled: true }, [{ pct: 50 }, { pct: 50 }]),
    null
  );
});

test("PO transitions", () => {
  assert.equal(poTransitionError("submit_for_signoff", "DRAFT"), null);
  assert.equal(poTransitionError("approve", "PENDING_SIGNOFF"), null);
  assert.match(poTransitionError("approve", "DRAFT"), /Cannot approve/);
  assert.match(poTransitionError("bogus", "DRAFT"), /Unknown action/);
  for (const t of Object.values(PO_TRANSITIONS)) {
    if (t.to) assert.ok(PO_STATUSES.includes(t.to));
  }
});

test("isEditablePo", () => {
  assert.equal(isEditablePo("DRAFT"), true);
  assert.equal(isEditablePo("REJECTED"), true);
  assert.equal(isEditablePo("PENDING_SIGNOFF"), false);
  assert.equal(isEditablePo("APPROVED"), false);
});
