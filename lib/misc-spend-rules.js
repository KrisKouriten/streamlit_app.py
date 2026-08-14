/*
 * Miscellaneous spend — pure rules. No imports, no DB. Small planned expenditure
 * that doesn't warrant a P.O, logged by category and assigned to a department
 * budget. Unit-tested in tests/misc-spend-rules.test.mjs.
 */

// The fixed spend categories (order = display order).
export const MISC_CATEGORIES = [
  "Travel & Mileage",
  "Accommodation",
  "Hospitality",
  "Food & Drink",
  "Office Supplies",
  "Cleaning & Kitchen",
  "Minor Equipment",
  "Petty Cash",
];

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
