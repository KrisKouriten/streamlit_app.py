import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCardSpend, cardSpendTotals } from "../lib/card-spend-rules.js";

test("validateCardSpend needs a supplier, a positive amount and a budget", () => {
  assert.deepEqual(validateCardSpend({ supplier: "Amazon", amount: 45, budget_id: 5 }), []);
  assert.match(validateCardSpend({ amount: 10, budget_id: 5 }).join(" "), /supplier/);
  assert.match(validateCardSpend({ supplier: "  ", amount: 10, budget_id: 5 }).join(" "), /supplier/);
  assert.match(validateCardSpend({ supplier: "Canva", amount: 0, budget_id: 5 }).join(" "), /greater than zero/);
  assert.match(validateCardSpend({ supplier: "Canva", amount: -1, budget_id: 5 }).join(" "), /greater than zero/);
  assert.match(validateCardSpend({ supplier: "Canva", amount: 10 }).join(" "), /budget/);
  assert.match(validateCardSpend({ supplier: "Canva", amount: 10, budget_id: 0 }).join(" "), /budget/);
});

test("cardSpendTotals sums the total and counts the rows", () => {
  const t = cardSpendTotals([
    { supplier: "Amazon", amount: 12.5 },
    { supplier: "Uber", amount: 7.5 },
    { supplier: "Canva", amount: 40 },
  ]);
  assert.equal(t.total, 60);
  assert.equal(t.count, 3);
  assert.deepEqual(cardSpendTotals([]), { total: 0, count: 0 });
  // Non-numeric / missing amounts are treated as zero.
  assert.deepEqual(cardSpendTotals([{ amount: "x" }, { amount: 5 }]), { total: 5, count: 2 });
});
