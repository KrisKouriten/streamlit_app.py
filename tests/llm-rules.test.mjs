import test from "node:test";
import assert from "node:assert/strict";
import { buildCommentaryPrompt, COMMENTARY_SYSTEM } from "../lib/llm-rules.js";

const FIGURES = {
  period: { from: "2026-01-01", to: "2026-06-30" },
  dataAsOf: "2026-06-30",
  storeCount: 12,
  comparableStores: 10,
  totals: { cyNet: 1234567, pyNet: 1100000, yoyPct: 0.1223 },
  footfallYoyPct: -0.05,
  movers: {
    up: [{ name: "Oxford Street", yoyPct: 0.21, cyNet: 300000 }],
    down: [{ name: "Luton", yoyPct: -0.14, cyNet: 80000 }],
  },
};

test("system prompt carries the guardrails and house style", () => {
  assert.match(COMMENTARY_SYSTEM, /Miniso UK/);
  assert.match(COMMENTARY_SYSTEM, /ONLY the figures/);
  assert.match(COMMENTARY_SYSTEM, /draft for human review/i);
});

test("user prompt renders the supplied figures in GBP/% and lists movers", () => {
  const { system, user } = buildCommentaryPrompt(FIGURES);
  assert.equal(system, COMMENTARY_SYSTEM);
  assert.match(user, /£1,234,567/);          // cy net sales, rounded + grouped
  assert.match(user, /£1,100,000/);          // py net sales
  assert.match(user, /12\.2% year on year/); // yoy pct
  assert.match(user, /Footfall YTD year on year: -5\.0%/);
  assert.match(user, /Oxford Street 21\.0% \(£300,000\)/);
  assert.match(user, /Luton -14\.0% \(£80,000\)/);
  assert.match(user, /2026-01-01 to 2026-06-30/);
});

test("missing/empty figures degrade to 'n/a' and omit absent sections", () => {
  const { user } = buildCommentaryPrompt({ period: { from: "2026-01-01", to: "2026-03-31" }, totals: {} });
  assert.match(user, /n\/a year on year/);        // no pyNet → yoy n/a
  assert.doesNotMatch(user, /Footfall YTD/);      // omitted when null
  assert.doesNotMatch(user, /Strongest year-on-year/); // no movers
});

test("null figures object does not throw", () => {
  const { system, user } = buildCommentaryPrompt(null);
  assert.equal(system, COMMENTARY_SYSTEM);
  assert.match(user, /Write the weekly trading commentary/);
});
