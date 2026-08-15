import { test } from "node:test";
import assert from "node:assert/strict";
import { stampDate, confidentialStamp, composeWatermark } from "../lib/reporting/watermark.js";

const when = new Date(2026, 7, 15, 10, 5); // local 15 Aug 2026 10:05

test("stampDate is UK DD/MM/YYYY HH:MM", () => {
  assert.equal(stampDate(when), "15/08/2026 10:05");
  assert.match(stampDate(new Date()), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

test("confidentialStamp carries name, email and time", () => {
  const s = confidentialStamp({ name: "Jane Doe", email: "jane@miniso.uk" }, when);
  assert.match(s, /Miniso UK — Confidential/);
  assert.match(s, /Downloaded by Jane Doe/);
  assert.match(s, /jane@miniso\.uk/);
  assert.match(s, /15\/08\/2026 10:05/);
});

test("confidentialStamp falls back to email then 'unknown user'", () => {
  assert.match(confidentialStamp({ email: "x@y.z" }, when), /Downloaded by x@y\.z/);
  assert.match(confidentialStamp(null, when), /Downloaded by unknown user/);
});

test("composeWatermark prefixes a status label when present", () => {
  const withLabel = composeWatermark("BOARD", { name: "A" }, when);
  assert.match(withLabel, /^BOARD · Miniso UK — Confidential/);
  const noLabel = composeWatermark(null, { name: "A" }, when);
  assert.match(noLabel, /^Miniso UK — Confidential/);
});
