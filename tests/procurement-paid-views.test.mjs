import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUEST_VIEWS, orderPaid } from "../lib/procurement-rules.js";

const view = (k) => REQUEST_VIEWS.find((v) => v.key === k).test;

test("Paid and Unpaid views sit beside the status views", () => {
  const keys = REQUEST_VIEWS.map((v) => v.key);
  assert.ok(keys.includes("PAID") && keys.includes("UNPAID"));
});

test("paid: Finance marked it paid (or the legacy PAID status); cancelled never shows", () => {
  assert.equal(orderPaid({ payment_status: "PAID" }), true);
  assert.equal(orderPaid({ status: "PAID" }), true);
  assert.equal(orderPaid({ payment_status: "PART_PAID" }), false);
  assert.equal(view("PAID")({ approval_status: "APPROVED", payment_status: "PAID" }), true);
  assert.equal(view("PAID")({ approval_status: "CANCELLED", payment_status: "PAID" }), false);
});

test("unpaid: live and not paid — part-paid included; drafts and cancelled excluded", () => {
  const u = view("UNPAID");
  assert.equal(u({ approval_status: "APPROVED" }), true);
  assert.equal(u({ approval_status: "PENDING" }), true);
  assert.equal(u({ approval_status: "APPROVED", payment_status: "PART_PAID" }), true);
  assert.equal(u({ approval_status: "APPROVED", payment_status: "PAID" }), false);
  assert.equal(u({ approval_status: "CANCELLED" }), false);
  assert.equal(u({ approval_status: "PENDING", request_status: "DRAFT" }), false);
});
