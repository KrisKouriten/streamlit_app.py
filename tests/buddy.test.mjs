import { test } from "node:test";
import assert from "node:assert/strict";

import { selectDomains, BUDDY_DOMAINS } from "../lib/intelligence/domain-select.js";
import { deriveConversationTitle } from "../lib/intelligence/conversation-rules.js";

/* ---------------- domain-select (Buddy has no page → picks from the question) ---------------- */

test("a cash question selects the cash domain as primary", () => {
  const r = selectDomains("What's our cash position and liquidity headroom?");
  assert.equal(r.primary[0], "cash");
});

test("an inventory question selects the inventory domain", () => {
  const r = selectDomains("Which SKUs are dormant and how much stock is slow-moving?");
  assert.equal(r.primary[0], "inventory");
});

test("a store KPI question selects store_performance", () => {
  const r = selectDomains("Which stores are weak on conversion and basket size?");
  assert.equal(r.primary[0], "store_performance");
});

test("a variance question selects management_accounts", () => {
  const r = selectDomains("Where is the biggest variance to forecast this month?");
  assert.equal(r.primary[0], "management_accounts");
});

test("an unrecognised question falls back to the consolidated snapshot, never empty", () => {
  const r = selectDomains("Tell me something interesting.");
  assert.deepEqual(r.primary, ["finance_snapshot"]);
  assert.deepEqual(r.related, []);
});

test("a multi-topic question keeps the most specific as primary and the rest as related", () => {
  const r = selectDomains("How is revenue doing and what about cash and inventory?");
  // cash is the most specific match (ordered first in SIGNALS) → primary.
  assert.equal(r.primary[0], "cash");
  assert.ok(r.related.includes("inventory"));
  assert.ok(r.related.includes("finance_snapshot"));
  // primary is never duplicated in related.
  assert.ok(!r.related.includes(r.primary[0]));
});

test("only ever returns real retrieval domains", () => {
  const r = selectDomains("cash inventory stores variance revenue margins everything");
  for (const d of [...r.primary, ...r.related]) assert.ok(BUDDY_DOMAINS.includes(d), `${d} is a real domain`);
});

/* ---------------- conversation title derivation (pure) ---------------- */

test("title derives from the first question, trimming the trailing ?", () => {
  assert.equal(deriveConversationTitle("What is our gross margin?"), "What is our gross margin");
});

test("title collapses whitespace and is bounded", () => {
  const long = "Explain " + "the variance ".repeat(20);
  const title = deriveConversationTitle(long);
  assert.ok(title.length <= 74, `title ${title.length} chars`);
  assert.ok(title.endsWith("…"));
  assert.ok(!/\s{2,}/.test(title));
});

test("empty question yields a sensible default", () => {
  assert.equal(deriveConversationTitle("   "), "New conversation");
  assert.equal(deriveConversationTitle(""), "New conversation");
});
