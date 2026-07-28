/*
 * Recently-viewed + favourites — pure helpers. No imports, no DB. These back the
 * client-side lists kept in localStorage (a personal convenience, not governed
 * state), so they're unit-tested independently of the browser. An entry is
 * { href, label }. Unit-tested in tests/recent-rules.test.mjs.
 */

const norm = (entry) => (entry && entry.href ? { href: entry.href, label: entry.label || entry.href } : null);

// Add a visit to the front, de-duplicated by href, newest-first, capped.
export function pushRecent(list, entry, cap = 8) {
  const e = norm(entry);
  if (!e) return list || [];
  const rest = (list || []).filter((x) => x && x.href !== e.href);
  return [e, ...rest].slice(0, cap);
}

export function isFavourite(list, href) {
  return (list || []).some((x) => x && x.href === href);
}

// Pin/unpin a page. Pinning appends (keeps insertion order); unpinning removes.
export function toggleFavourite(list, entry, cap = 16) {
  const e = norm(entry);
  if (!e) return list || [];
  if (isFavourite(list, e.href)) return (list || []).filter((x) => x.href !== e.href);
  return [...(list || []), e].slice(0, cap);
}
