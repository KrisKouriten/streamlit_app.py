import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Every page sits in .fos-shell, whose side padding is the gap between the
// sidebar and the page. An inline padding on that wrapper replaces it — the
// page then runs straight up against the sidebar.
function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.js$/.test(n) ? [p] : [];
  });
}

test("no page overrides the page shell's side gutter", () => {
  const bad = [];
  for (const f of files(new URL("../app", import.meta.url).pathname)) {
    const src = readFileSync(f, "utf8");
    if (/className="fos-shell"\s+style=\{\{\s*padding\s*:/.test(src)) bad.push(f);
    if (/<div style=\{\{ padding: "1rem 0" \}\}>/.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, []);
});
