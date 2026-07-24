/*
 * Three-statement model — pure rules. No imports, no DB, no clock; the caller
 * supplies the P&L net result and the opening/closing balance sheets (as-at
 * balances) and these functions link them into an indirect cash-flow statement.
 * Unit-tested in tests/threestatement.test.mjs.
 *
 * Integrity is the point. The cash flow is not invented — it is the balance-
 * sheet movement re-expressed, and it is reconciled to the actual movement in
 * cash on the balance sheet. Any residual (a balance sheet that doesn't balance,
 * or a mis-classified line) is surfaced, never hidden.
 *
 * The identity that makes this exact: Assets = Liabilities + Equity, so
 *   ΔCash = ΔLiabilities + ΔEquity − Δ(non-cash Assets)
 * and since retained earnings move by the period's net result, the net result
 * lands in operating and the rest of the equity movement (share issues,
 * dividends) lands in financing. Grouped into operating / investing / financing,
 * the three sub-totals sum to the actual change in cash by construction.
 */

export const SIDE = { ASSET: "ASSET", LIABILITY: "LIABILITY", EQUITY: "EQUITY" };
export const CATEGORY = { OPERATING: "OPERATING", INVESTING: "INVESTING", FINANCING: "FINANCING", CASH: "CASH" };

// Keyword heuristics used to classify a balance-sheet line by its section +
// account name. Deliberately overridable later (a cf_map table) — for now these
// defaults cover a standard UK retail chart of accounts. First match wins.
const EQUITY_KWORDS = ["equity", "capital and reserves", "capital & reserves", "share capital", "share premium", "retained", "reserves", "shareholder", "profit and loss account", "current year earnings"];
const FINANCING_LIAB_KWORDS = ["loan", "borrowing", "overdraft", "lease liability", "hire purchase", "finance lease", "debenture", "director's loan", "directors loan", "intercompany loan"];
const INVESTING_ASSET_KWORDS = ["fixed asset", "tangible", "intangible", "goodwill", "property", "plant", "equipment", "machinery", "motor vehicle", "furniture", "fixture", "fitting", "leasehold", "freehold", "right-of-use", "right of use", "investment", "capital work"];
const CASH_KWORDS = ["cash", "bank", "petty cash", "current account", "deposit account"];

const has = (text, kws) => kws.some((k) => text.includes(k));

// Classify a balance-sheet line → { side, category }. side is ASSET / LIABILITY
// / EQUITY; category places its movement in the cash flow.
export function classifyBsLine(section, account) {
  const text = `${section || ""} ${account || ""}`.toLowerCase();

  if (has(text, EQUITY_KWORDS) && !text.includes("investment")) {
    return { side: SIDE.EQUITY, category: CATEGORY.FINANCING };
  }
  // Liability side: explicit liability keywords, or a "liabilit/creditor/payable" section.
  const looksLiability = /liabilit|creditor|payable|accrual|provision|deferred|tax|vat|paye|pension payable/.test(text) || has(text, FINANCING_LIAB_KWORDS);
  if (looksLiability) {
    return { side: SIDE.LIABILITY, category: has(text, FINANCING_LIAB_KWORDS) ? CATEGORY.FINANCING : CATEGORY.OPERATING };
  }
  // Asset side (default).
  if (has(text, CASH_KWORDS) && !text.includes("overdraft")) {
    return { side: SIDE.ASSET, category: CATEGORY.CASH };
  }
  if (has(text, INVESTING_ASSET_KWORDS)) {
    return { side: SIDE.ASSET, category: CATEGORY.INVESTING };
  }
  return { side: SIDE.ASSET, category: CATEGORY.OPERATING };
}

// Index [{section, account, value}] by "section|account" → number.
function indexBs(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = `${r.section}|${r.account}`;
    m.set(k, (m.get(k) || 0) + Number(r.value || 0));
  }
  return m;
}

// Balance-sheet integrity at a point: does Assets = Liabilities + Equity?
export function balanceCheck(rows) {
  let assets = 0, liabilities = 0, equity = 0;
  for (const r of rows || []) {
    const { side } = classifyBsLine(r.section, r.account);
    const v = Number(r.value || 0);
    if (side === SIDE.ASSET) assets += v;
    else if (side === SIDE.LIABILITY) liabilities += v;
    else equity += v;
  }
  const diff = assets - (liabilities + equity);
  return { assets, liabilities, equity, diff, balances: Math.abs(diff) < 1 };
}

// Per-line movement between two balance sheets, classified. delta = closing −
// opening. cashImpact expresses that movement as a cash flow: an asset rising
// consumes cash (−), a liability/equity rising releases cash (+).
export function bsMovements(opening, closing) {
  const o = indexBs(opening), c = indexBs(closing);
  const keys = new Set([...o.keys(), ...c.keys()]);
  const out = [];
  for (const k of keys) {
    const [section, account] = k.split("|");
    const openv = o.get(k) || 0, closev = c.get(k) || 0;
    const delta = closev - openv;
    const { side, category } = classifyBsLine(section, account);
    const cashImpact = side === SIDE.ASSET ? -delta : delta;
    out.push({ section, account, side, category, opening: openv, closing: closev, delta, cashImpact });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

/*
 * Build the indirect cash-flow statement linking the P&L net result to the
 * balance-sheet movement, and reconcile it to the actual movement in cash.
 * Returns the three sections (each with its lines + subtotal), the net
 * movement, opening/closing cash, and the reconciliation residual.
 */
export function indirectCashFlow({ netProfit = 0, opening = [], closing = [] }) {
  const moves = bsMovements(opening, closing);
  const np = Number(netProfit) || 0;

  const cashLines = moves.filter((m) => m.category === CATEGORY.CASH);
  const openingCash = sum(cashLines, (m) => m.opening);
  const closingCash = sum(cashLines, (m) => m.closing);
  const actualMovement = closingCash - openingCash;

  // Operating: net result + working-capital movements (operating assets/liabs).
  const opLines = moves.filter((m) => m.category === CATEGORY.OPERATING);
  const operatingTotal = np + sum(opLines, (m) => m.cashImpact);

  // Investing: non-current asset movements (and any investing liabilities).
  const invLines = moves.filter((m) => m.category === CATEGORY.INVESTING);
  const investingTotal = sum(invLines, (m) => m.cashImpact);

  // Financing: financing liabilities + the equity movement not explained by the
  // net result (share issues, dividends). Retained earnings moving by the net
  // result is already carried in operating, so it is netted out here.
  const finLiabLines = moves.filter((m) => m.category === CATEGORY.FINANCING && m.side === SIDE.LIABILITY);
  const equityLines = moves.filter((m) => m.side === SIDE.EQUITY);
  const equityMovement = sum(equityLines, (m) => m.delta);
  const otherEquityMovement = equityMovement - np; // ex the net result
  const financingTotal = sum(finLiabLines, (m) => m.cashImpact) + otherEquityMovement;

  const netMovement = operatingTotal + investingTotal + financingTotal;
  const residual = netMovement - actualMovement;

  return {
    operating: {
      netProfit: np,
      workingCapital: opLines,
      total: operatingTotal,
    },
    investing: { lines: invLines, total: investingTotal },
    financing: { liabilities: finLiabLines, otherEquityMovement, total: financingTotal },
    netMovement,
    openingCash,
    closingCash,
    actualMovement,
    residual,
    reconciles: Math.abs(residual) < 1,
  };
}

// The period's net result, read from a consolidated board-pack's rows (the
// Joiin-eliminated group figure) — the number the indirect cash flow bridges
// from. Prefers the "net profit / group net" computed line.
export function boardPackNetProfit(rows, ym) {
  const r = (rows || []).find((x) => (x.kind === "calc" || x.kind === "computed") && /net profit|group net/i.test(x.label));
  return r ? Number(r.values?.[ym] || 0) : 0;
}
