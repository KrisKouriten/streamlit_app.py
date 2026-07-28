import { test } from "node:test";
import assert from "node:assert/strict";
import { pushRecent, isFavourite, toggleFavourite } from "../lib/recent-rules.js";

const A = { href: "/a", label: "A" }, B = { href: "/b", label: "B" }, C = { href: "/c", label: "C" };

test("pushRecent puts newest first, de-dupes by href, caps", () => {
  let l = [];
  l = pushRecent(l, A); l = pushRecent(l, B); l = pushRecent(l, C);
  assert.deepEqual(l.map((e) => e.href), ["/c", "/b", "/a"]);
  // revisiting A moves it to front without duplicating
  l = pushRecent(l, { href: "/a", label: "A" });
  assert.deepEqual(l.map((e) => e.href), ["/a", "/c", "/b"]);
  // cap
  const capped = pushRecent(pushRecent(pushRecent(pushRecent([], A, 2), B, 2), C, 2), A, 2);
  assert.equal(capped.length, 2);
});

test("pushRecent ignores entries without an href", () => {
  assert.deepEqual(pushRecent([A], {}), [A]);
  assert.deepEqual(pushRecent([A], null), [A]);
});

test("toggleFavourite adds then removes; isFavourite reflects it", () => {
  let f = [];
  f = toggleFavourite(f, A);
  assert.equal(isFavourite(f, "/a"), true);
  f = toggleFavourite(f, B);
  assert.deepEqual(f.map((e) => e.href), ["/a", "/b"]);
  f = toggleFavourite(f, A); // unpin
  assert.equal(isFavourite(f, "/a"), false);
  assert.deepEqual(f.map((e) => e.href), ["/b"]);
});

test("labels default to href when missing", () => {
  const l = pushRecent([], { href: "/x" });
  assert.equal(l[0].label, "/x");
});
