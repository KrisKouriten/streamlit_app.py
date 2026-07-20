import { query } from "./db";
import { audit } from "./governance";
import { runChecks, parseExpectationsCsv } from "./preclose-rules.js";

/*
 * Management accounts close — DB layer. Reads the real Xero actuals for the
 * latest loaded period, runs the pure pre-close checks against the reference
 * model, merges in the review log, and manages the playbook action states.
 */

const dkToPeriod = (dk) => `${String(dk).slice(0, 4)}-${String(dk).slice(4, 6)}`;

export async function getPreclose({ monthsCovered = 6 } = {}) {
  const { rows: dkRows } = await query(
    `SELECT MAX(date_key) AS dk FROM finance.fact_financials WHERE source_system = 'XERO'`
  );
  const dk = dkRows[0]?.dk;
  const period = dk ? dkToPeriod(dk) : null;

  const [{ rows: actuals }, { rows: expectations }] = await Promise.all([
    dk
      ? query(
          `SELECT a.account_code, a.account_name, a.natural_sign, SUM(f.amount_gbp) AS amount
           FROM finance.fact_financials f
           JOIN core.dim_account a ON a.account_id = f.account_id
           WHERE f.source_system = 'XERO' AND f.date_key = $1
           GROUP BY a.account_code, a.account_name, a.natural_sign
           ORDER BY a.account_code`,
          [dk]
        )
      : Promise.resolve({ rows: [] }),
    query(
      `SELECT account_code, behaviour, monthly_amount, pct_of_revenue,
              tolerance_pct, tolerance_abs, expected_every_period, source, is_active
       FROM finance.nominal_expectation WHERE is_active ORDER BY account_code`
    ),
  ]);

  const result = runChecks({ actuals, expectations, monthsCovered });

  // Attach account names from the expectation-only exceptions where missing.
  const reviews = period
    ? (await query(
        `SELECT account_code, check_code, status, note, actor, created_at
         FROM finance.preclose_review WHERE period = $1`,
        [period]
      )).rows
    : [];
  const rkey = (r) => `${r.account_code}|${r.check_code}`;
  const reviewMap = new Map(reviews.map((r) => [rkey(r), r]));
  const exceptions = result.exceptions.map((e) => ({
    ...e,
    review: reviewMap.get(`${e.account_code}|${e.check}`) || null,
  }));

  return { period, dk, actuals, expectations, ...result, exceptions };
}

export async function reviewException({ period, accountCode, check, status, note, actor }) {
  await query(
    `INSERT INTO finance.preclose_review (period, account_code, check_code, status, note, actor)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (period, account_code, check_code)
     DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, actor = EXCLUDED.actor,
                   created_at = CURRENT_TIMESTAMP`,
    [period, accountCode, check, status, note || null, actor]
  );
  await audit({ actor, eventType: "preclose.review", objectType: "preclose_exception",
    objectRef: `${period}·${accountCode}·${check}`, detail: { status, note } });
}

export async function getCloseActions(period) {
  const { rows } = await query(
    `SELECT a.action_id, a.workstream, a.label, a.sort,
            COALESCE(s.done, false) AS done, s.done_by, s.done_at
     FROM finance.ma_close_action a
     LEFT JOIN finance.ma_close_action_state s ON s.action_id = a.action_id AND s.period = $1
     ORDER BY a.workstream, a.sort`,
    [period]
  );
  return rows;
}

export async function toggleCloseAction({ actionId, period, done, actor }) {
  await query(
    `INSERT INTO finance.ma_close_action_state (action_id, period, done, done_by, done_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT (action_id, period)
     DO UPDATE SET done = EXCLUDED.done, done_by = EXCLUDED.done_by,
                   done_at = CASE WHEN EXCLUDED.done THEN CURRENT_TIMESTAMP ELSE NULL END`,
    [actionId, period, !!done, actor]
  );
  await audit({ actor, eventType: "preclose.action", objectType: "ma_close_action",
    objectRef: `${period}·${actionId}`, detail: { done: !!done } });
}

// Replace the active reference model with an uploaded schedule.
export async function ingestExpectations(csvText, actor) {
  const { records, errors } = parseExpectationsCsv(csvText);
  if (!records.length) {
    const reason = errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).map((e) => `row ${e.row} ${e.reason}`).join("; ")}` : "no valid rows";
    throw new Error(`Reference model not loaded — ${reason}`);
  }
  await query(`UPDATE finance.nominal_expectation SET is_active = false WHERE is_active`);
  for (const r of records) {
    await query(
      `INSERT INTO finance.nominal_expectation
        (account_code, behaviour, monthly_amount, pct_of_revenue, tolerance_pct, tolerance_abs, expected_every_period, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'SCHEDULE · uploaded by finance')`,
      [r.account_code, r.behaviour, r.monthly_amount, r.pct_of_revenue, r.tolerance_pct, r.tolerance_abs, r.expected_every_period]
    );
  }
  await audit({ actor, eventType: "preclose.model", objectType: "nominal_expectation",
    objectRef: "reference-model", detail: { loaded: records.length, rowErrors: errors.length } });
  return { loaded: records.length, errors };
}
