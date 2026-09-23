import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * Every hook a screen calls is imported.
 *
 * WHY THIS EXISTS. A hook used without being imported is an undefined variable,
 * and nothing in the toolchain catches one: the bundler resolves imports, not
 * bare names, so `next build` passes and the screen throws "useEffect is not
 * defined" the first time the component renders. Procurement Summary + Close
 * went down that way — the trade-pay reference field called useEffect, and the
 * whole desk died as soon as any purchase on the open tab was marked paid by
 * trade pay. Management Accounts had the same fault with useState, waiting for
 * the first actuals upload.
 *
 * This reads the source rather than rendering it, so it covers components that
 * only appear in a particular data state — which is exactly the kind a manual
 * check of the page misses.
 */

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

// Names a file brings in by import, including `a as b` (counted as b).
function importedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+["'][^"']+["']/g)) {
    for (const group of m[1].matchAll(/\{([^}]*)\}/g)) {
      for (let n of group[1].split(",")) {
        n = n.trim();
        if (!n) continue;
        names.add(n.includes(" as ") ? n.split(" as ")[1].trim() : n);
      }
    }
  }
  return names;
}

// A bare hook call — `useX(` not preceded by a dot, so React.useState and
// obj.useThing are left alone — whose name the file never imports or defines.
export function unimportedHooks(src) {
  const imported = importedNames(src);
  const declared = new Set([...src.matchAll(/\b(?:function|const|let|var)\s+(use[A-Z]\w*)/g)].map((m) => m[1]));
  const missing = [];
  for (const m of src.matchAll(/(?<![\w$.])(use[A-Z]\w*)\s*\(/g)) {
    const name = m[1];
    if (imported.has(name) || declared.has(name)) continue;
    missing.push({ name, line: src.slice(0, m.index).split("\n").length });
  }
  return missing;
}

test("the detector catches a hook that is called but not imported", () => {
  const src = `"use client";\nimport { useState } from "react";\nfunction A() { const [a] = useState(0); useEffect(() => {}, []); }`;
  assert.deepEqual(unimportedHooks(src), [{ name: "useEffect", line: 3 }]);
});

test("the detector accepts React.useX, aliases and locally defined hooks", () => {
  const src = `import React, { useMemo as memo, useRef } from "react";
function useThing() { return useRef(null); }
function A() { React.useState(0); memo(() => 1, []); useThing(); }`;
  assert.deepEqual(unimportedHooks(src), []);
});

test("every hook called in app/ is imported or defined in its file", () => {
  const faults = [];
  for (const file of jsFiles("app")) {
    for (const { name, line } of unimportedHooks(readFileSync(file, "utf8"))) {
      faults.push(`${file}:${line}  ${name}() is called but not imported`);
    }
  }
  assert.deepEqual(faults, []);
});
