import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, groupByCategory, groupByMonth } from "../lib/business-projects-rules.js";

const SAMPLE = [
  { name: "A", category: "Systems", status: "Active", rag: "green", target_ym: "2026-03", budget: 100000 },
  { name: "B", category: "Systems", status: "Planned", rag: "amber", target_ym: "2026-03", budget: 50000 },
  { name: "C", category: "Stores", status: "Active", rag: "red", target_ym: "2026-06", budget: 200000 },
  { name: "D", category: "Stores", status: "Done", rag: "green", target_ym: "2026-01", budget: 999999 }, // delivered → excluded from committed
  { name: "E", category: null, status: "Active", rag: "green", target_ym: null, budget: null },        // uncategorised, no month, no budget
];

test("summarise: counts, RAG and committed budget exclude Done", () => {
  const s = summarise(SAMPLE);
  assert.equal(s.total, 5);
  assert.equal(s.active, 3);
  assert.equal(s.atRisk, 1);
  assert.equal(s.budget, 350000); // 100k + 50k + 200k; D (Done) excluded, E null
});

test("groupByCategory: buckets, counts and committed £, richest first", () => {
  const g = groupByCategory(SAMPLE);
  assert.deepEqual(g.map((x) => x.category), ["Stores", "Systems", "Uncategorised"]);
  const stores = g.find((x) => x.category === "Stores");
  assert.equal(stores.count, 2);       // C + D
  assert.equal(stores.budget, 200000); // D (Done) excluded
  const sys = g.find((x) => x.category === "Systems");
  assert.equal(sys.budget, 150000);
  assert.equal(g.find((x) => x.category === "Uncategorised").budget, 0);
});

test("groupByMonth: only projects with a target month, earliest first, Done excluded from £", () => {
  const g = groupByMonth(SAMPLE);
  assert.deepEqual(g.map((x) => x.ym), ["2026-01", "2026-03", "2026-06"]);
  assert.equal(g.find((x) => x.ym === "2026-01").budget, 0); // only D (Done)
  assert.equal(g.find((x) => x.ym === "2026-03").budget, 150000);
  assert.equal(g.find((x) => x.ym === "2026-06").count, 1);
});

test("empty input is safe", () => {
  assert.deepEqual(groupByCategory([]), []);
  assert.deepEqual(groupByMonth([]), []);
  assert.equal(summarise([]).budget, 0);
});
