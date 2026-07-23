import test from "node:test";
import assert from "node:assert/strict";
import { resolveEntityMap } from "../lib/entity-map-rules.js";

const SEED = { "Co A": "id-a", "Co B": "id-b" };

test("no table → the seed constant, unchanged", () => {
  assert.deepEqual(resolveEntityMap(SEED, null, false), SEED);
  assert.deepEqual(resolveEntityMap(SEED, [], false), SEED);
});

test("empty table → the seed constant", () => {
  assert.deepEqual(resolveEntityMap(SEED, [], true), SEED);
});

test("populated table is the source of truth (overrides + adds)", () => {
  const rows = [
    { entity_name: "Co A", joiin_id: "id-a2", active: true }, // override
    { entity_name: "Co B", joiin_id: "id-b", active: true },
    { entity_name: "Co C", joiin_id: "id-c", active: true }, // new
  ];
  assert.deepEqual(resolveEntityMap(SEED, rows, true), { "Co A": "id-a2", "Co B": "id-b", "Co C": "id-c" });
});

test("inactive rows are excluded (a company can be retired)", () => {
  const rows = [
    { entity_name: "Co A", joiin_id: "id-a", active: true },
    { entity_name: "Co B", joiin_id: "id-b", active: false },
  ];
  assert.deepEqual(resolveEntityMap(SEED, rows, true), { "Co A": "id-a" });
});

test("rows missing a joiin_id are skipped", () => {
  const rows = [
    { entity_name: "Co A", joiin_id: "id-a", active: true },
    { entity_name: "Co B", joiin_id: null, active: true },
  ];
  assert.deepEqual(resolveEntityMap(SEED, rows, true), { "Co A": "id-a" });
});

test("all-inactive falls back to the seed (never empty)", () => {
  const rows = [
    { entity_name: "Co A", joiin_id: "id-a", active: false },
    { entity_name: "Co B", joiin_id: "id-b", active: false },
  ];
  assert.deepEqual(resolveEntityMap(SEED, rows, true), SEED);
});
