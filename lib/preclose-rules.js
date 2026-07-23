/*
 * Pre-close checks — pure, unit-testable. Implements the three checks from the
 * Management Accounts month-end process, plus a sign-consistency anomaly:
 *   A  Completeness — expected nominals with no posting (accrual likely), and
 *      postings with no expectation (new / unexpected nominal).
 *   B  Variable drift — variable nominals re-derived from the revenue driver.
 *   C  Fixed drift — fixed nominals compared line-by-line to the schedule.
 * Amounts are compared as magnitudes; the ledger's natural sign is checked
 * separately. Expectations are monthly; monthsCovered scales them to the period.
 */

import { parseCsv } from "./intercompany-rules.js";

export const CHECKS = {
  A: { code: "A", label: "Completeness", blurb: "Expected nominals present; nothing new unexplained" },
  B: { code: "B", label: "Variable drift", blurb: "Variable costs re-derived from the revenue driver" },
  C: { code: "C", label: "Fixed drift", blurb: "Fixed costs line-by-line against the schedule" },
  SIGN: { code: "SIGN", label: "Sign consistency", blurb: "Postings on the natural side of the account" },
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[£$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// actuals: [{ account_code, account_name, natural_sign, amount }]
// expectations: [{ account_code, behaviour, monthly_amount, pct_of_revenue,
//                  tolerance_pct, tolerance_abs, expected_every_period, is_active }]
export function runChecks({ actuals = [], expectations = [], monthsCovered = 1 }) {
  const months = Math.max(1, Number(monthsCovered) || 1);
  const exp = expectations.filter((e) => e.is_active !== false);
  const byCode = new Map(actuals.map((a) => [a.account_code, a]));
  const expByCode = new Map(exp.map((e) => [e.account_code, e]));

  const revenueActual = exp
    .filter((e) => e.behaviour === "REVENUE")
    .reduce((s, e) => s + Math.abs(Number(byCode.get(e.account_code)?.amount || 0)), 0);

  const exceptions = [];
  let assured = 0;

  const flag = (check, a, e, actual, expected, severity, hint) => {
    const varianceAbs = actual - expected;
    exceptions.push({
      check, account_code: a?.account_code ?? e?.account_code,
      account_name: a?.account_name ?? e?.account_name ?? null,
      actual, expected,
      varianceAbs,
      variancePct: expected ? varianceAbs / expected : null,
      severity, hint,
    });
  };

  for (const e of exp) {
    const a = byCode.get(e.account_code);
    const actualMag = Math.abs(Number(a?.amount || 0));

    // A — expected but absent / zero
    if ((!a || actualMag === 0) && e.expected_every_period !== false) {
      flag("A", a, e, 0, expectedFor(e, months, revenueActual), "HIGH",
        e.behaviour === "FIXED"
          ? "No posting this period against a scheduled fixed cost — accrual likely required."
          : "No posting this period — confirm, or raise an accrual.");
      continue;
    }
    if (!a) continue;

    // B — variable drift vs the revenue driver
    if (e.behaviour === "VARIABLE" && e.pct_of_revenue != null && revenueActual > 0) {
      const expected = Math.abs(Number(e.pct_of_revenue)) * revenueActual;
      if (outsideTolerance(actualMag, expected, e)) {
        flag("B", a, e, actualMag, expected, sevFor(actualMag, expected, e),
          actualMag < expected
            ? "Below the driver-derived expectation — under-posted, or an accrual is missing."
            : "Above the driver-derived expectation — check rate, mispostings or one-offs.");
      } else assured++;
      continue;
    }

    // C — fixed drift vs the schedule
    if (e.behaviour === "FIXED" && e.monthly_amount != null) {
      const expected = Math.abs(Number(e.monthly_amount)) * months;
      if (outsideTolerance(actualMag, expected, e)) {
        flag("C", a, e, actualMag, expected, sevFor(actualMag, expected, e),
          actualMag < expected
            ? "Below the fixed schedule — timing, a missing charge, or an accrual top-up."
            : "Above the fixed schedule — timing, duplicate posting or a misposting.");
      } else assured++;
      continue;
    }

    assured++; // REVENUE lines (driver) and expectations with no basis to test
  }

  // A — posted but not in the expectation set
  for (const a of actuals) {
    if (Number(a.amount) !== 0 && !expByCode.has(a.account_code)) {
      flag("A", a, null, Math.abs(Number(a.amount)), 0, "MEDIUM",
        "Nominal not in the reference model — confirm it belongs, then add it to the model.");
    }
  }

  // SIGN — posting against the account's natural side
  for (const a of actuals) {
    const amt = Number(a.amount || 0);
    const nat = Number(a.natural_sign || 0);
    if (amt !== 0 && nat !== 0 && Math.sign(amt) !== Math.sign(nat)) {
      flag("SIGN", a, null, amt, nat * Math.abs(amt), "HIGH",
        nat > 0 ? "Revenue account carrying a debit balance — check for mispostings."
                : "Cost account carrying a credit balance — reversal, rebate or misposting?");
    }
  }

  const order = { HIGH: 0, MEDIUM: 1 };
  exceptions.sort((x, y) => (order[x.severity] - order[y.severity]) || String(x.account_code).localeCompare(String(y.account_code)));
  return { exceptions, assured, revenueActual, monthsCovered: months };
}

function expectedFor(e, months, revenueActual) {
  if (e.behaviour === "FIXED" && e.monthly_amount != null) return Math.abs(Number(e.monthly_amount)) * months;
  if (e.behaviour === "VARIABLE" && e.pct_of_revenue != null) return Math.abs(Number(e.pct_of_revenue)) * revenueActual;
  return 0;
}
function outsideTolerance(actual, expected, e) {
  const gap = Math.abs(actual - expected);
  const pctTol = Math.abs(Number(e.tolerance_pct ?? 0.1));
  const absTol = Math.abs(Number(e.tolerance_abs ?? 0));
  return gap > absTol && (expected === 0 ? gap > absTol : gap / expected > pctTol);
}
function sevFor(actual, expected, e) {
  const gap = Math.abs(actual - expected);
  return expected > 0 && gap / expected > 3 * Math.abs(Number(e.tolerance_pct ?? 0.1)) ? "HIGH" : "MEDIUM";
}

// --- Reference-model CSV: Account Code, Behaviour, Monthly Amount, % of Revenue,
//     Tolerance %, Tolerance £, Expected Every Period -------------------------
export const EXPECTATION_CSV_TEMPLATE =
  "Account Code,Behaviour,Monthly Amount,% of Revenue,Tolerance %,Tolerance £,Expected Every Period";

export function mapExpectationRows(headers, records) {
  const h = headers.map((x) => x.toLowerCase().trim());
  const col = (frag) => { const i = h.findIndex((x) => x.includes(frag)); return i < 0 ? null : headers[i]; };
  const cCode = col("account"), cBeh = col("behaviour"), cMonthly = col("monthly"),
    cPct = col("% of revenue"), cTolPct = col("tolerance %"), cTolAbs = col("tolerance £") || col("tolerance gbp"),
    cEvery = col("every period");
  const out = [], errors = [];
  records.forEach((r, idx) => {
    const code = cCode ? String(r[cCode] || "").trim() : "";
    const behaviour = cBeh ? String(r[cBeh] || "").trim().toUpperCase() : "";
    if (!code || !["REVENUE", "VARIABLE", "FIXED"].includes(behaviour)) {
      errors.push({ row: idx + 2, reason: !code ? "missing account code" : `behaviour must be REVENUE, VARIABLE or FIXED` });
      return;
    }
    const monthly = cMonthly ? num(r[cMonthly]) : null;
    let pct = cPct ? num(r[cPct]) : null;
    if (pct != null && pct > 1) pct = pct / 100; // accept 40 or 0.40
    if (behaviour === "FIXED" && monthly == null) { errors.push({ row: idx + 2, reason: "FIXED lines need a Monthly Amount" }); return; }
    if (behaviour === "VARIABLE" && pct == null) { errors.push({ row: idx + 2, reason: "VARIABLE lines need a % of Revenue" }); return; }
    let tolPct = cTolPct ? num(r[cTolPct]) : null;
    if (tolPct != null && tolPct > 1) tolPct = tolPct / 100;
    out.push({
      account_code: code, behaviour,
      monthly_amount: behaviour === "FIXED" ? Math.abs(monthly) : null,
      pct_of_revenue: behaviour === "VARIABLE" ? Math.abs(pct) : null,
      tolerance_pct: tolPct ?? 0.10,
      tolerance_abs: Math.abs((cTolAbs ? num(r[cTolAbs]) : null) ?? 1000),
      expected_every_period: cEvery ? !/^(n|no|false|0)$/i.test(String(r[cEvery] || "").trim() || "yes") : true,
    });
  });
  return { records: out, errors };
}

export function parseExpectationsCsv(text) {
  const { headers, records } = parseCsv(text);
  return mapExpectationRows(headers, records);
}
