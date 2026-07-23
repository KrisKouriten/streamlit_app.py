import * as XLSX from "xlsx";
import { headerToYm, parseMoney } from "./joiin-rules.js";

/*
 * P&L format-template importer (Phase 19b). Turns one of Miniso UK's board-pack
 * P&L template workbooks into a governed format spec (the same shape the
 * renderer reads). Structure comes from the rows; the *arithmetic* of subtotals
 * and derived lines (Gross Profit, EBITDA, margins) is inferred by
 * verify-by-recompute — the template carries the numbers, so for each computed
 * row we solve which prior named rows combine to produce its column values.
 * Leaf rows become account lines; those whose label isn't a recognisable
 * nominal are left unmapped for the GOVERN mapping step.
 */

// Most specific first; "consolidated" is the fallback because it appears in
// several template titles ("Store Detailed Consolidated", …).
const SCOPE_FROM_TITLE = [
  [/franchise/i, "franchise"],
  [/head office|wholesale/i, "head_office"],
  [/\bstore\b/i, "store"],
  [/consolidated|company/i, "consolidated"],
];

// A leaf line's label is a chart-of-accounts nominal when it carries a ledger
// prefix or matches one of the known unprefixed nominals.
const NOMINAL_RE = /^(ST|HO|FR):/;
const UNPREFIXED_NOMINALS = /^(Franchise Fee|Direct Wages|Payment Fee|Inventory|Local Purchase|Miniso Inventory|Bank Revaluations|Bank Fees|Exceptional Items|Closing stock|Opening stock|Suspense|HMRC|Loan Novation|Loans Write-off|Interest |Capex |Depreciation Expense|Deferred tax|Amortisation|Earnings Orders|Inter-group|Sponsorship)/i;
export const isNominalLabel = (label) => NOMINAL_RE.test(label) || UNPREFIXED_NOMINALS.test(label);

const near = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.005);
const vecNear = (x, y) => x.length === y.length && x.every((v, i) => near(v, y[i]));
const sumVecs = (items, len) => Array.from({ length: len }, (_, i) => items.reduce((t, c) => t + c.vec[i], 0));

// A "Total …" row = shortest trailing suffix of the open (un-consumed) list
// whose values sum to it. Handles nested subtotals because each total replaces
// its members in `open`. Returns the member labels, or null.
function suffixSum(open, vec) {
  for (let take = 1; take <= open.length; take++) {
    const items = open.slice(open.length - take);
    if (vecNear(sumVecs(items, vec.length), vec)) return items.map((c) => c.label);
  }
  return null;
}

// A derived row (Gross Profit, EBITDA, …) = add[] − sub[] over candidate rows.
// Tries A−B, A+B, A−B−C. `cands` are recent open entries (and history fallback).
function combo(cands, vec) {
  const n = cands.length, len = vec.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    if (vecNear(cands[i].vec.map((x, k) => x - cands[j].vec[k]), vec)) return { add: [cands[i].label], sub: [cands[j].label] };
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (vecNear(cands[i].vec.map((x, k) => x + cands[j].vec[k]), vec)) return { add: [cands[i].label, cands[j].label], sub: [] };
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    if (i === j || j === k || i === k) continue;
    if (vecNear(cands[i].vec.map((x, m) => x - cands[j].vec[m] - cands[k].vec[m]), vec)) return { add: [cands[i].label], sub: [cands[j].label, cands[k].label] };
  }
  return null;
}

// A percentage row = A / B over the full history (references may be consumed).
function ratio(history, vec) {
  for (let i = 0; i < history.length; i++) for (let j = 0; j < history.length; j++) {
    if (i === j) continue;
    const num = history[i].vec, den = history[j].vec;
    if (vec.every((r, k) => Math.abs((den[k] ? num[k] / den[k] : 0) - r) <= 0.005)) return { num: history[i].label, den: history[j].label };
  }
  return null;
}

function cleanName(scopeKind) {
  return { store: "Store P&L", head_office: "Head Office / Wholesale P&L", franchise: "Franchise P&L", consolidated: "Consolidated P&L" }[scopeKind] || "P&L";
}

export function parseFormatWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });

  // scope from the title band
  let scopeKind = "custom";
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const s = String(rows[i][0] || "");
    const hit = SCOPE_FROM_TITLE.find(([re]) => re.test(s));
    if (hit) { scopeKind = hit[1]; break; }
  }

  // header row: two or more month-like columns
  let hIdx = -1, valCols = [];
  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i].map((c, idx) => ({ idx, ym: headerToYm(String(c)) })).filter((c) => c.ym);
    if (cols.length >= 2) { hIdx = i; valCols = cols.map((c) => c.idx); break; }
  }
  if (hIdx < 0) throw new Error("Could not find the month header row (e.g. 'Jan 26 … Jun 26').");

  const spec = [];
  const open = [];       // un-consumed running results (for totals/calcs)
  const history = [];    // every value row, by label (for ratios)
  const warnings = [];
  const needMap = [];
  const consume = (labels) => { for (const l of labels) { const i = open.findIndex((o) => o.label === l); if (i >= 0) open.splice(i, 1); } };

  for (let i = hIdx + 1; i < rows.length; i++) {
    const label = String(rows[i][0] ?? "").trim();
    if (!label) continue;
    const raw = valCols.map((ci) => parseMoney(rows[i][ci]));
    const hasVals = raw.some((v) => v != null);
    const vec = raw.map((v) => (v == null ? 0 : v));
    const low = label.toLowerCase();

    if (!hasVals) {
      spec.push(label.endsWith(":") ? { kind: "sub", label } : { kind: "section", label });
      continue;
    }
    if (label.endsWith("%") || / %$/.test(label) || /margin %|cost %/i.test(low)) {
      const r = ratio(history, vec);
      spec.push({ kind: "pct", label, num: r?.num || null, den: r?.den || null });
      if (!r) warnings.push(`Couldn't derive the ratio for "${label}"`);
      history.push({ label, vec });
      continue;
    }
    if (/\btotal\b/.test(low)) {
      const of = suffixSum(open, vec);
      spec.push({ kind: "total", label, of: of || [], strong: true });
      if (of) { consume(of); } else warnings.push(`Couldn't derive the members of "${label}"`);
      open.push({ label, vec }); history.push({ label, vec });
      continue;
    }
    // Non-total value row: a derived line if it combines prior rows, else a leaf.
    const c = !isNominalLabel(label) ? (combo(open.slice(-12), vec) || combo(history.slice(-16), vec)) : null;
    if (c) {
      spec.push({ kind: "calc", label, add: c.add, sub: c.sub, tone: /ebitda|net profit/i.test(low) ? "ebitda" : (/profit/i.test(low) ? "gp" : undefined), strong: true });
      consume([...c.add, ...c.sub]);
      open.push({ label, vec }); history.push({ label, vec });
    } else {
      const accounts = isNominalLabel(label) ? [label] : [];
      spec.push({ kind: "line", label, accounts });
      if (!accounts.length) needMap.push(label);
      open.push({ label, vec }); history.push({ label, vec });
    }
  }

  return { scopeKind, name: cleanName(scopeKind), spec, warnings, needMap };
}
