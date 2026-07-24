import { getJoiinPnl } from "./joiin.js";
import { bsMonths, bsRows, getBalanceSheet } from "./joiin-bs.js";
import { indirectCashFlow } from "./threestatement-rules.js";

/*
 * Three-statement assembler. Pulls the consolidated P&L (net result) and the
 * balance sheet, and — where two consecutive month-end balance sheets exist —
 * derives the indirect cash-flow statement that links them. Read-only; the
 * linking maths is the pure engine in threestatement-rules.js.
 */

// Previous YYYY-MM.
export function prevYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function getThreeStatement(ymArg) {
  const [pnl, months] = await Promise.all([getJoiinPnl(), bsMonths()]);
  const bsReady = months.length > 0;

  // Months where a cash flow can be derived: a BS this month AND last month.
  const cfMonths = months.filter((m) => months.includes(prevYm(m)));
  const ym = (ymArg && months.includes(ymArg)) ? ymArg
    : cfMonths[0] || months[0]
    || (pnl.loaded && pnl.months?.length ? pnl.months[pnl.months.length - 1] : null);

  const bs = ym ? await getBalanceSheet(ym) : { ready: bsReady, loaded: false, months };

  let cf = null;
  const prev = ym ? prevYm(ym) : null;
  if (ym && months.includes(ym) && prev && months.includes(prev)) {
    const [closing, opening] = await Promise.all([bsRows(ym), bsRows(prev)]);
    const netProfit = pnl.loaded && pnl.computed ? Number(pnl.computed.netProfit.months[ym] || 0) : 0;
    const hasPnl = !!(pnl.loaded && pnl.computed && pnl.computed.netProfit.months[ym] != null);
    cf = { ...indirectCashFlow({ netProfit, opening, closing }), period: ym, openingPeriod: prev, hasPnl };
  }

  return { ym, prev, months, cfMonths, bsReady, pnl, bs, cf };
}
