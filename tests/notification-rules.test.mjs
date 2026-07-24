import test from "node:test";
import assert from "node:assert/strict";
import { relativeTime, unreadCount, badgeLabel } from "../lib/notification-rules.js";

const NOW = 1_700_000_000_000;
const ago = (ms) => NOW - ms;
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test("relativeTime buckets by magnitude", () => {
  assert.equal(relativeTime(ago(10 * S), NOW), "just now");
  assert.equal(relativeTime(ago(5 * M), NOW), "5m ago");
  assert.equal(relativeTime(ago(3 * H), NOW), "3h ago");
  assert.equal(relativeTime(ago(2 * D), NOW), "2d ago");
  assert.equal(relativeTime(ago(14 * D), NOW), "2w ago");
  assert.equal(relativeTime(ago(90 * D), NOW), "3mo ago");
});

test("relativeTime never goes negative for a future/eq timestamp", () => {
  assert.equal(relativeTime(NOW + 5000, NOW), "just now");
});

test("unreadCount counts only rows without read_at", () => {
  const list = [{ read_at: null }, { read_at: "2026-01-01T00:00:00Z" }, { read_at: null }, {}];
  assert.equal(unreadCount(list), 3);
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount(null), 0);
});

test("badgeLabel caps at 9+ and blanks when zero", () => {
  assert.equal(badgeLabel(0), "");
  assert.equal(badgeLabel(-1), "");
  assert.equal(badgeLabel(3), "3");
  assert.equal(badgeLabel(9), "9");
  assert.equal(badgeLabel(10), "9+");
  assert.equal(badgeLabel(250), "9+");
});
