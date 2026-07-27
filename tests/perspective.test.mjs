import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PERSPECTIVE_PAGES, isPerspectivePage } from "../lib/intelligence/perspective-pages.js";

/* The code-side Perspective manifest must stay in step with the governed
   page_context_registry seeded in migration 038 — a drift here means the button
   points at a page the orchestrator has no domains for. */

test("manifest covers exactly six governed pages", () => {
  assert.equal(PERSPECTIVE_PAGES.length, 6);
});

test("isPerspectivePage accepts seeded ids and rejects others", () => {
  for (const p of PERSPECTIVE_PAGES) assert.ok(isPerspectivePage(p.id), `${p.id} is enabled`);
  assert.equal(isPerspectivePage("procurement"), false);
  assert.equal(isPerspectivePage(""), false);
  assert.equal(isPerspectivePage(null), false);
});

test("every manifest pageId + route matches the migration 038 registry seed", () => {
  const sql = readFileSync(new URL("../db/migrations/038_intelligence.sql", import.meta.url), "utf8");
  // Pull the page_context_registry INSERT rows: ('id', 'name', 'route', ...)
  const block = sql.slice(sql.indexOf("INSERT INTO intelligence.page_context_registry"));
  for (const { id, route } of PERSPECTIVE_PAGES) {
    assert.ok(block.includes(`'${id}'`), `registry seeds page id ${id}`);
    assert.ok(block.includes(`'${route}'`), `registry seeds route ${route} for ${id}`);
  }
});

test("every manifest page has a page_relationship PRIMARY domain in migration 038", () => {
  const sql = readFileSync(new URL("../db/migrations/038_intelligence.sql", import.meta.url), "utf8");
  const rel = sql.slice(sql.indexOf("INSERT INTO intelligence.page_relationship"));
  for (const { id } of PERSPECTIVE_PAGES) {
    // e.g.  ('cash-flow', 'cash', 'PRIMARY', ...)
    const re = new RegExp(`\\('${id}',\\s*'[a-z_]+',\\s*'PRIMARY'`);
    assert.ok(re.test(rel), `${id} has a PRIMARY domain`);
  }
});
