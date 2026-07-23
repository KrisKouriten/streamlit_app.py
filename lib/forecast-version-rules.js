/*
 * Forecast & budget version rules — pure, import-free, unit-tested.
 * Validation, the lifecycle state machine (DRAFT → APPROVED → ARCHIVED), the
 * prior-year month shift, and a grain-level diff between two snapshots.
 */

export const KINDS = ["BUDGET", "FORECAST"];
export const STATUSES = ["DRAFT", "APPROVED", "ARCHIVED"];

// What each action does to a version's status, and from where it is allowed.
//   approve : lock a draft as the record             DRAFT     → APPROVED
//   archive : retire a version (draft or approved)   DRAFT|APPROVED → ARCHIVED
//   delete  : discard — only a draft may be deleted; approved/archived are kept
export const VERSION_TRANSITIONS = {
  approve: { from: ["DRAFT"], to: "APPROVED" },
  archive: { from: ["DRAFT", "APPROVED"], to: "ARCHIVED" },
  delete: { from: ["DRAFT"], to: null },
};

export function validateVersion({ label, kind, fiscalYear } = {}) {
  if (!label || !String(label).trim()) return "A version needs a label";
  if (String(label).trim().length > 120) return "Label is too long (max 120)";
  if (!KINDS.includes(kind)) return "Kind must be BUDGET or FORECAST";
  if (fiscalYear != null && fiscalYear !== "" && !/^\d{4}$/.test(String(fiscalYear))) {
    return "Fiscal year must be a 4-digit year (YYYY)";
  }
  return null;
}

// Returns null if the action is allowed from the current status, else a reason.
export function versionTransitionError(action, status) {
  const t = VERSION_TRANSITIONS[action];
  if (!t) return `Unknown action '${action}'`;
  if (!STATUSES.includes(status)) return `Unknown status '${status}'`;
  if (!t.from.includes(status)) {
    if (action === "delete") return "Only a draft version can be deleted — approved and archived versions are kept as a record";
    return `Cannot ${action} a version that is ${status.toLowerCase()}`;
  }
  return null;
}

// 'YYYY-MM' → the same month a year earlier. Non-matching input passes through.
export function priorYearMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return ym;
  return `${Number(m[1]) - 1}-${m[2]}`;
}

export function priorYearMonths(months) {
  return (months || []).map(priorYearMonth);
}

// Grain key for a forecast/version line — matches the forecast_line unique grain.
export function lineKey(l) {
  return [l.scope, l.unit || "", l.line_label, l.cost_type, l.ym || ""].join("|");
}

/*
 * Diff two sets of snapshot lines by grain. Returns
 *   { rows: [{ key, scope, unit, line_label, cost_type, ym, a, b, delta }],
 *     summary: { added, removed, changed, unchanged, deltaValue } }
 * where a/b are the values in each set (null if absent). Only differing lines
 * appear in rows; unchanged lines are counted in the summary.
 */
export function compareVersions(linesA = [], linesB = []) {
  const A = new Map(), B = new Map();
  for (const l of linesA) A.set(lineKey(l), l);
  for (const l of linesB) B.set(lineKey(l), l);

  const keys = new Set([...A.keys(), ...B.keys()]);
  const rows = [];
  let added = 0, removed = 0, changed = 0, unchanged = 0, deltaValue = 0;

  for (const key of keys) {
    const la = A.get(key), lb = B.get(key);
    const a = la ? Number(la.value) : null;
    const b = lb ? Number(lb.value) : null;
    const ref = la || lb;
    if (a == null) added += 1;
    else if (b == null) removed += 1;
    else if (a !== b) changed += 1;
    else { unchanged += 1; continue; }
    const delta = (b || 0) - (a || 0);
    deltaValue += delta;
    rows.push({
      key,
      scope: ref.scope,
      unit: ref.unit || null,
      line_label: ref.line_label,
      cost_type: ref.cost_type,
      ym: ref.ym || null,
      a,
      b,
      delta,
    });
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { rows, summary: { added, removed, changed, unchanged, deltaValue } };
}
