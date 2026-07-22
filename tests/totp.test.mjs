import test from "node:test";
import assert from "node:assert/strict";
import { base32Encode, base32Decode, hotp, totp, verifyTotp, normalizeCode, timeStep, otpauthUri } from "../lib/totp-rules.js";

// RFC 4648 base32 of the ASCII seed used in the RFC test vectors.
const SEED_ASCII = "12345678901234567890";
const SEED_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 decodes the RFC seed to its ASCII bytes", () => {
  assert.equal(base32Decode(SEED_B32).toString("ascii"), SEED_ASCII);
});

test("base32 round-trips arbitrary bytes", () => {
  for (const s of ["", "a", "ab", "abc", "abcd", "abcde", "hello world"]) {
    const bytes = Buffer.from(s);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes, `round-trip ${JSON.stringify(s)}`);
  }
});

test("base32Decode ignores spaces, dashes and padding", () => {
  assert.equal(base32Decode(SEED_B32.toLowerCase()).toString("ascii"), SEED_ASCII);
  assert.equal(base32Decode("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ").toString("ascii"), SEED_ASCII);
});

// RFC 4226 HOTP test vectors (seed "12345678901234567890", counters 0..9).
test("HOTP matches the RFC 4226 vectors", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  const key = Buffer.from(SEED_ASCII, "ascii");
  expected.forEach((code, counter) => assert.equal(hotp(key, counter, 6), code, `counter ${counter}`));
});

// RFC 6238 TOTP test vectors (SHA1), reduced to the 6-digit truncation.
test("TOTP matches the RFC 6238 vectors (SHA1, 6 digits)", () => {
  const cases = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [t, code] of cases) assert.equal(totp(SEED_B32, t, {}), code, `T=${t}`);
});

test("verifyTotp accepts the current code and reports its step", () => {
  const t = 1111111111;
  const r = verifyTotp(SEED_B32, "050471", t, {});
  assert.equal(r.ok, true);
  assert.equal(r.step, timeStep(t));
});

test("verifyTotp allows ±1 step of drift but not more", () => {
  const t = 1111111111; // step S
  // The code from the previous step (T=1111111081 → step S-1) is 050471's neighbour.
  const prev = totp(SEED_B32, t - 30, {});
  const next = totp(SEED_B32, t + 30, {});
  const far = totp(SEED_B32, t + 90, {});
  assert.equal(verifyTotp(SEED_B32, prev, t, { window: 1 }).ok, true);
  assert.equal(verifyTotp(SEED_B32, next, t, { window: 1 }).ok, true);
  assert.equal(verifyTotp(SEED_B32, far, t, { window: 1 }).ok, false);
});

test("verifyTotp refuses replay at or below lastStep", () => {
  const t = 1111111111;
  const step = timeStep(t);
  // Same valid code, but lastStep already at this step → refused.
  assert.equal(verifyTotp(SEED_B32, "050471", t, { lastStep: step }).ok, false);
  // A code from a step beyond lastStep is still accepted.
  assert.equal(verifyTotp(SEED_B32, "050471", t, { lastStep: step - 1 }).ok, true);
});

test("verifyTotp rejects malformed input", () => {
  for (const bad of ["", "12345", "1234567", "abcdef", null, undefined]) {
    assert.equal(verifyTotp(SEED_B32, bad, 1111111111, {}).ok, false);
  }
});

test("normalizeCode strips spaces and dashes", () => {
  assert.equal(normalizeCode(" 050 471 "), "050471");
  assert.equal(normalizeCode("050-471"), "050471");
});

test("otpauthUri embeds the secret, issuer and account", () => {
  const uri = otpauthUri({ secret: SEED_B32, account: "kris@kouriten.com" });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, new RegExp(`secret=${SEED_B32}`));
  assert.match(uri, /issuer=Miniso\+UK\+Finance\+OS/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
