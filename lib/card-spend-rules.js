/*
 * Card / pre-approved spend — pure rules. No imports, no DB. Spend already made on
 * a company card (or otherwise pre-approved) that doesn't go through the P.O +
 * sign-off flow, logged against a department budget and reported as committed
 * spend. Unit-tested in tests/card-spend-rules.test.mjs.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Validate one entry. Returns an array of error strings (empty = valid).
export function validateCardSpend(i = {}) {
  const errors = [];
  if (!i.supplier || !String(i.supplier).trim()) errors.push("Enter the supplier");
  const amount = Number(i.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Enter an amount greater than zero");
  if (!(Number(i.budget_id) > 0)) errors.push("Assign the spend to a budget");
  return errors;
}

// Total + count across a set of card-spend rows.
export function cardSpendTotals(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  for (const r of list) total += Number(r.amount) || 0;
  return { total: round2(total), count: list.length };
}
