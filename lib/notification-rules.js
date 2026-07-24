/* Pure notification helpers — no imports, no clock of their own (the caller
 * passes `now`), unit-testable. Formatting and counting only; the DB layer and
 * API do the reads/writes. */

// Compact relative-time label, e.g. "just now", "5m ago", "3d ago", "2w ago".
export function relativeTime(fromMs, nowMs) {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

// Unread count from a loaded list (a notification is unread when read_at is null).
export function unreadCount(list) {
  return (list || []).filter((n) => !n.read_at).length;
}

// Badge text for the bell: "" when none, the number up to 9, then "9+".
export function badgeLabel(count) {
  if (!count || count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

// Extract @mention tokens from free text. A token is @ followed by 2–40 of
// [letters digits . _ -] (e.g. @kris, @kris.k, @finance-team), not preceded by
// a word char (so emails don't match). Returns unique lowercased tokens, no @.
export function extractMentions(text) {
  const out = [];
  const seen = new Set();
  const re = /(?:^|[^\w@])@([a-z0-9._-]{2,40})/gi;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const tok = m[1].toLowerCase().replace(/[._-]+$/, "");
    if (tok && !seen.has(tok)) { seen.add(tok); out.push(tok); }
  }
  return out;
}

// Match mention tokens to users. A user matches when a token equals (case-
// insensitive) their email local-part, full name, first name, or name with
// spaces removed. Pure — the caller supplies the candidate user list. Returns
// the matched user objects, deduped by id.
export function resolveMentions(tokens, users) {
  const set = new Set((tokens || []).map((t) => String(t).toLowerCase()));
  if (!set.size) return [];
  const matched = [];
  const seen = new Set();
  for (const u of users || []) {
    const name = String(u.name || "").toLowerCase();
    const local = String(u.email || "").split("@")[0].toLowerCase();
    const keys = [local, name, name.split(/\s+/)[0], name.replace(/\s+/g, "")].filter(Boolean);
    if (!seen.has(u.id) && keys.some((k) => set.has(k))) { seen.add(u.id); matched.push(u); }
  }
  return matched;
}
