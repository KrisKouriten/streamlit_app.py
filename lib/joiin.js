import { query } from "./db";
import { summariseJoiinPnl } from "./joiin-rules.js";

/*
 * Joiin consolidated P&L — DB read layer. Full account detail lives in
 * finance.joiin_pl (loaded from the Joiin MCP connector in a refresh session);
 * this shapes it into a structured P&L for the Management Accounts consolidated
 * view. Sections carry subtotals; Gross Profit / Operating Profit / Net Profit
 * are derived from section totals.
 */

const tableMissing = (e) => e?.code === "42P01";
const SECTION_ORDER = ["Revenue", "Cost of Sales", "Expenses", "Other Income", "Other Expenses"];

export async function getJoiinPnl() {
  let rows;
  try {
    ({ rows } = await query(`SELECT section, account, ym, value FROM finance.joiin_pl`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };

  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const sum = (mm) => months.reduce((t, m) => t + (mm[m] || 0), 0);

  // group accounts by section
  const bySection = {};
  for (const r of rows) {
    const s = (bySection[r.section] ||= {});
    (s[r.account] ||= {})[r.ym] = (s[r.account]?.[r.ym] || 0) + Number(r.value);
  }
  const sections = SECTION_ORDER.filter((name) => bySection[name]).map((name) => {
    const accs = Object.entries(bySection[name])
      .map(([account, mm]) => ({ account, months: mm, total: sum(mm) }))
      .filter((a) => a.total !== 0 || months.some((m) => a.months[m]))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const totalMonths = {};
    for (const m of months) totalMonths[m] = accs.reduce((t, a) => t + (a.months[m] || 0), 0);
    return { name, rows: accs, total: { months: totalMonths, total: sum(totalMonths) } };
  });

  const secTotal = (name) => sections.find((s) => s.name === name)?.total.months || {};
  const perMonth = (fn) => Object.fromEntries(months.map((m) => [m, fn(m)]));
  const rev = secTotal("Revenue"), cos = secTotal("Cost of Sales"), exp = secTotal("Expenses"), oi = secTotal("Other Income"), oe = secTotal("Other Expenses");
  const grossProfit = perMonth((m) => (rev[m] || 0) - (cos[m] || 0));
  const operatingProfit = perMonth((m) => grossProfit[m] - (exp[m] || 0));
  const netProfit = perMonth((m) => operatingProfit[m] + (oi[m] || 0) - (oe[m] || 0));
  const computed = {
    grossProfit: { months: grossProfit, total: sum(grossProfit) },
    operatingProfit: { months: operatingProfit, total: sum(operatingProfit) },
    netProfit: { months: netProfit, total: sum(netProfit) },
  };

  return { ready: true, loaded: true, months, sections, computed };
}
