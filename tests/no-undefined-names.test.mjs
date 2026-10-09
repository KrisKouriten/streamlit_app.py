import test from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import globals from "globals";
import react from "eslint-plugin-react";

/*
 * No page or library may use a name it never defines.
 *
 * `next build` doesn't check this, so a screen that calls a removed function, or
 * a style it forgot to declare, builds cleanly and only fails when someone opens
 * it ("This screen hit a problem"). Four had shipped: the project page's Edit
 * button, the hub hero band's money() (a re-export isn't a local name), the
 * Available OTB panel's label style, and a leftover invoice helper. This scans
 * every source file for undefined names, JSX components included, and fails
 * naming each one.
 */

const FILES = ["app/**/*.js", "lib/**/*.js", "middleware.js", "scripts/**/*.{js,mjs}"];
const RULES = ["no-undef", "react/jsx-no-undef"];

test("every name used in app/, lib/ and scripts/ is defined", { timeout: 120000 }, async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.js", "**/*.mjs"],
      plugins: { react },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { ...globals.browser, ...globals.node },
      },
      // Inline comments name rules (react-hooks/…) this scan doesn't load.
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
      rules: { "no-undef": "error", "react/jsx-no-undef": "error" },
    }],
  });
  const results = await eslint.lintFiles(FILES);
  assert.ok(results.length > 100, `expected to scan the source tree, scanned ${results.length} files`);

  const problems = results.flatMap((r) => r.messages
    .filter((m) => m.fatal || RULES.includes(m.ruleId))
    .map((m) => `${r.filePath.replace(`${process.cwd()}/`, "")}:${m.line}:${m.column}  ${m.message}`));
  assert.deepEqual(problems, [], `Undefined names:\n${problems.join("\n")}`);
});
