/*
 * Expense claims — pure, unit-testable.
 *
 * The source is Xero's expense-claims export: one row per claim line, with the
 * claimant, the department (a column Finance add to the export), the claim
 * date, the net line amount and its VAT, the account it was coded to, and the
 * two tracking categories (Store, Allocation).
 *
 * Every claim counts against the claimant's department's Travel, Expenses &
 * Entertainment budget (budget type TEE) — "Expenses" in that budget is the
 * claimed spend. The account code says what kind of expense it was, so the
 * report can split travel from subsistence from entertainment, but it does not
 * move a claim onto another budget.
 *
 * Amounts compare NET of VAT: departmental budgets are set before VAT.
 */

import { parseCsvRows } from "./intercompany-rules.js";

// Account names from the group chart of accounts, for the codes claims are
// coded to. A code not listed shows as "Account <code>".
export const EXPENSE_ACCOUNTS = {
  "266": "Mileage & Travelling",
  "277": "Office Expenses",
  "279": "Computer & IT Expenses",
  "400": "Advertising & Marketing",
  "408": "Cleaning",
  "420": "Entertainment (100% business)",
  "424": "Entertainment (0%)",
  "429": "General Expenses",
  "449": "Motor Vehicle Expenses",
  "461": "Printing & Stationery",
  "473": "Repairs & Maintenance",
  "481": "Staff Uniform",
  "484": "Recruitment",
  "485": "Subscriptions",
  "489": "Telephone & Internet",
  "493": "Travel — National",
  "494": "Travel — International",
  "495": "Subsistence",
  "700": "Inter-Company Disbursement",
};
export const accountName = (code) => {
  const c = String(code || "").trim();
  if (!c) return "Uncoded";
  return EXPENSE_ACCOUNTS[c] || `Account ${c}`;
};

// Xero exports dates month-first ("1/31/2026"); ISO passes through.
export function exportDate(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "Saad Usman (saad@…)" → "Saad Usman". The export sometimes puts the email in
// the contact name; the name is all the report needs.
export function claimantName(v) {
  return String(v || "").replace(/\s*\([^)]*@[^)]*\)\s*$/, "").trim();
}

// "13 Oxford Street" → "Oxford Street": the tracking option carries a store
// number in front of the name.
export function storeFromTracking(v) {
  return String(v || "").trim().replace(/^\d+\s+/, "");
}

const REQUIRED = ["ContactName", "InvoiceDate", "LineAmount"];

/*
 * The export, as lines ready to store.
 *   → { lines, errors, dateFrom, dateTo, departments: [names], netTotal, taxTotal }
 */
export function parseExpenseCsv(text = "") {
  const rows = parseCsvRows(text);
  if (!rows.length) return { lines: [], errors: ["The file is empty"], dateFrom: null, dateTo: null, departments: [], netTotal: 0, taxTotal: 0 };
  const head = rows[0].map((h) => String(h || "").trim());
  const col = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const missing = REQUIRED.filter((h) => col(h) < 0);
  if (missing.length) {
    return { lines: [], errors: [`This isn't the Xero expense-claims export — it has no ${missing.join(", ")} column${missing.length === 1 ? "" : "s"}`], dateFrom: null, dateTo: null, departments: [], netTotal: 0, taxTotal: 0 };
  }
  const at = (r, name) => { const i = col(name); return i < 0 ? "" : String(r[i] ?? "").trim(); };
  const lines = [], errors = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c || "").trim())) continue;
    const date = exportDate(at(r, "InvoiceDate"));
    const claimant = claimantName(at(r, "ContactName"));
    if (!date || !claimant) { errors.push(`Row ${i + 1}: no ${!date ? "date" : "claimant"}`); continue; }
    lines.push({
      claimant,
      department: at(r, "Department") || null,
      claim_date: date,
      due_date: exportDate(at(r, "DueDate")),
      description: at(r, "Description").slice(0, 400) || null,
      quantity: at(r, "Quantity") === "" ? null : num(at(r, "Quantity")),
      unit_amount: at(r, "UnitAmount") === "" ? null : num(at(r, "UnitAmount")),
      net_amount: round2(num(at(r, "LineAmount"))),
      tax_amount: round2(num(at(r, "TaxAmount"))),
      account_code: at(r, "AccountCode") || null,
      tax_type: at(r, "TaxType") || null,
      store_tracking: at(r, "TrackingOption1") || null,
      allocation_tracking: at(r, "TrackingOption2") || null,
      status: at(r, "Status") || null,
    });
  }
  const dates = lines.map((l) => l.claim_date).sort();
  return {
    lines,
    errors: errors.slice(0, 20),
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    departments: [...new Set(lines.map((l) => l.department).filter(Boolean))].sort(),
    netTotal: round2(lines.reduce((t, l) => t + l.net_amount, 0)),
    taxTotal: round2(lines.reduce((t, l) => t + l.tax_amount, 0)),
  };
}

/*
 * Department names, matched loosely: case, "&"/"and", and word order do not
 * matter ("Build & Architecture" is "Architecture & Build"). A saved mapping
 * wins; a name that matches nothing stays as the export has it and is listed
 * for Finance to map.
 *   map: { deptKey(file name): app department name }
 */
export function deptKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/)
    .filter((w) => w && w !== "and" && w !== "the").sort().join(" ");
}
/*
 * Teams that report within a department. Head Office Operations and Store
 * Operations are both Operations — one T&E budget — and the export's own name
 * is kept on every line as the team, so the report can still show them apart.
 * A saved mapping can override these.
 */
export const DEFAULT_DEPT_MAP = {
  [deptKey("Head Office Operations")]: "Operations",
  [deptKey("Store Operations")]: "Operations",
};
export function resolveDepartment(fileDept, appDepts = [], map = {}) {
  if (!fileDept) return null;
  const k = deptKey(fileDept);
  if (map && map[k]) return map[k];
  if (DEFAULT_DEPT_MAP[k]) return DEFAULT_DEPT_MAP[k];
  const hit = (appDepts || []).find((d) => deptKey(d) === k);
  return hit || null;
}

// The team a line belongs to within its department: the export's department
// name, where it is not simply the department itself.
export function teamOf(line = {}) {
  const t = String(line.team || "").trim();
  if (!t || deptKey(t) === deptKey(line.department)) return null;
  return t;
}

/*
 * The report for a year: totals, and the same spend by department, month,
 * category, claimant and store. Departments carry their T&E budget where one
 * is given, with the year-to-date share of it (the budget months up to the
 * latest month claimed).
 *   lines:   [{ department (resolved), claimant, claim_date, net_amount, tax_amount, account_code, store_tracking }]
 *   budgets: { department: { total, months: [12] } }
 */
export function summariseExpenses(lines = [], { year, budgets = {}, period = null } = {}) {
  // A period (expensePeriod) narrows the claims to its dates, and the budget
  // compared with them to its months; without one it is the year to date.
  const inYear = (lines || []).filter((l) => {
    const d = String(l.claim_date || "");
    return d.startsWith(String(year)) && (!period || (d >= period.from && d <= period.to));
  });
  const add = (map, key, l) => {
    const e = map.get(key) || { key, net: 0, vat: 0, lines: 0 };
    e.net += Number(l.net_amount) || 0; e.vat += Number(l.tax_amount) || 0; e.lines += 1;
    map.set(key, e);
  };
  const byDept = new Map(), byMonth = new Map(), byCat = new Map(), byClaimant = new Map(), byStore = new Map();
  const deptMonth = new Map();
  const deptTeams = new Map();   // department → Map(team → { key, net, vat, lines, months })
  const deptLines = new Map();   // department → Map(T&E budget line → { net, months })
  let lastMonth = 0;
  for (const l of inYear) {
    const dept = l.department || "Unmapped";
    const mo = Number(String(l.claim_date).slice(5, 7));
    lastMonth = Math.max(lastMonth, mo);
    add(byDept, dept, l);
    add(byMonth, mo, l);
    add(byCat, accountName(l.account_code), l);
    add(byClaimant, l.claimant, l);
    if (l.store_tracking) add(byStore, storeFromTracking(l.store_tracking), l);
    const dm = deptMonth.get(dept) || Array(12).fill(0);
    dm[mo - 1] += Number(l.net_amount) || 0;
    deptMonth.set(dept, dm);
    const tl = teeLineOf(l);
    const dl = deptLines.get(dept) || new Map();
    const le = dl.get(tl) || { net: 0, months: Array(12).fill(0) };
    le.net += Number(l.net_amount) || 0; le.months[mo - 1] += Number(l.net_amount) || 0;
    dl.set(tl, le); deptLines.set(dept, dl);
    const team = teamOf(l);
    if (team) {
      const tm = deptTeams.get(dept) || new Map();
      const e = tm.get(team) || { key: team, net: 0, vat: 0, lines: 0, months: Array(12).fill(0) };
      e.net += Number(l.net_amount) || 0; e.vat += Number(l.tax_amount) || 0; e.lines += 1;
      e.months[mo - 1] += Number(l.net_amount) || 0;
      tm.set(team, e);
      deptTeams.set(dept, tm);
    }
  }
  // The budget set for the months compared: the period's months, or January to
  // the latest month claimed.
  const win = period?.months || (lastMonth ? [1, lastMonth] : null);
  const budgetIn = (months) => (win ? round2((months || []).slice(win[0] - 1, win[1]).reduce((t, v) => t + (Number(v) || 0), 0)) : null);
  const fin = (e) => ({ ...e, net: round2(e.net), vat: round2(e.vat) });
  const sorted = (m) => [...m.values()].map(fin).sort((a, b) => b.net - a.net);
  const depts = new Set([...byDept.keys(), ...Object.keys(budgets || {})]);
  const departments = [...depts].map((d) => {
    const e = byDept.get(d) || { key: d, net: 0, vat: 0, lines: 0 };
    const b = budgets?.[d] || null;
    const budget = b ? round2(b.total) : null;
    const budgetYtd = b ? budgetIn(b.months) : null;
    return {
      ...fin(e), department: d,
      months: (deptMonth.get(d) || Array(12).fill(0)).map(round2),
      budget, budgetMonths: b ? (b.months || []).map(round2) : null, budgetYtd,
      remaining: budget == null ? null : round2(budget - e.net),
      overYtd: budgetYtd != null && e.net > budgetYtd,
      over: budget != null && e.net > budget,
      // The teams inside the department (e.g. Head Office and Store
      // Operations within Operations), largest first. Lines the export
      // names by the department itself are listed as the department.
      // Budget against claims on each T&E budget line: every line that has
      // either, budget to date over the same months as the claims.
      budgetLines: (() => {
        const dl = deptLines.get(d) || new Map();
        const bl = (b && b.lines) || {};
        return TEE_LINES.filter((line) => dl.has(line) || bl[line]).map((line) => {
          const a = dl.get(line) || { net: 0, months: Array(12).fill(0) };
          const bm = bl[line] || null;
          const bTotal = bm ? round2(bm.reduce((t, v) => t + (Number(v) || 0), 0)) : null;
          const bYtd = bm ? (budgetIn(bm) ?? 0) : null;
          return { line, net: round2(a.net), budget: bTotal, budgetYtd: bYtd, months: a.months.map(round2), budgetMonths: bm ? bm.map(round2) : null };
        });
      })(),
      teams: (() => {
        const tm = deptTeams.get(d);
        if (!tm || !tm.size) return [];
        const listed = [...tm.values()];
        const rest = (Number(e.net) || 0) - listed.reduce((t, x) => t + x.net, 0);
        const restLines = (e.lines || 0) - listed.reduce((t, x) => t + x.lines, 0);
        const monthsRest = (deptMonth.get(d) || Array(12).fill(0)).map((v, i) => v - listed.reduce((t, x) => t + x.months[i], 0));
        if (restLines > 0) listed.push({ key: d, net: rest, vat: 0, lines: restLines, months: monthsRest });
        return listed.map((x) => ({ ...x, net: round2(x.net), vat: round2(x.vat), months: x.months.map(round2) })).sort((a, b) => b.net - a.net);
      })(),
    };
  }).sort((a, b) => b.net - a.net);
  return {
    year, lastMonth, period,
    net: round2(inYear.reduce((t, l) => t + (Number(l.net_amount) || 0), 0)),
    vat: round2(inYear.reduce((t, l) => t + (Number(l.tax_amount) || 0), 0)),
    lines: inYear.length,
    claimants: byClaimant.size,
    departments,
    months: Array.from({ length: 12 }, (_, i) => fin(byMonth.get(i + 1) || { key: i + 1, net: 0, vat: 0, lines: 0 })),
    categories: sorted(byCat),
    claimantsList: sorted(byClaimant),
    stores: sorted(byStore),
  };
}

/*
 * The period Expense Claims reports on, within a year.
 *   period  "ytd" (the default), "1"…"12" for one month, or "custom" with
 *           from / to as 'YYYY-MM-DD' — kept inside the year, swapped if given
 *           the wrong way round, and the year to date if either is missing
 * → { key, from, to, months: [first, last] | null, label }
 * `months` is the budget months compared with the claims: null for the year to
 * date (January to the latest month claimed), else the months the dates touch.
 */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function expensePeriod({ year, period = "ytd", from = null, to = null } = {}) {
  const y = Number(year) || new Date().getFullYear();
  const ytd = { key: "ytd", from: `${y}-01-01`, to: `${y}-12-31`, months: null, label: "Year to date" };
  const m = Number(period);
  if (Number.isInteger(m) && m >= 1 && m <= 12) {
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { key: String(m), from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}`, months: [m, m], label: `${MONTH_NAMES[m - 1]} ${y}` };
  }
  if (period !== "custom") return ytd;
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  let a = iso(from), b = iso(to);
  if (!a || !b) return ytd;
  if (a > b) [a, b] = [b, a];
  const clamp = (d) => (d < ytd.from ? ytd.from : d > ytd.to ? ytd.to : d);
  a = clamp(a); b = clamp(b);
  const dmy = (d) => d.split("-").reverse().join("/");
  return { key: "custom", from: a, to: b, months: [Number(a.slice(5, 7)), Number(b.slice(5, 7))], label: `${dmy(a)} – ${dmy(b)}` };
}

// One claim line as a row of the Excel download.
export function claimExportRow(l = {}) {
  const net = round2(l.net_amount), vat = round2(l.tax_amount);
  return {
    "Date": l.claim_date ? String(l.claim_date).slice(0, 10).split("-").reverse().join("/") : "",
    "Employee": l.claimant || "",
    "Department": l.department || "",
    "Team": l.team && l.team !== l.department ? l.team : "",
    "Description": l.description || "",
    "Category": accountName(l.account_code),
    "Account": l.account_code || "",
    "T&E budget line": teeLineOf(l),
    "Store": l.store_tracking ? storeFromTracking(l.store_tracking) : "",
    "Net £": net,
    "VAT £": vat,
    "Gross £": round2(net + vat),
    "Tax type": l.tax_type || "",
  };
}

/*
 * Who sees which tab on Expense Claims.
 *
 *   Finance (and admins) — every department's tab, plus Consolidated: the
 *     by-department summary across the company.
 *   A head of department — their own department's tab(s) only; no
 *     Consolidated, and no other department's claims.
 *   Anyone else — nothing.
 *
 *   → { tabs: [{ key, label }], consolidated: bool }
 */
export const CONSOLIDATED = "consolidated";
export function expenseTabs({ isFinance = false, headed = [], departments = [] } = {}) {
  const list = isFinance ? [...new Set(departments)].sort() : [...new Set(headed)].sort();
  return {
    consolidated: !!isFinance,
    tabs: [
      ...(isFinance ? [{ key: CONSOLIDATED, label: "Consolidated" }] : []),
      ...list.map((d) => ({ key: d, label: d })),
    ],
  };
}
// The tab to show: the one asked for if this person may see it, else their
// first. Null when they may see none.
export function pickExpenseTab(requested, access) {
  const keys = (access?.tabs || []).map((t) => t.key);
  if (!keys.length) return null;
  return keys.includes(requested) ? requested : keys[0];
}
// May this person see this department's claims (or Consolidated)?
export function canSeeExpenses(tab, access) {
  return (access?.tabs || []).some((t) => t.key === tab);
}

// ---------------------------------------------------------------- T&E budget lines
/*
 * The lines a Travel, Expenses & Entertainment budget is set on, as Finance
 * defined them. Every claim is sorted onto one of them (teeLineOf), so budget
 * and actual compare line by line as well as in total.
 */
export const TEE_LINES = [
  "Travel", "Mileage", "Accommodation", "Subsistence", "Client Entertainment", "Staff Entertainment",
  "Training", "Professional Fees", "Office Supplies", "Postage/Courier", "IT/Software", "Telephone",
  "Marketing/Event Costs", "Store/Operational Purchases", "Other",
];
export const TEE_CATEGORY = "Travel, Expenses & Entertainment";

const lineKey = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const LINE_BY_KEY = new Map(TEE_LINES.map((l) => [lineKey(l), l]));
// Loose: "postage / courier", "IT & software", "store operational purchases".
export function teeLineName(s) {
  const k = lineKey(s);
  if (LINE_BY_KEY.has(k)) return LINE_BY_KEY.get(k);
  const alias = { itsoftware: "IT/Software", itandsoftware: "IT/Software", postagecourier: "Postage/Courier", postageandcourier: "Postage/Courier",
    marketingeventcosts: "Marketing/Event Costs", marketingandeventcosts: "Marketing/Event Costs", storeoperationalpurchases: "Store/Operational Purchases",
    storeandoperationalpurchases: "Store/Operational Purchases", cliententertaining: "Client Entertainment", staffentertaining: "Staff Entertainment",
    hotel: "Accommodation", hotels: "Accommodation", phone: "Telephone", training: "Training" };
  return alias[k] || null;
}

/*
 * The budget line a claim falls on.
 *
 * The account code decides where it is specific enough; the travel codes
 * (266 Mileage & Travelling, 493/494 Travel) mix mileage, fares, hotels and
 * meals, so the description splits them. Entertainment follows the tax
 * treatment the codes already carry: 420 (100% deductible) is staff
 * entertainment, 424 (0%) is client entertainment — unless the description
 * says it was for a client. Anything described as training is Training
 * whatever it was coded to.
 */
const TRAVEL_CODES = new Set(["266", "493", "494", "449"]);
const CODE_LINE = {
  "495": "Subsistence",
  "420": "Staff Entertainment", "424": "Client Entertainment",
  "425": "Postage/Courier", "601": "Postage/Courier",
  "279": "IT/Software", "485": "IT/Software",
  "489": "Telephone",
  "400": "Marketing/Event Costs",
  "461": "Office Supplies", "277": "Office Supplies",
  "473": "Store/Operational Purchases", "481": "Store/Operational Purchases", "286": "Store/Operational Purchases",
  "408": "Store/Operational Purchases", "699": "Store/Operational Purchases", "700": "Store/Operational Purchases",
  "290": "Professional Fees", "401": "Professional Fees", "412": "Professional Fees",
};
export function teeLineOf(line = {}) {
  const code = String(line.account_code || "").trim();
  const d = String(line.description || "").toLowerCase();
  if (/\btraining\b|\bcourse\b|\bcpd\b|\bworkshop\b/.test(d)) return "Training";
  if (TRAVEL_CODES.has(code)) {
    if (/\bmileage\b|\bmiles?\b/.test(d)) return "Mileage";
    if (/hotel|accommodation|premier inn|travelodge|airbnb|\bibis\b|holiday inn|overnight|night stay/.test(d)) return "Accommodation";
    if (/breakfast|lunch|dinner|\bmeal|subsistence|\bfood\b/.test(d)) return "Subsistence";
    return "Travel";
  }
  if ((code === "420" || code === "424") && /\bclient|\bcustomer|\bsupplier|\blandlord|\bpartner/.test(d)) return "Client Entertainment";
  return CODE_LINE[code] || "Other";
}

/*
 * The T&E budget upload: one row per department (and, optionally, employee)
 * and line, a column per month.
 *   Year | Department | Employee | Line | Jan … Dec   (a Total or reference column is ignored)
 *
 * The Employee column is optional. Left blank, the budget is set for the
 * department. Filled in, it is set per employee and the department's budget is
 * the sum; any blank-employee rows in such a budget are kept as "Unallocated",
 * so every pound in the file still counts.
 * → { budgets: [{ year, department, lines: [{ label, months: [12] }],
 *                 employees: [{ employee, lines: [{ label, months }] }] }], errors }
 * Departments are matched to the app's by the caller (resolveDepartment).
 */
const MONTH_HEAD = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const UNALLOCATED = "Unallocated";
export function parseTeeBudgetRows(rows = [], { defaultYear = null } = {}) {
  const errors = [];
  const hi = (rows || []).findIndex((r) => r && r.some((c) => /^department$/i.test(String(c || "").trim())));
  if (hi < 0) return { budgets: [], errors: ["No header row with a Department column — use the T&E budget template"] };
  const head = rows[hi].map((h) => String(h || "").trim().toLowerCase());
  const iYear = head.findIndex((h) => h === "year");
  const iDept = head.indexOf("department");
  const iEmp = head.findIndex((h) => h === "employee" || h === "reportee" || h === "claimant");
  const iLine = head.findIndex((h) => h === "line" || h === "budget line" || h === "category");
  const iMonth = MONTH_HEAD.map((m) => head.findIndex((h) => h.slice(0, 3) === m));
  if (iLine < 0) return { budgets: [], errors: ["No Line column — use the T&E budget template"] };
  if (iMonth.some((i) => i < 0)) return { budgets: [], errors: ["The template needs a column for every month, Jan to Dec"] };
  const add = (map, label, months) => {
    const cur = map.get(label);
    map.set(label, cur ? cur.map((v, i) => round2(v + months[i])) : months);   // a line given twice adds up
  };
  const byKey = new Map();
  for (let ri = hi + 1; ri < rows.length; ri++) {
    const r = rows[ri];
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
    const dept = String(r[iDept] ?? "").trim();
    const rawLine = String(r[iLine] ?? "").trim();
    if (!dept && !rawLine) continue;
    const year = Number(iYear >= 0 ? r[iYear] : defaultYear) || Number(defaultYear) || null;
    if (!dept || !rawLine || !year) { errors.push(`Row ${ri + 1}: needs a year, department and line`); continue; }
    const label = teeLineName(rawLine);
    if (!label) { errors.push(`Row ${ri + 1}: "${rawLine}" is not one of the T&E budget lines`); continue; }
    const months = iMonth.map((i) => {
      const n = Number(String(r[i] ?? "").replace(/[£,\s]/g, ""));
      return Number.isFinite(n) ? round2(n) : 0;
    });
    const employee = iEmp >= 0 ? String(r[iEmp] ?? "").trim().replace(/\s+/g, " ") : "";
    const k = `${year}|${dept.toLowerCase()}`;
    const b = byKey.get(k) || { year, department: dept, lines: new Map(), people: new Map() };
    add(b.lines, label, months);
    const who = employee || "";
    if (!b.people.has(who)) b.people.set(who, new Map());
    add(b.people.get(who), label, months);
    byKey.set(k, b);
  }
  const ordered = (map) => TEE_LINES.filter((l) => map.has(l)).map((l) => ({ label: l, months: map.get(l) }));
  return {
    budgets: [...byKey.values()].map((b) => {
      const named = [...b.people.keys()].some((w) => w);
      const employees = !named ? [] : [...b.people.entries()]
        .map(([w, m]) => ({ employee: w || UNALLOCATED, lines: ordered(m) }))
        .sort((x, y) => (x.employee === UNALLOCATED) - (y.employee === UNALLOCATED) || x.employee.localeCompare(y.employee));
      return { year: b.year, department: b.department, lines: ordered(b.lines), employees };
    }),
    errors: errors.slice(0, 20),
  };
}

/*
 * The template for a year: a row per department × line — or, for a department
 * budgeted per employee, per employee × line — months blank, with what was
 * claimed on each line so far as a reference column.
 *   reference:  { department: { line: £ } }  or, per employee, { department: { employee: { line: £ } } }
 *   employees:  { department: [names] } — departments listed here get employee rows
 */
export function teeTemplateRows(year, departments = [], reference = {}, refLabel = "Claimed to date (reference)", { employees = {} } = {}) {
  const out = [["Year", "Department", "Employee", "Line", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", refLabel]];
  const blank = Array(12).fill("");
  for (const d of departments) {
    const people = employees?.[d] || [];
    if (people.length) {
      for (const e of people) {
        for (const l of TEE_LINES) out.push([year, d, e, l, ...blank, round2(reference?.[d]?.[e]?.[l] || 0) || ""]);
      }
    } else {
      for (const l of TEE_LINES) out.push([year, d, "", l, ...blank, round2(reference?.[d]?.[l] || 0) || ""]);
    }
  }
  return out;
}
export function toCsv(rows = []) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

/*
 * Which T&E budget counts for a department and year, when there is more than
 * one: the one furthest through approval (Locked, then SLT, Department and
 * Finance review, then Draft), and among those the most recently edited.
 * The report reads it and the upload writes to it — the same rule both ways,
 * so an upload can never fill a budget the report does not show.
 */
const STAGE_RANK = { DRAFT: 0, FINANCE_REVIEW: 1, DEPT_APPROVAL: 2, SLT_APPROVAL: 3, LOCKED: 4 };
export function pickTeeBudget(budgets = []) {
  const tee = (budgets || []).filter((b) => (b.budget_type || "BUSINESS") === "TEE");
  if (!tee.length) return null;
  return [...tee].sort((a, b) =>
    (STAGE_RANK[b.status] ?? 0) - (STAGE_RANK[a.status] ?? 0)
    || new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0];
}
