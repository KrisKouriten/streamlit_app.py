import test from "node:test";
import assert from "node:assert/strict";
import { statusFor, summarise, DIMENSIONS } from "../lib/masterdata-rules.js";

test("statusFor: managed when data + screen, live when data only, awaiting when empty", () => {
  assert.deepEqual(statusFor({ count: 26, screen: "/govern/entities" }), { label: "MANAGED", tone: "green" });
  assert.deepEqual(statusFor({ count: 8, screen: null }), { label: "LIVE", tone: "accent" });
  assert.deepEqual(statusFor({ count: 0, screen: null }), { label: "AWAITING FEED", tone: "faint" });
  assert.deepEqual(statusFor({ count: 0, screen: "/x" }), { label: "AWAITING FEED", tone: "faint" });
});

test("summarise rolls up the three states", () => {
  const rows = [
    { status: statusFor({ count: 26, screen: "/a" }) },
    { status: statusFor({ count: 10, screen: "/b" }) },
    { status: statusFor({ count: 8, screen: null }) },
    { status: statusFor({ count: 0, screen: null }) },
  ];
  assert.deepEqual(summarise(rows), { total: 4, managed: 2, live: 1, awaiting: 1 });
});

test("catalogue includes the managed dimensions with screens", () => {
  const entities = DIMENSIONS.find((d) => d.key === "entities");
  const kpis = DIMENSIONS.find((d) => d.key === "kpis");
  assert.equal(entities.screen, "/govern/entities");
  assert.equal(kpis.screen, "/govern/kpi-definitions");
  assert.equal(kpis.objectType, "dim_kpi");
});
