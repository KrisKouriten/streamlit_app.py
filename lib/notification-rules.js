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
