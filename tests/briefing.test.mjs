import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BRIEFING_DOMAINS, deriveBriefingTitle } from "../lib/intelligence/briefing-rules.js";
import { BUDDY_DOMAINS } from "../lib/intelligence/domain-select.js";

test("briefing draws only on real governed retrieval domains", () => {
  assert.ok(BRIEFING_DOMAINS.length >= 3);
  for (const d of BRIEFING_DOMAINS) assert.ok(BUDDY_DOMAINS.includes(d), `${d} is a real retrieval domain`);
});

test("deriveBriefingTitle is deterministic and UK-formatted (UTC)", () => {
  // 2026-07-27 is a Monday.
  assert.equal(deriveBriefingTitle("EXEC", new Date("2026-07-27T09:00:00Z")), "Finance brief — Mon 27 Jul 2026");
  // Single-digit day is zero-padded.
  assert.equal(deriveBriefingTitle("EXEC", new Date("2026-01-05T00:00:00Z")), "Finance brief — Mon 05 Jan 2026");
});

test("deriveBriefingTitle defaults gracefully", () => {
  const t = deriveBriefingTitle(undefined, new Date("2026-12-25T12:00:00Z"));
  assert.ok(t.startsWith("Finance brief — "));
  assert.ok(t.endsWith(" 2026"));
});

test("migration 041 seeds the BRIEFING model config and prompt", () => {
  const sql = readFileSync(new URL("../db/migrations/041_intelligence_briefing.sql", import.meta.url), "utf8");
  assert.ok(/'BRIEFING'/.test(sql), "BRIEFING use_case seeded");
  assert.ok(/'BRIEFING_V1'/.test(sql), "BRIEFING_V1 prompt seeded");
  assert.ok(/CREATE TABLE IF NOT EXISTS intelligence\.briefing/.test(sql), "briefing table created");
  // Idempotency guards present (learned from the 040 fix).
  assert.ok(/WHERE NOT EXISTS/.test(sql), "model_configuration insert guarded");
  assert.ok(/ON CONFLICT \(prompt_code, version\) DO NOTHING/.test(sql), "prompt insert guarded");
});
