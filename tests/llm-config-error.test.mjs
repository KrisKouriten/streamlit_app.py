import { test } from "node:test";
import assert from "node:assert/strict";
import { generateText, generateGoverned, isLlmConfigError } from "../lib/llm.js";

// A missing/rejected key must be a *classified* config error so the agent runner
// can record it as a low-severity "commentary unavailable" note rather than a
// HIGH system fault. The missing-key path throws before any network call.
test("a missing key throws a classified LLM config error", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => generateText({ system: "s", user: "u" }),
      (e) => isLlmConfigError(e) && /ANTHROPIC_API_KEY/.test(e.message)
    );
    await assert.rejects(
      () => generateGoverned({ system: "s", user: "u" }),
      (e) => isLlmConfigError(e)
    );
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("a generic error is not classified as a config error", () => {
  assert.equal(isLlmConfigError(new Error("boom")), false);
  assert.equal(isLlmConfigError(null), false);
  assert.equal(isLlmConfigError(undefined), false);
});
