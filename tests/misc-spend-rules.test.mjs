import { test } from "node:test";
import assert from "node:assert/strict";
import { MISC_CATEGORIES, MISC_CATEGORY_GROUPS, isMiscCategory, validateMiscSpend, miscTotals } from "../lib/misc-spend-rules.js";

test("MISC_CATEGORIES holds the fixed general + marketing categories", () => {
  assert.equal(MISC_CATEGORIES.length, 12);
  assert.ok(isMiscCategory("Travel & Mileage"));
  assert.ok(isMiscCategory("Petty Cash"));
  // Marketing sub-categories are valid too.
  assert.ok(isMiscCategory("UGC Product"));
  assert.ok(isMiscCategory("Marketing Goodwill"));
  assert.ok(isMiscCategory("Product Sendouts (Postage/Packing)"));
  assert.ok(isMiscCategory("Marketing Props"));
  assert.ok(!isMiscCategory("Marketing"));
  assert.ok(!isMiscCategory(""));
});

test("MISC_CATEGORY_GROUPS splits general and marketing, and covers the flat list", () => {
  assert.deepEqual(MISC_CATEGORY_GROUPS.map((g) => g.label), ["General", "Marketing"]);
  // Every grouped category is in the flat list, and vice versa (no duplicates, no orphans).
  const grouped = MISC_CATEGORY_GROUPS.flatMap((g) => g.categories);
  assert.deepEqual(grouped, MISC_CATEGORIES);
  assert.equal(new Set(grouped).size, grouped.length);
});

test("validateMiscSpend needs a category, a positive amount and a budget", () => {
  assert.deepEqual(validateMiscSpend({ category: "Accommodation", amount: 120, budget_id: 5 }), []);
  assert.match(validateMiscSpend({ amount: 10, budget_id: 5 }).join(" "), /category/);
  assert.match(validateMiscSpend({ category: "Hospitality", amount: 0, budget_id: 5 }).join(" "), /greater than zero/);
  assert.match(validateMiscSpend({ category: "Hospitality", amount: 10 }).join(" "), /budget/);
  assert.match(validateMiscSpend({ category: "Hospitality", amount: 10, budget_id: 0 }).join(" "), /budget/);
});

test("miscTotals sums the total and breaks down by category", () => {
  const t = miscTotals([
    { category: "Food & Drink", amount: 12.5 },
    { category: "Food & Drink", amount: 7.5 },
    { category: "Travel & Mileage", amount: 40 },
  ]);
  assert.equal(t.total, 60);
  assert.equal(t.count, 3);
  assert.equal(t.byCategory["Food & Drink"], 20);
  assert.equal(t.byCategory["Travel & Mileage"], 40);
  assert.deepEqual(miscTotals([]), { total: 0, count: 0, byCategory: {} });
});
