import { getBoardPack } from "./joiin-boardpack.js";
import { bsMonths, bsRows, getBalanceSheet } from "./joiin-bs.js";
import { indirectCashFlow, boardPackNetProfit } from "./threestatement-rules.js";

/*
 * Three-statement assembler. The P&L is the consolidated Joiin board pack (the
 * same intercompany-eliminated source that powers Management Accounts, and the
 * one the refresh route actually populates — finance.joiin_boardpack). The
 * balance sheet is finance.joiin_bs; where two consecutive month-end balance
 * sheets exist the indirect cash flow is derived and reconciled to the actual
 * change in cash. Read-only.
 */

export function prevYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function getThreeStatement(ymArg) {
  const months = await bsMonths();
  const bsReady = months.length > 0;
  const cfMonths = months.filter((m) => months.includes(prevYm(m)));
  const ym = (ymArg && months.includes(ymArg)) ? ymArg : cfMonths[0] || months[0] || null;

  // P&L from the consolidated board pack for the year covering ym.
  const year = ym ? ym.slice(0, 4) : null;
  const bp = await getBoardPack("consolidated", year);
  const pnlRows = bp.loaded ? bp.rows : [];
  const pnl = { loaded: bp.loaded, months: bp.months || [], rows: pnlRows };

  const bs = ym ? await getBalanceSheet(ym) : { ready: bsReady, loaded: false, months };

  let cf = null;
  const prev = ym ? prevYm(ym) : null;
  if (ym && months.includes(ym) && prev && months.includes(prev)) {
    const [closing, opening] = await Promise.all([bsRows(ym), bsRows(prev)]);
    const netProfit = pnl.loaded ? boardPackNetProfit(pnlRows, ym) : 0;
    const hasPnl = pnl.loaded && pnlRows.some((r) => r.values?.[ym] != null);
    cf = { ...indirectCashFlow({ netProfit, opening, closing }), period: ym, openingPeriod: prev, hasPnl };
  }

  return { ym, prev, months, cfMonths, bsReady, pnl, bs, cf };
}
