import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, groupByCategory, groupByMonth, validateCost, summariseProjectCosts } from "../lib/business-projects-rules.js";

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

test("validateCost: valid line strips £/commas and trims", () => {
  const { errors, clean } = validateCost({ business_project_id: "7", department: " Marketing ", cost_line: " Agency retainer ", amount: "£12,500.50", notes: " q1 " });
  assert.deepEqual(errors, []);
  assert.equal(clean.id, null);
  assert.equal(clean.business_project_id, 7);
  assert.equal(clean.department, "Marketing");
  assert.equal(clean.cost_line, "Agency retainer");
  assert.equal(clean.amount, 12500.5);
  assert.equal(clean.notes, "q1");
});

test("validateCost: missing project errors, blank fields → null, amount defaults 0", () => {
  const { errors, clean } = validateCost({ amount: "" });
  assert.ok(errors.some((e) => /business project/i.test(e)));
  assert.equal(clean.business_project_id, null);
  assert.equal(clean.department, null);
  assert.equal(clean.cost_line, null);
  assert.equal(clean.amount, 0);
});

test("validateCost: bad amount errors", () => {
  const { errors } = validateCost({ business_project_id: 3, amount: "abc" });
  assert.ok(errors.some((e) => /amount/i.test(e)));
});

test("summariseProjectCosts: per-department merge, totals and variance", () => {
  const costs = [
    { department: "Marketing", amount: 10000 },
    { department: "Marketing", amount: 5000 },   // planned-only dept (with actual too below)
    { department: "IT", amount: 8000 },          // planned-only dept
    { department: null, amount: 2000 },          // → Unassigned
  ];
  const actuals = [
    { department: "Marketing", actual: 12000 },  // both planned + actual
    { department: "Logistics", actual: 3000 },   // actual-only dept
  ];
  const { byDept, totals } = summariseProjectCosts(costs, actuals, 40000);

  // sorted alphabetically by department
  assert.deepEqual(byDept.map((d) => d.department), ["IT", "Logistics", "Marketing", "Unassigned"]);

  const it = byDept.find((d) => d.department === "IT");
  assert.equal(it.planned, 8000);
  assert.equal(it.actual, 0);
  assert.equal(it.variance, 8000);

  const log = byDept.find((d) => d.department === "Logistics");
  assert.equal(log.planned, 0);
  assert.equal(log.actual, 3000);
  assert.equal(log.variance, -3000);

  const mkt = byDept.find((d) => d.department === "Marketing");
  assert.equal(mkt.planned, 15000);
  assert.equal(mkt.actual, 12000);
  assert.equal(mkt.variance, 3000);

  assert.equal(totals.budget, 40000);
  assert.equal(totals.planned, 25000); // 15000 + 8000 + 2000
  assert.equal(totals.actual, 15000);  // 12000 + 3000
  assert.equal(totals.variance, 10000);
});

test("summariseProjectCosts: empty input is safe", () => {
  const { byDept, totals } = summariseProjectCosts();
  assert.deepEqual(byDept, []);
  assert.equal(totals.planned, 0);
  assert.equal(totals.actual, 0);
  assert.equal(totals.variance, 0);
  assert.equal(totals.budget, null);
});
