import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sectionKey, itemKey, itemId, isSectionVisible, isItemVisible, visibleNav, applyToggle,
} from "../lib/nav-visibility-rules.js";

const NAV = [
  { key: "home", label: "Home", items: [{ label: "Hub", href: "/finance-os/executive" }, { label: "Search", action: "palette" }] },
  { key: "operate", label: "Operate", items: [{ label: "PO Tracker", href: "/operate/po-tracker" }, { label: "WAC", slug: "wac" }] },
];

test("node keys are stable and prefer href/slug/action/label", () => {
  assert.equal(sectionKey(NAV[0]), "sec:home");
  assert.equal(itemKey(NAV[0], NAV[0].items[0]), "item:home:/finance-os/executive");
  assert.equal(itemId({ slug: "wac" }), "wac");
  assert.equal(itemId({ action: "palette" }), "palette");
  assert.equal(itemId({ label: "X" }), "X");
});

test("default (empty hidden) = everything visible", () => {
  const out = visibleNav(NAV, new Set());
  assert.equal(out.length, 2);
  assert.equal(out[0].items.length, 2);
});

test("hiding a header drops the whole section", () => {
  const hidden = new Set([sectionKey(NAV[1])]);
  assert.equal(isSectionVisible(NAV[1], hidden), false);
  const out = visibleNav(NAV, hidden);
  assert.deepEqual(out.map((s) => s.key), ["home"]);
});

test("hiding an item drops just that item; section stays if others remain", () => {
  const hidden = new Set([itemKey(NAV[1], NAV[1].items[1])]); // hide WAC
  assert.equal(isItemVisible(NAV[1], NAV[1].items[1], hidden), false);
  assert.equal(isItemVisible(NAV[1], NAV[1].items[0], hidden), true);
  const out = visibleNav(NAV, hidden);
  const op = out.find((s) => s.key === "operate");
  assert.deepEqual(op.items.map((i) => i.label), ["PO Tracker"]);
});

test("a section whose every item is hidden disappears", () => {
  const hidden = new Set([itemKey(NAV[1], NAV[1].items[0]), itemKey(NAV[1], NAV[1].items[1])]);
  const out = visibleNav(NAV, hidden);
  assert.deepEqual(out.map((s) => s.key), ["home"]);
});

test("applyToggle: unticking a header hides the whole section; re-ticking restores it fully", () => {
  let hidden = new Set([itemKey(NAV[1], NAV[1].items[1])]); // WAC hidden
  hidden = applyToggle(hidden, { kind: "section", sec: NAV[1], visible: false });
  assert.ok(hidden.has("sec:operate"));
  assert.equal(visibleNav(NAV, hidden).some((s) => s.key === "operate"), false, "section hidden");
  // re-tick header → section visible again with every item (item hides cleared)
  hidden = applyToggle(hidden, { kind: "section", sec: NAV[1], visible: true });
  assert.ok(!hidden.has("sec:operate"));
  assert.ok(!hidden.has(itemKey(NAV[1], NAV[1].items[1])), "item hides cleared on re-tick");
  assert.equal(visibleNav(NAV, hidden).find((s) => s.key === "operate").items.length, 2);
});

test("applyToggle: item toggle adds/removes just that item", () => {
  let hidden = new Set();
  hidden = applyToggle(hidden, { kind: "item", sec: NAV[0], it: NAV[0].items[1], visible: false });
  assert.deepEqual([...hidden], [itemKey(NAV[0], NAV[0].items[1])]);
  hidden = applyToggle(hidden, { kind: "item", sec: NAV[0], it: NAV[0].items[1], visible: true });
  assert.equal(hidden.size, 0);
});
