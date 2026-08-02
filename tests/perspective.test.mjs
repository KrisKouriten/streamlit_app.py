import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PERSPECTIVE_PAGES, isPerspectivePage } from "../lib/intelligence/perspective-pages.js";
import { BUDDY_DOMAINS } from "../lib/intelligence/domain-select.js";

// The Perspective manifest must stay in step with the governed
// page_context_registry seeds (migration 038 for Phase 3, 040 for Phase 4,
// 071 for Pricing / Scenario / Capex) — a drift means the button points at a
// page the orchestrator has no domains for.
const seedSql =
  readFileSync(new URL("../db/migrations/038_intelligence.sql", import.meta.url), "utf8") +
  readFileSync(new URL("../db/migrations/040_intelligence_pages.sql", import.meta.url), "utf8") +
  readFileSync(new URL("../db/migrations/071_pricing_capex_intelligence.sql", import.meta.url), "utf8");

test("manifest covers all sixteen governed pages", () => {
  assert.equal(PERSPECTIVE_PAGES.length, 16);
});

test("isPerspectivePage accepts seeded ids and rejects others", () => {
  for (const p of PERSPECTIVE_PAGES) assert.ok(isPerspectivePage(p.id), `${p.id} is enabled`);
  assert.equal(isPerspectivePage("franchise"), false);
  assert.equal(isPerspectivePage(""), false);
  assert.equal(isPerspectivePage(null), false);
});

test("every manifest pageId + route is seeded in the registry migrations", () => {
  const block = seedSql; // both registry INSERTs live in these files
  for (const { id, route } of PERSPECTIVE_PAGES) {
    assert.ok(block.includes(`'${id}'`), `registry seeds page id ${id}`);
    assert.ok(block.includes(`'${route}'`), `registry seeds route ${route} for ${id}`);
  }
});

test("every manifest page has a page_relationship PRIMARY domain", () => {
  for (const { id } of PERSPECTIVE_PAGES) {
    const re = new RegExp(`\\('${id}',\\s*'[a-z_]+',\\s*'PRIMARY'`);
    assert.ok(re.test(seedSql), `${id} has a PRIMARY domain`);
  }
});

test("each PRIMARY domain in the seeds is a governed retrieval domain", () => {
  // BUDDY_DOMAINS mirrors the retrieval.js DOMAIN_FETCHERS keys (pure, no DB
  // import) — a PRIMARY domain outside it would retrieve nothing.
  const primaryRe = /\('[a-z-]+',\s*'([a-z_]+)',\s*'PRIMARY'/g;
  let m;
  while ((m = primaryRe.exec(seedSql))) {
    assert.ok(BUDDY_DOMAINS.includes(m[1]), `PRIMARY domain ${m[1]} is a real retrieval domain`);
  }
});
