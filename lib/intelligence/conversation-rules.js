/*
 * Pure conversation helpers for Finance Buddy — no I/O, so the orchestrator and
 * the API can share them and they stay unit-testable (matching the codebase's
 * other *-rules.js modules).
 */

// Derive a short, human title from the first question. Collapses whitespace,
// strips a trailing "?", trims to ~72 chars on a word boundary, and falls back
// to a default for an empty question.
export function deriveConversationTitle(question = "") {
  const t = String(question || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
  if (!t) return "New conversation";
  if (t.length <= 72) return t;
  const cut = t.slice(0, 72);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut).trim() + "…";
}
