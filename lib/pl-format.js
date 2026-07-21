/*
 * Board-pack P&L formats (Phase 18) — pure presentation layer.
 *
 * A format is an ordered list of entries that map the Joiin nominals (by exact
 * account name) into the groupings, subtotals and derived metrics of Miniso UK's
 * board-pack P&L templates. renderFormat() takes per-account monthly values and
 * produces the rows a table renders, with each subtotal / margin / EBITDA line
 * computed from the ones above it.
 *
 * Entry kinds:
 *   section  — band header (no values)
 *   sub      — sub-band header (no values)
 *   line     — account row; value = sum of the named Joiin accounts
 *   total    — subtotal = sum of referenced prior row labels
 *   calc     — add[] minus sub[] of referenced prior row labels
 *   pct      — ratio of two referenced row labels (num / den)
 * calc rows may carry tone:"ebitda"|"gp" so the UI can accent them.
 */

// ---- Store board-pack format --------------------------------------------
export const STORE_FORMAT = [
  { kind: "line", label: "Store Sales", accounts: ["ST: Sales"], strong: true },
  { kind: "section", label: "Store Cost of Sales" },
  { kind: "line", label: "ST: Clearance Provision", accounts: ["ST: Clearance Provision"] },
  { kind: "line", label: "ST: Cost of Goods Sold", accounts: ["ST: Cost of Goods Sold"] },
  { kind: "total", label: "Total Store Cost of Sales", of: ["ST: Clearance Provision", "ST: Cost of Goods Sold"] },
  { kind: "calc", label: "Store Gross Profit", add: ["Store Sales"], sub: ["Total Store Cost of Sales"], tone: "gp" },
  { kind: "pct", label: "Gross Margin %", num: "Store Gross Profit", den: "Store Sales" },
  { kind: "section", label: "Store Staff Costs" },
  { kind: "line", label: "ST: Employers National Insurance", accounts: ["ST: Employers National Insurance"] },
  { kind: "line", label: "ST: Pensions Costs", accounts: ["ST: Pensions Costs"] },
  { kind: "line", label: "ST: Salaries - Basic Pay", accounts: ["ST: Salaries - Basic Pay"] },
  { kind: "line", label: "ST: Salaries - Holiday Pay", accounts: ["ST: Salaries - Holiday Pay"] },
  { kind: "total", label: "Total Store Staff Costs", of: ["ST: Employers National Insurance", "ST: Pensions Costs", "ST: Salaries - Basic Pay", "ST: Salaries - Holiday Pay"] },
  { kind: "pct", label: "Labour Cost %", num: "Total Store Staff Costs", den: "Store Sales" },
  { kind: "section", label: "Store Establishment Costs" },
  { kind: "line", label: "ST: Rates", accounts: ["ST: Rates"] },
  { kind: "line", label: "ST: Rent", accounts: ["ST: Rent"] },
  { kind: "line", label: "ST: Service Charges", accounts: ["ST: Service Charges"] },
  { kind: "total", label: "Total Store Establishment Costs", of: ["ST: Rates", "ST: Rent", "ST: Service Charges"] },
  { kind: "pct", label: "Store Est. Cost %", num: "Total Store Establishment Costs", den: "Store Sales" },
  { kind: "section", label: "Store General Administration" },
  { kind: "sub", label: "Store Marketing Expenses:" },
  { kind: "line", label: "ST: Advertising & Marketing", accounts: ["ST: Advertising & Marketing"] },
  { kind: "line", label: "ST: Printing & Stationery", accounts: ["ST: Printing & Stationery"] },
  { kind: "total", label: "Total Store Marketing Expenses", of: ["ST: Advertising & Marketing", "ST: Printing & Stationery"] },
  { kind: "sub", label: "Store Operating Expenses:" },
  { kind: "line", label: "ST: Computer & IT Expenses", accounts: ["ST: Computer & IT Expenses"] },
  { kind: "line", label: "ST: Distribution Costs", accounts: ["ST: Distribution Costs"] },
  { kind: "line", label: "ST: General Expenses", accounts: ["ST: General Expenses"] },
  { kind: "line", label: "ST: Merchant Charges", accounts: ["ST: Merchant Charges"] },
  { kind: "line", label: "ST: Mileage & Travelling", accounts: ["ST: Mileage & Travelling"] },
  { kind: "line", label: "ST: Postage, Freight & Courier", accounts: ["ST: Postage, Freight & Courier"] },
  { kind: "line", label: "ST: Pre-Store Opening", accounts: ["ST: Pre-Store Opening"] },
  { kind: "line", label: "ST: Recruitment costs", accounts: ["ST: Recruitment costs"] },
  { kind: "line", label: "ST: Repairs & Maintenance", accounts: ["ST: Repairs & Maintenance"] },
  { kind: "line", label: "ST: Security", accounts: ["ST: Security"] },
  { kind: "line", label: "ST: Subscriptions", accounts: ["ST: Subscriptions"] },
  { kind: "line", label: "ST: Subsistence", accounts: ["ST: Subsistence"] },
  { kind: "line", label: "ST: Travel - International", accounts: ["ST: Travel - International"] },
  { kind: "line", label: "ST: Travel - National", accounts: ["ST: Travel - National"] },
  { kind: "line", label: "ST: Warehouse Storage", accounts: ["ST: Warehouse Storage"] },
  { kind: "total", label: "Total Store Operating Expenses", of: ["ST: Computer & IT Expenses", "ST: Distribution Costs", "ST: General Expenses", "ST: Merchant Charges", "ST: Mileage & Travelling", "ST: Postage, Freight & Courier", "ST: Pre-Store Opening", "ST: Recruitment costs", "ST: Repairs & Maintenance", "ST: Security", "ST: Subscriptions", "ST: Subsistence", "ST: Travel - International", "ST: Travel - National", "ST: Warehouse Storage"] },
  { kind: "sub", label: "Store Utility Expenses:" },
  { kind: "line", label: "ST: Cleaning", accounts: ["ST: Cleaning"] },
  { kind: "line", label: "ST: Insurance", accounts: ["ST: Insurance"] },
  { kind: "line", label: "ST: Telephone & Internet", accounts: ["ST: Telephone & Internet"] },
  { kind: "line", label: "ST: Utilities", accounts: ["ST: Utilities"] },
  { kind: "total", label: "Total Store Utility Expenses", of: ["ST: Cleaning", "ST: Insurance", "ST: Telephone & Internet", "ST: Utilities"] },
  { kind: "line", label: "ST: Sundry Expenses", accounts: ["ST: Sundry Expenses"] },
  { kind: "total", label: "Total Store General Administration", of: ["Total Store Marketing Expenses", "Total Store Operating Expenses", "Total Store Utility Expenses", "ST: Sundry Expenses"] },
  { kind: "section", label: "Store Legal and Professional Fees" },
  { kind: "line", label: "ST: Audit & Accountancy fees", accounts: ["ST: Audit & Accountancy fees"] },
  { kind: "line", label: "ST: Legal & Professional Fees", accounts: ["ST: Legal & Professional Fees"] },
  { kind: "total", label: "Total Store Legal and Professional Fees", of: ["ST: Audit & Accountancy fees", "ST: Legal & Professional Fees"] },
  { kind: "calc", label: "Store G&A & Legal Expense", add: ["Total Store General Administration", "Total Store Legal and Professional Fees"], sub: [] },
  { kind: "pct", label: "Store G&A and Legal Expense %", num: "Store G&A & Legal Expense", den: "Store Sales" },
  { kind: "total", label: "Store Total Expenses", of: ["Total Store Staff Costs", "Total Store Establishment Costs", "Store G&A & Legal Expense"], strong: true },
  { kind: "calc", label: "Store EBITDA", add: ["Store Gross Profit"], sub: ["Store Total Expenses"], tone: "ebitda" },
  { kind: "pct", label: "Store EBITDA %", num: "Store EBITDA", den: "Store Sales" },
];

// ---- Franchise board-pack format -----------------------------------------
export const FRANCHISE_FORMAT = [
  { kind: "section", label: "Franchise Revenue" },
  { kind: "line", label: "FR: Distribution Costs - Recharged", accounts: ["FR: Distribution Costs - Recharged"] },
  { kind: "line", label: "FR: Franchise Direct Inventory - Recharged", accounts: ["FR: Franchise Direct Inventory - Recharged"] },
  { kind: "line", label: "FR: Franchise Fee - Marketing", accounts: ["FR: Franchise Fee - Marketing"] },
  { kind: "line", label: "FR: Franchise Fee - Revenue", accounts: ["FR: Franchise Fee - Revenue"] },
  { kind: "line", label: "FR: Franchise Fee - Royalties", accounts: ["FR: Franchise Fee - Royalties", "FR: Franchise Fee - Royalties/Fee"] },
  { kind: "line", label: "FR: License fee Income", accounts: ["FR: License fee Income"] },
  { kind: "line", label: "FR: Management Fee Income", accounts: ["FR: Management Fee Income"] },
  { kind: "line", label: "FR: Marketing Costs - Recharged", accounts: ["FR: Marketing Costs - Recharged"] },
  { kind: "line", label: "Franchise Fee - Royalties", accounts: ["Franchise Fee - Royalties", "Franchise Fee - Recharges"] },
  { kind: "total", label: "Total Franchise Revenue", of: ["FR: Distribution Costs - Recharged", "FR: Franchise Direct Inventory - Recharged", "FR: Franchise Fee - Marketing", "FR: Franchise Fee - Revenue", "FR: Franchise Fee - Royalties", "FR: License fee Income", "FR: Management Fee Income", "FR: Marketing Costs - Recharged", "Franchise Fee - Royalties"], strong: true },
  { kind: "section", label: "Franchise General Administration" },
  { kind: "line", label: "FR: Advertising & Marketing", accounts: ["FR: Advertising & Marketing"] },
  { kind: "line", label: "FR: Franchise Direct-Shipped Inventory Costs", accounts: ["FR: Franchise Direct-Shipped Inventory Costs"] },
  { kind: "line", label: "FR: Franchise Distribution Costs", accounts: ["FR: Franchise Distribution Costs"] },
  { kind: "line", label: "FR: Franchise Marketing Costs", accounts: ["FR: Franchise Marketing Costs"] },
  { kind: "line", label: "FR: Insurance", accounts: ["FR: Insurance"] },
  { kind: "total", label: "Total Franchise General Administration", of: ["FR: Advertising & Marketing", "FR: Franchise Direct-Shipped Inventory Costs", "FR: Franchise Distribution Costs", "FR: Franchise Marketing Costs", "FR: Insurance"] },
  { kind: "section", label: "Franchise Professional and Legal Fees" },
  { kind: "line", label: "FR: Audit & Accountancy fees", accounts: ["FR: Audit & Accountancy fees"] },
  { kind: "total", label: "Total Franchise Professional and Legal Fees", of: ["FR: Audit & Accountancy fees"] },
  { kind: "calc", label: "Franchise EBITDA", add: ["Total Franchise Revenue"], sub: ["Total Franchise General Administration", "Total Franchise Professional and Legal Fees"], tone: "ebitda" },
  { kind: "pct", label: "Franchise EBITDA %", num: "Franchise EBITDA", den: "Total Franchise Revenue" },
];

export const FORMATS = { store: STORE_FORMAT, franchise: FRANCHISE_FORMAT };

// Render a format against per-account values.
//   accountVals: { [account]: { [col]: number } }
//   cols: ordered list of column keys (e.g. months) to compute
// Returns [{ kind, label, strong?, tone?, isPct?, values:{col:number}, total:number }]
export function renderFormat(format, accountVals, cols) {
  const byLabel = new Map(); // label -> { [col]: number }
  const zero = () => Object.fromEntries(cols.map((c) => [c, 0]));
  const sumInto = (target, labels, sign = 1) => {
    for (const l of labels) {
      const v = byLabel.get(l);
      if (!v) continue;
      for (const c of cols) target[c] += sign * (v[c] || 0);
    }
  };
  const rows = [];
  for (const e of format) {
    if (e.kind === "section" || e.kind === "sub") { rows.push({ ...e }); continue; }
    const vals = zero();
    if (e.kind === "line") {
      for (const a of e.accounts) { const av = accountVals[a]; if (av) for (const c of cols) vals[c] += av[c] || 0; }
    } else if (e.kind === "total") {
      sumInto(vals, e.of, 1);
    } else if (e.kind === "calc") {
      sumInto(vals, e.add || [], 1);
      sumInto(vals, e.sub || [], -1);
    } else if (e.kind === "pct") {
      const num = byLabel.get(e.num) || {}, den = byLabel.get(e.den) || {};
      for (const c of cols) { const d = den[c] || 0; vals[c] = d ? (num[c] || 0) / d : 0; }
      byLabel.set(e.label, vals);
      const total = (() => { const nT = cols.reduce((t, c) => t + (num[c] || 0), 0), dT = cols.reduce((t, c) => t + (den[c] || 0), 0); return dT ? nT / dT : 0; })();
      rows.push({ ...e, isPct: true, values: vals, total });
      continue;
    }
    byLabel.set(e.label, vals);
    rows.push({ ...e, values: vals, total: cols.reduce((t, c) => t + vals[c], 0) });
  }
  return rows;
}

// A generic detailed P&L for any entity from its section/account rows —
// used for entities without a bespoke board-pack format. Groups accounts under
// the Joiin sections, subtotals each, and derives Gross Profit / Operating
// Profit / Net Profit. rowsByAccount: [{section, account, values:{col}, total}].
const GEN_SECTIONS = ["Revenue", "Cost of Sales", "Expenses", "Other Income", "Other Expenses"];
export function buildGenericFormat(accounts) {
  // accounts: [{section, account}] present for this entity
  const bySection = {};
  for (const a of accounts) (bySection[a.section] ||= new Set()).add(a.account);
  const fmt = [];
  for (const sec of GEN_SECTIONS) {
    if (!bySection[sec]) continue;
    fmt.push({ kind: "section", label: sec });
    const accs = [...bySection[sec]].sort();
    for (const a of accs) fmt.push({ kind: "line", label: a, accounts: [a] });
    fmt.push({ kind: "total", label: `Total ${sec}`, of: accs, strong: true });
  }
  // derived
  fmt.push({ kind: "calc", label: "Gross Profit", add: ["Total Revenue"], sub: ["Total Cost of Sales"], tone: "gp" });
  fmt.push({ kind: "calc", label: "Operating Profit", add: ["Gross Profit"], sub: ["Total Expenses"], tone: "gp" });
  fmt.push({ kind: "calc", label: "Net Profit", add: ["Operating Profit", "Total Other Income"], sub: ["Total Other Expenses"], tone: "ebitda" });
  return fmt;
}

// Classify a Joiin entity → which board-pack format to apply.
// Store entities post ST: Sales; the franchise entity posts FR: fee income.
export function classifyEntity(entityName, accountsPresent) {
  const set = new Set(accountsPresent);
  if (set.has("ST: Sales")) return "store";
  if (/franchise/i.test(entityName)) return "franchise";
  return "generic";
}
