import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inviteTokenState,
  inviteProblemMessage,
  validateNewPassword,
  resolveBaseUrl,
  setPasswordLink,
  INVITE_TTL_HOURS,
} from "../lib/invite-rules.js";

const NOW = 1_700_000_000_000; // fixed epoch-ms for deterministic expiry tests

test("token state: missing row is invalid", () => {
  const r = inviteTokenState(null, NOW);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "missing");
});

test("token state: a used token is invalid", () => {
  const r = inviteTokenState({ used_at: new Date(NOW - 1000), expires_at: new Date(NOW + 1000) }, NOW);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "used");
});

test("token state: an expired token is invalid", () => {
  const r = inviteTokenState({ used_at: null, expires_at: new Date(NOW - 1) }, NOW);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "expired");
});

test("token state: a fresh, unused token is valid (Date or string expiry)", () => {
  assert.equal(inviteTokenState({ used_at: null, expires_at: new Date(NOW + 60_000) }, NOW).valid, true);
  assert.equal(inviteTokenState({ used_at: null, expires_at: new Date(NOW + 60_000).toISOString() }, NOW).valid, true);
});

test("problem messages differ by reason and never leak internals", () => {
  assert.match(inviteProblemMessage("used"), /already been used/i);
  assert.match(inviteProblemMessage("expired"), /expired/i);
  assert.match(inviteProblemMessage("missing"), /not valid/i);
});

test("new-password: rejects empty, short, and mismatched; accepts a good pair", () => {
  assert.equal(validateNewPassword({ next: "" }).ok, false);
  assert.equal(validateNewPassword({ next: "short" }).ok, false);
  assert.equal(validateNewPassword({ next: "longenough1", confirm: "different" }).ok, false);
  assert.deepEqual(validateNewPassword({ next: "longenough1", confirm: "longenough1" }), { ok: true });
});

test("resolveBaseUrl: APP_BASE_URL wins and is trimmed", () => {
  const url = resolveBaseUrl({ origin: "https://ignored.example", env: { APP_BASE_URL: "https://finance.kouriten.com/" } });
  assert.equal(url, "https://finance.kouriten.com");
});

test("resolveBaseUrl: falls back to request origin, then Vercel host", () => {
  assert.equal(resolveBaseUrl({ origin: "https://preview.vercel.app", env: {} }), "https://preview.vercel.app");
  assert.equal(resolveBaseUrl({ origin: null, env: { VERCEL_URL: "app.vercel.app" } }), "https://app.vercel.app");
  assert.equal(resolveBaseUrl({ origin: null, env: {} }), null);
});

test("setPasswordLink: builds a /set-password URL with an encoded token", () => {
  const link = setPasswordLink("https://finance.kouriten.com", "a b/c");
  assert.equal(link, "https://finance.kouriten.com/set-password?token=a%20b%2Fc");
});

test("INVITE_TTL_HOURS is a sane positive number", () => {
  assert.ok(INVITE_TTL_HOURS > 0 && INVITE_TTL_HOURS <= 168);
});
