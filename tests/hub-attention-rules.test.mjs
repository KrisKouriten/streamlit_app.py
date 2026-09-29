import test from "node:test";
import assert from "node:assert/strict";
import {
  daysWaiting, poAttention, procurementAttention, deptBudgetAttention, procurementBudgetAttention, rankAttention,
} from "../lib/hub-attention-rules.js";

const TODAY = new Date("2026-09-29T12:00:00Z");

test("daysWaiting counts whole days, and is null with no date", () => {
  assert.equal(daysWaiting("2026-09-20T12:00:00Z", TODAY), 9);
  assert.equal(daysWaiting(null, TODAY), null);
});

test("poAttention lists only P.Os awaiting sign-off, oldest first, stale ones HIGH", () => {
  const items = poAttention([
    { po_id: 1, po_number: "PO-001", status: "PENDING_SIGNOFF", supplier: "Acme", department: "Marketing", payment_value: 1200, updated_at: "2026-09-27T09:00:00Z" },
    { po_id: 2, po_number: "PO-002", status: "PENDING_SIGNOFF", supplier: "Beta", department: "HR", payment_value: 500, updated_at: "2026-09-10T09:00:00Z" },
    { po_id: 3, po_number: "PO-003", status: "APPROVED", supplier: "Gamma" },
    { po_id: 4, po_number: "PO-004", status: "DRAFT", supplier: "Delta" },
  ], TODAY);
  assert.deepEqual(items.map((i) => i.headline), [
    "P.O awaiting sign-off: PO-002 · Beta",
    "P.O awaiting sign-off: PO-001 · Acme",
  ]);
  assert.equal(items[0].severity, "HIGH");
  assert.equal(items[1].severity, "AMBER");
  assert.match(items[0].detail, /HR · £500 · waiting 19 days/);
});

test("procurementAttention lists requests with the head of department or with Finance", () => {
  const items = procurementAttention([
    { purchase_id: 1, source: "LOCAL", supplier: "DKB Toys", amount_gbp: 30000, approval_status: "PENDING", created_at: "2026-09-28T09:00:00Z" },
    { purchase_id: 2, source: "MINISO", supplier: "Miniso HQ", amount_gbp: 420000, approval_status: "HOD_APPROVED", created_at: "2026-09-01T09:00:00Z", hod_approved_at: "2026-09-15T09:00:00Z" },
    { purchase_id: 3, source: "LOCAL", supplier: "Done Ltd", amount_gbp: 100, approval_status: "APPROVED" },
    { purchase_id: 4, source: "LOCAL", supplier: "Gone Ltd", amount_gbp: 100, approval_status: "CANCELLED" },
  ], TODAY);
  assert.equal(items.length, 2);
  assert.match(items[0].headline, /PP-2 · Miniso HQ/);
  assert.match(items[0].detail, /with Finance · waiting 14 days/);
  assert.equal(items[0].severity, "HIGH");
  assert.match(items[1].detail, /Local · £30k · with head of department/);
});

test("deptBudgetAttention flags a budget whose remaining is below zero; CRITICAL when committed alone is over", () => {
  const items = deptBudgetAttention([
    { department: "Marketing", proposed: 100000, committed: 90000, open: 20000, left: -10000 },
    { department: "HR", proposed: 50000, committed: 60000, open: 0, left: -10000 },
    { department: "IT", proposed: 80000, committed: 10000, open: 5000, left: 65000 },
    { department: "Legal", proposed: 0, committed: 5000, open: 0, left: -5000 },   // no budget set — not overspend
  ]);
  assert.deepEqual(items.map((i) => [i.headline, i.severity]), [
    ["Marketing: over budget by £10k", "HIGH"],
    ["HR: over budget by £10k", "CRITICAL"],
  ]);
  assert.match(items[0].href, /dept=Marketing/);
});

test("procurementBudgetAttention flags over-budget months from this year on, by source", () => {
  const summary = {
    MINISO: { months: [
      { ym: "2025-12", budget: 100, committed: 200, spent: 0, variance: -100, overBudget: true, overSpent: false },
      { ym: "2026-12", budget: 500000, committed: 300000, spent: 250000, variance: -50000, overBudget: true, overSpent: false },
    ] },
    LOCAL: { months: [
      { ym: "2026-11", budget: 100000, committed: 0, spent: 120000, variance: -20000, overBudget: true, overSpent: true },
      { ym: "2026-10", budget: 100000, committed: 0, spent: 50000, variance: 50000, overBudget: false, overSpent: false },
    ] },
  };
  const items = procurementBudgetAttention(summary, "2026-01");
  assert.deepEqual(items.map((i) => [i.headline, i.severity]), [
    ["Miniso purchases · Dec 2026: over budget by £50k", "HIGH"],
    ["Local purchases · Nov 2026: over budget by £20k", "CRITICAL"],
  ]);
});

test("rankAttention puts critical first, budgets before approvals, and strips sort keys", () => {
  const ranked = rankAttention([
    { severity: "AMBER", kind: "PO", headline: "po", _days: 1 },
    { severity: "HIGH", kind: "PROCUREMENT", headline: "proc", _days: 9 },
    { severity: "HIGH", kind: "BUDGET", headline: "budget", _over: 5 },
    { severity: "CRITICAL", kind: "BUDGET", headline: "crit", _over: 1 },
  ]);
  assert.deepEqual(ranked.map((r) => r.headline), ["crit", "budget", "proc", "po"]);
  assert.equal("_days" in ranked[2], false);
});
