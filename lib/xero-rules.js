/*
 * Pure, unit-testable mapping from a Xero P&L report to Finance OS account lines.
 *
 * The Finance OS P&L is six accounts (Revenue, COGS, Store Labour, Occupancy,
 * Other Store Costs, Central Overheads). Xero's chart is far more granular, so we
 * roll each Xero account up to one Finance OS account. Income is stored positive;
 * cost-of-sales and expenses negative — so SUM(amount_gbp) equals net profit,
 * matching the existing fact_financials sign convention.
 *
 * mapProfitAndLoss reconciles its own output back to Xero's section totals and
 * returns ok=false if a penny is lost, so the loader can refuse a bad extract.
 * Anything not in ACCOUNT_MAP falls to its section default (never silently
 * dropped) and is reported in `unmapped` for review.
 */

export const ACCOUNT_MAP = {
  // Income -> Revenue
  "ST: Sales": "4000", "ST: Management Fee Income": "4000", "ST: Other Revenue": "4000", "ST: Interest Income": "4000",
  // Cost of sales -> COGS
  "ST: Cost of Goods Sold": "5000", "ST: Distribution Costs": "5000", "ST: Closing Stock (074) - Exp": "5000",
  "ST: Direct Wages": "5000", "ST: Clearance Provision": "5000",
  // Store labour
  "ST: Salaries - Basic Pay": "6000", "ST: Salaries - Holiday Pay": "6000", "ST: Employers National Insurance": "6000",
  "ST: Pensions Costs": "6000", "ST: Recruitment costs": "6000", "ST: Directors' Remuneration": "6000",
  "ST: Staff Uniform": "6000", "ST: Medical Insurance": "6000",
  // Occupancy & rent
  "ST: Rent": "6100", "ST: Rates": "6100", "ST: Service Charges": "6100", "ST: Utilities": "6100",
  "ST: Repairs & Maintenance": "6100", "ST: Cleaning": "6100", "ST: Light, Power, Heating": "6100", "ST: Building insurance": "6100",
  // Other store costs
  "ST: Merchant Charges": "6200", "ST: Computer & IT Expenses": "6200", "ST: Insurance": "6200",
  "ST: Telephone & Internet": "6200", "ST: Bank Charges": "6200", "ST: Subscriptions": "6200",
  "ST: Printing & Stationery": "6200", "ST: Mileage & Travelling": "6200", "ST: Advertising & Marketing": "6200",
  "Payment Fee": "6200", "ST: Packaging": "6200", "ST: Pick & Pack": "6200", "ST: Warehouse Storage": "6200",
  "ST: Transportation & Logistic": "6200", "ST: Miscellaneous Store Expenses": "6200", "ST: Office Expenses": "6200",
  "ST: Subsistence": "6200",
  // Central overheads
  "ST: Audit & Accountancy fees": "7000", "ST: Legal & Professional Fees": "7000", "ST: HO Management Fee": "7000",
  "ST: Management Fees": "7000", "ST: Business consultancy": "7000", "ST: Bank facility fee": "7000",
};

const SECTION_DEFAULT = { INCOME: "4000", COST_OF_SALES: "5000", EXPENSE: "7000" };
const OPEX = ["6000", "6100", "6200", "7000"];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/*
 * pnl: {
 *   income:      [{ name, balance }],
 *   costOfSales: [{ name, balance }],
 *   expenses:    [{ name, balance }],
 *   totals:      { income, costOfSales, expenses, netProfit },
 * }
 * Balances are positive magnitudes as Xero reports them.
 */
export function mapProfitAndLoss(pnl) {
  const buckets = {};
  const unmapped = [];
  const add = (code, amt) => { buckets[code] = round2((buckets[code] || 0) + amt); };
  const handle = (list, section, sign) => {
    for (const a of list || []) {
      const code = ACCOUNT_MAP[a.name] || SECTION_DEFAULT[section];
      if (!ACCOUNT_MAP[a.name] && Number(a.balance)) unmapped.push({ name: a.name, section, code });
      add(code, sign * Number(a.balance || 0));
    }
  };
  handle(pnl.income, "INCOME", 1);
  handle(pnl.costOfSales, "COST_OF_SALES", -1);
  handle(pnl.expenses, "EXPENSE", -1);

  const lines = Object.entries(buckets)
    .map(([account_code, amount_gbp]) => ({ account_code, amount_gbp: round2(amount_gbp) }))
    .filter((l) => l.amount_gbp !== 0)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

  const sumOf = (codes) => round2(lines.filter((l) => codes.includes(l.account_code)).reduce((s, l) => s + l.amount_gbp, 0));
  const income = sumOf(["4000"]);
  const cogs = round2(-sumOf(["5000"]));
  const expenses = round2(-sumOf(OPEX));
  const netProfit = round2(lines.reduce((s, l) => s + l.amount_gbp, 0));

  const t = pnl.totals || {};
  const near = (a, b) => Math.abs(round2((a || 0) - (b || 0))) <= 0.01;
  const reconciliation = {
    income, cogs, expenses, netProfit,
    ok: near(income, t.income) && near(cogs, t.costOfSales) && near(expenses, t.expenses) && near(netProfit, t.netProfit),
  };
  return { lines, reconciliation, unmapped };
}
