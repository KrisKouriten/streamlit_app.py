/*
 * Confidential attribution stamp — pure, no IO. The line burned into every
 * exported file (Excel / PPTX / Word / PDF) and shown as the on-screen
 * watermark, so a leaked pack or screenshot points back to who took it.
 * `when` is a Date (server request time); tests pass a fixed Date.
 */

const two = (n) => String(n).padStart(2, "0");

// UK house style DD/MM/YYYY HH:MM from a Date (or ms / ISO string).
export function stampDate(when) {
  const d = when instanceof Date ? when : new Date(when || 0);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// "Miniso UK — Confidential · Downloaded by Jane Doe · jane@… · 15/08/2026 10:05"
export function confidentialStamp(user, when) {
  const who = (user && (user.name || user.email)) || "unknown user";
  const email = user && user.email && user.email !== who ? ` · ${user.email}` : "";
  return `Miniso UK — Confidential · Downloaded by ${who}${email} · ${stampDate(when)}`;
}

// Combine an existing status label (DRAFT / BOARD / RESTRICTED) with the stamp.
export function composeWatermark(label, user, when) {
  const stamp = confidentialStamp(user, when);
  return label ? `${label} · ${stamp}` : stamp;
}
