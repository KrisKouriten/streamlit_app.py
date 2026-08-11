// A governed fact: { label, value(number|null), unit, display }. The value drives
// claim validation, so it must be a real number or null — never a string.
//
// Postgres returns SUM()/numeric columns as strings ("21000000.00"), so coerce
// before the finiteness check. Without this, a real figure fails Number.isFinite,
// is nulled out, and the model is handed £0 (Number(null) === 0) instead of the
// actual number — which is exactly how the AI Perspective reported £0 for real
// store sales.
export function fact(label, value, unit = "£", display = null) {
  const n = typeof value === "string" ? Number(value) : value;
  return { label, value: Number.isFinite(n) ? n : null, unit, display: display ?? null };
}
