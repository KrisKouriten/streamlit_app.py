/*
 * Miscellaneous spend — pure rules. No imports, no DB. Small planned expenditure
 * that doesn't warrant a P.O, logged by category and assigned to a department
 * budget. Unit-tested in tests/misc-spend-rules.test.mjs.
 */

// The fixed spend categories, grouped for display. "General" covers everyday
// operational costs; "Marketing" covers the marketing-specific spend lines
// (UGC product, goodwill, sendouts, props). Order = display order.
export const MISC_CATEGORY_GROUPS = [
  {
    label: "General",
    categories: [
      "Travel & Mileage",
      "Accommodation",
      "Hospitality",
      "Food & Drink",
      "Office Supplies",
      "Cleaning & Kitchen",
      "Minor Equipment",
      "Petty Cash",
    ],
  },
  {
    label: "Marketing",
    categories: [
      "UGC Product",
      "Marketing Goodwill",
      "Product Sendouts (Postage/Packing)",
      "Marketing Props",
    ],
  },
];

// Flat list of every valid category (used for validation + totals).
export const MISC_CATEGORIES = MISC_CATEGORY_GROUPS.flatMap((g) => g.categories);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function isMiscCategory(c) {
  return MISC_CATEGORIES.includes(String(c || "").trim());
}

// Validate one entry. Returns an array of error strings (empty = valid).
export function validateMiscSpend(i = {}) {
  const errors = [];
  if (!isMiscCategory(i.category)) errors.push("Choose a spend category");
  const amount = Number(i.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Enter an amount greater than zero");
  if (!(Number(i.budget_id) > 0)) errors.push("Assign the spend to a budget");
  return errors;
}

// Total + per-category breakdown across a set of misc-spend rows.
export function miscTotals(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const byCategory = {};
  let total = 0;
  for (const r of list) {
    const a = Number(r.amount) || 0;
    total += a;
    byCategory[r.category] = round2((byCategory[r.category] || 0) + a);
  }
  return { total: round2(total), count: list.length, byCategory };
}
