import test from "node:test";
import assert from "node:assert/strict";
import { resolveConnectionString } from "../lib/db.js";

test("prefers plain DATABASE_URL", () => {
  assert.equal(resolveConnectionString({ DATABASE_URL: "a", Finance_DATABASE_URL: "b" }), "a");
});
test("falls back to prefixed DATABASE_URL", () => {
  assert.equal(resolveConnectionString({ Finance_DATABASE_URL: "b", Finance_DATABASE_URL_UNPOOLED: "c" }), "b");
});
test("falls back to POSTGRES_URL family", () => {
  assert.equal(resolveConnectionString({ Finance_POSTGRES_URL: "d" }), "d");
});
test("returns null when nothing set", () => {
  assert.equal(resolveConnectionString({ OTHER: "x" }), null);
});
