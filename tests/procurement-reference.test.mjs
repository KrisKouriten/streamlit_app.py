import { test } from "node:test";
import assert from "node:assert/strict";
import { procRef, referenceError } from "../lib/procurement-close-rules.js";

test("a typed reference is the order's reference; blank gets PP- / MR- + order no", () => {
  assert.equal(procRef({ reference: "WCTUKA093041", purchase_id: 12 }), "WCTUKA093041");
  assert.equal(procRef({ reference: null, purchase_id: 12 }), "PP-12");
  assert.equal(procRef({ reference: "", purchase_id: 7, channel_code: "RETAIL" }), "MR-7");
});

test("each live order needs its own reference", () => {
  const others = [{ purchase_id: 1, supplier: "Esdevium", reference: "wctuka093041 ", approval_status: "APPROVED" }];
  assert.match(referenceError("WCTUKA093041", others), /already on another order \(Esdevium\)/);
  // The same order keeping its own reference is fine.
  assert.equal(referenceError("WCTUKA093041", others, 1), null);
  // A cancelled order's reference can be reused.
  assert.equal(referenceError("WCTUKA093041", [{ ...others[0], approval_status: "CANCELLED" }]), null);
  assert.equal(referenceError("", others), null);
  assert.equal(referenceError("  ", others), null);
});

test("the generated PP- / MR- format is kept for the system", () => {
  assert.match(referenceError("PP-1042", []), /format the system gives/);
  assert.match(referenceError("mr-7", []), /format the system gives/);
  assert.equal(referenceError("PO-2087", []), null);
  assert.equal(referenceError("PP-REF-1", []), null);
});
