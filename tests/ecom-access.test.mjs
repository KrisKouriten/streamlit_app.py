import { test } from "node:test";
import assert from "node:assert/strict";
import { ecomGate, canSeeEcom, isEcomOnly, ecomHiddenNav, ECOM_HOME } from "../lib/ecom-access.js";
import { NAV_SECTIONS } from "../lib/nav-registry.js";

test("an ECOM user is kept to HO-ECOM", () => {
  const r = ["ECOM"];
  assert.equal(isEcomOnly(r), true);
  for (const p of ["/ho-ecom", "/ho-ecom/trading", "/ho-ecom/pnl", "/section/ho-ecom", "/account/security", "/change-password", "/api/auth/logout", "/api/notifications"]) {
    assert.equal(ecomGate(p, r), null, p);
  }
  assert.deepEqual(ecomGate("/", r), { redirect: ECOM_HOME });
  assert.deepEqual(ecomGate("/finance-os/store-sales", r), { redirect: ECOM_HOME });
  assert.deepEqual(ecomGate("/operate/procurement", r), { redirect: ECOM_HOME });
  assert.deepEqual(ecomGate("/api/procurement", r), { forbid: true });
  // A prefix that only looks like HO-ECOM is not it.
  assert.deepEqual(ecomGate("/ho-ecommerce-admin", r), { redirect: ECOM_HOME });
});

test("Finance, Exec and Admin see HO-ECOM and everything else; others don't see HO-ECOM", () => {
  for (const r of [["FINANCE"], ["EXEC"], ["ADMIN"], ["ADMIN", "ECOM"]]) {
    assert.equal(canSeeEcom(r), true);
    assert.equal(ecomGate("/ho-ecom", r), null);
    assert.equal(ecomGate("/finance-os/store-sales", r), null);
  }
  assert.equal(isEcomOnly(["FINANCE", "ECOM"]), false);
  for (const r of [["OPS"], ["HEAD"], ["FRANCHISEE"], []]) {
    assert.deepEqual(ecomGate("/ho-ecom/pnl", r), { redirect: "/" });
    assert.deepEqual(ecomGate("/api/ecom/x", r), { forbid: true });
    assert.equal(ecomGate("/operate/po-tracker", r), null);
  }
});

test("sidebar: ECOM users see only HO-ECOM; those who can't see it lose it", () => {
  const onlyEcom = new Set(ecomHiddenNav(NAV_SECTIONS, ["ECOM"]));
  assert.ok(!onlyEcom.has("sec:ho-ecom"));
  for (const s of NAV_SECTIONS) if (s.key !== "ho-ecom") assert.ok(onlyEcom.has(`sec:${s.key}`), s.key);
  const ops = ecomHiddenNav(NAV_SECTIONS, ["OPS"]);
  assert.ok(ops.includes("sec:ho-ecom"));
  assert.ok(ops.includes("item:dashboards:/ho-ecom"));
  assert.deepEqual(ecomHiddenNav(NAV_SECTIONS, ["FINANCE"]), []);
});

test("HO-ECOM is in the navigation", () => {
  const sec = NAV_SECTIONS.find((s) => s.key === "ho-ecom");
  assert.ok(sec);
  assert.deepEqual(sec.items.map((i) => i.href), ["/ho-ecom", "/ho-ecom/trading", "/ho-ecom/pnl"]);
});
