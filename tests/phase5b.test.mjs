import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COMMENTARY_SUBJECTS, isCommentarySubject, domainsForSubject, deriveCommentaryTitle } from "../lib/intelligence/commentary-rules.js";
import { summariseRealisation } from "../lib/intelligence/benefit-rules.js";
import { BUDDY_DOMAINS } from "../lib/intelligence/domain-select.js";

// ---------------------------------------------------------------- commentary
test("every commentary subject maps to real governed retrieval domains", () => {
  for (const [subject, def] of Object.entries(COMMENTARY_SUBJECTS)) {
    assert.ok(def.domains.length >= 1, `${subject} has domains`);
    for (const d of def.domains) assert.ok(BUDDY_DOMAINS.includes(d), `${subject}: ${d} is a real domain`);
  }
});

test("isCommentarySubject / domainsForSubject guard unknown subjects", () => {
  assert.equal(isCommentarySubject("MANAGEMENT_ACCOUNTS"), true);
  assert.equal(isCommentarySubject("NONSENSE"), false);
  assert.deepEqual(domainsForSubject("NONSENSE"), []);
});

test("deriveCommentaryTitle is deterministic and UK-formatted", () => {
  assert.equal(deriveCommentaryTitle("CASH", new Date("2026-07-27T09:00:00Z")), "Cash flow commentary — Jul 2026");
  assert.equal(deriveCommentaryTitle("BOARD", new Date("2026-01-31T00:00:00Z")), "Board pack commentary — Jan 2026");
});

// ---------------------------------------------------------------- benefit realisation
test("summariseRealisation totals, funnel and rates", () => {
  const rows = [
    { status: "PROPOSED", expected_value_gbp: 100000, latest_measured: null, validated_value: null, validation_decision: null },
    { status: "REALISED", expected_value_gbp: 200000, latest_measured: 150000, validated_value: null, validation_decision: null },
    { status: "VALIDATED", expected_value_gbp: 100000, latest_measured: 90000, validated_value: 90000, validation_decision: "VALIDATED" },
  ];
  const s = summariseRealisation(rows);
  assert.equal(s.count, 3);
  assert.equal(s.expectedTotal, 400000);
  assert.equal(s.realisedTotal, 240000);   // 150k + 90k
  assert.equal(s.validatedTotal, 90000);    // only the VALIDATED row
  assert.equal(s.funnel.PROPOSED, 1);
  assert.equal(s.funnel.REALISED, 1);
  assert.equal(s.funnel.VALIDATED, 1);
  assert.equal(s.realisationRate, 0.6);     // 240k / 400k
  assert.equal(s.validationRate, 0.225);    // 90k / 400k
});

test("summariseRealisation handles empty and null-heavy input safely", () => {
  const empty = summariseRealisation([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.realisationRate, 0);   // no divide-by-zero
  const nulls = summariseRealisation([{ status: "PROPOSED", expected_value_gbp: null, latest_measured: null, validated_value: null, validation_decision: null }]);
  assert.equal(nulls.expectedTotal, 0);
  assert.equal(nulls.realisationRate, 0);
});

// ---------------------------------------------------------------- migrations
test("migration 042 seeds commentary table, model config and prompt (idempotent)", () => {
  const sql = readFileSync(new URL("../db/migrations/042_intelligence_commentary.sql", import.meta.url), "utf8");
  assert.ok(/CREATE TABLE IF NOT EXISTS intelligence\.commentary/.test(sql));
  assert.ok(/'COMMENTARY'/.test(sql) && /'COMMENTARY_V1'/.test(sql));
  assert.ok(/WHERE NOT EXISTS/.test(sql), "model_configuration insert guarded");
  assert.ok(/ON CONFLICT \(prompt_code, version\) DO NOTHING/.test(sql), "prompt insert guarded");
});

test("migration 043 adds AI attribution columns idempotently", () => {
  const sql = readFileSync(new URL("../db/migrations/043_benefit_ai_attribution.sql", import.meta.url), "utf8");
  assert.ok(/ADD COLUMN IF NOT EXISTS ai_run_id/.test(sql));
  assert.ok(/ADD COLUMN IF NOT EXISTS origin_surface/.test(sql));
});
