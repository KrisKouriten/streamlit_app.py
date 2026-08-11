import { test } from "node:test";
import assert from "node:assert/strict";
import { fact } from "../lib/intelligence/fact.js";

// Postgres returns SUM()/numeric columns as strings. fact() must coerce them so
// a real figure is not nulled out and rendered to the model as £0.
test("fact() coerces a Postgres numeric string to a number", () => {
  const f = fact("YTD net sales", "21000000.00");
  assert.equal(f.value, 21000000);
});

test("fact() keeps genuine numbers untouched", () => {
  assert.equal(fact("Lines", 6, "count").value, 6);
  assert.equal(fact("Margin", 62.2, "%").value, 62.2);
  assert.equal(fact("Zero", "0").value, 0);
});

test("fact() nulls a non-numeric string (no silent £0 from bad data)", () => {
  assert.equal(fact("Bad", "n/a").value, null);
  assert.equal(fact("Nullish", null).value, null);
});
