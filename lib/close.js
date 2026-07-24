import { query } from "./db";
import { audit, getFreshness } from "./governance";
import { getActiveSource } from "./finance-os";
import { getPreclose, getCloseActions } from "./preclose";
import { evaluatePlan } from "./close-plan-rules.js";

/*
 * Close orchestration — DB layer. Gathers the machine-checkable "signals" for a
 * period read-only, loads the human dispositions (run state + step overrides),
 * and hands both to the pure evaluator (close-plan-rules.js) to produce the
 * board the Close Cockpit and the CLOSE_STATUS agent render.
 *
 * Everything degrades cleanly: the close schema (migration 035) or the
 * pre-close tables (012) being absent (Postgres 42P01) never crashes a page —
 * those signals just read as unconfigured.
 */

const tableMissing = (e) => e?.code === "42P01";

// A period is 'YYYY-MM'. date_key is an int YYYYMMDD, so the month spans
// YYYYMM00 .. YYYYMM99 (inclusive of any day; DELETE-safe, no date math).
const periodBounds = (period) => {
  const ym = Number(period.replace("-", ""));
  return [ym * 100, ym * 100 + 99];
};
const dkToPeriod = (dk) => `${String(dk).slice(0, 4)}-${String(dk).slice(4, 6)}`;

// Exceptions counted as resolved once a reviewer has confirmed or explained
// them; CORRECTING (still being worked) and undispositioned both stay open.
const RESOLVED = new Set(["CONFIRMED", "EXPLAINED"]);

// The latest loaded period, or null if nothing is loaded.
export async function latestPeriod() {
  const src = await getActiveSource();
  const { rows } = await query(
    `SELECT MAX(date_key) AS dk FROM finance.fact_financials WHERE source_system = $1`, [src]
  );
  return rows[0]?.dk ? dkToPeriod(rows[0].dk) : null;
}

// Recent loaded periods (most recent first) for the period selector.
export async function listPeriods(limit = 12) {
  const src = await getActiveSource();
  const { rows } = await query(
    `SELECT DISTINCT (date_key / 100) AS ym FROM finance.fact_financials
     WHERE source_system = $1 ORDER BY ym DESC LIMIT $2`, [src, limit]
  );
  return rows.map((r) => dkToPeriod(r.ym * 100));
}

// ---------------------------------------------------------------- signals
export async function getSignals(period) {
  const src = await getActiveSource();
  const [lo, hi] = periodBounds(period);

  // 1. Actuals loaded for the period.
  const { rows: aRows } = await query(
    `SELECT count(*)::int AS n FROM finance.fact_financials
     WHERE source_system = $1 AND date_key BETWEEN $2 AND $3`, [src, lo, hi]
  );
  const actuals = { loaded: aRows[0].n > 0, rows: aRows[0].n };

  // 2. Feed freshness.
  const fresh = await getFreshness(null);
  const ageDays = fresh ? Math.floor((Date.now() - new Date(fresh.completed_at).getTime()) / 86400000) : null;
  const freshness = { ageDays, source: fresh?.source_system || null };

  // 3. Pre-close exceptions (only meaningful when the engine's latest period is
  //    the one we're closing — otherwise mark unconfigured).
  let preclose = { ready: false };
  try {
    const pre = await getPreclose({ monthsCovered: 6 });
    if (pre.ready && pre.period === period) {
      const ex = pre.exceptions || [];
      const isOpen = (e) => !e.review || !RESOLVED.has(e.review.status);
      preclose = {
        ready: true,
        total: ex.length,
        high: ex.filter((e) => e.severity === "HIGH").length,
        unresolved: ex.filter(isOpen).length,
        unresolvedHigh: ex.filter((e) => e.severity === "HIGH" && isOpen(e)).length,
        assured: pre.assured || 0,
        revenueActual: pre.revenueActual || 0,
      };
    }
  } catch (e) { if (!tableMissing(e)) throw e; }

  // 4. Workstream playbook completion.
  const playbook = { PL: { done: 0, total: 0 }, ACCRUALS: { done: 0, total: 0 }, FA: { done: 0, total: 0 } };
  try {
    for (const r of await getCloseActions(period)) {
      const w = playbook[r.workstream];
      if (!w) continue;
      w.total++;
      if (r.done) w.done++;
    }
  } catch (e) { if (!tableMissing(e)) throw e; }

  // 5. Month-end tasks due in the period.
  let tasks = { open: 0, overdueCritical: 0, total: 0 };
  try {
    const start = `${period}-01`;
    const { rows } = await query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status NOT IN ('COMPLETE','CANCELLED'))::int AS open,
              count(*) FILTER (WHERE status = 'OVERDUE' AND priority = 'CRITICAL')::int AS crit
       FROM workflow.task_instance
       WHERE due_date >= $1::date AND due_date < ($1::date + interval '1 month')`, [start]
    );
    tasks = { total: rows[0].total, open: rows[0].open, overdueCritical: rows[0].crit };
  } catch (e) { if (!tableMissing(e)) throw e; }

  // 6. Trading commentary drafted for the period.
  let commentary = { exists: false, approved: false };
  try {
    const { rows } = await query(
      `SELECT count(*) FILTER (WHERE o.lifecycle <> 'AUTOMATED_VALIDATION')::int AS n,
              count(*) FILTER (WHERE o.lifecycle IN ('APPROVED','AMENDED'))::int AS approved
       FROM agent.agent_output o JOIN agent.agent_run ar ON ar.run_id = o.run_id
       WHERE ar.agent_code = 'TRADING_COMMENTARY' AND to_char(ar.started_at, 'YYYY-MM') = $1`, [period]
    );
    commentary = { exists: rows[0].n > 0, approved: rows[0].approved > 0 };
  } catch (e) { if (!tableMissing(e)) throw e; }

  const run = await getCloseRun(period);
  const locked = run?.status === "LOCKED";

  return { period, actuals, freshness, preclose, playbook, tasks, commentary, locked };
}

// ---------------------------------------------------------------- run state
export async function getCloseRun(period) {
  try {
    const { rows } = await query(`SELECT * FROM close.close_run WHERE period = $1`, [period]);
    return rows[0] || null;
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

export async function getOverrides(period) {
  try {
    const { rows } = await query(
      `SELECT step_code, status, note, actor, created_at FROM close.close_step_override WHERE period = $1`, [period]
    );
    const map = {};
    for (const r of rows) map[r.step_code] = { status: r.status, note: r.note, actor: r.actor, at: r.created_at };
    return map;
  } catch (e) {
    if (tableMissing(e)) return {};
    throw e;
  }
}

export async function openCloseRun(period, actor) {
  await query(
    `INSERT INTO close.close_run (period, status, opened_by) VALUES ($1, 'OPEN', $2)
     ON CONFLICT (period) DO UPDATE SET status = CASE WHEN close.close_run.status = 'LOCKED' THEN 'REOPENED' ELSE close.close_run.status END,
                                        updated_at = CURRENT_TIMESTAMP`,
    [period, actor]
  );
  await audit({ actor, eventType: "close.open", objectType: "close_run", objectRef: period });
  return getCloseRun(period);
}

export async function lockClose(period, actor, note) {
  // Ensure a run exists, then lock it.
  await query(
    `INSERT INTO close.close_run (period, status, opened_by) VALUES ($1, 'OPEN', $2)
     ON CONFLICT (period) DO NOTHING`, [period, actor]
  );
  await query(
    `UPDATE close.close_run SET status = 'LOCKED', locked_by = $2, locked_at = CURRENT_TIMESTAMP,
            note = COALESCE($3, note), updated_at = CURRENT_TIMESTAMP WHERE period = $1`,
    [period, actor, note || null]
  );
  await audit({ actor, eventType: "close.lock", objectType: "close_run", objectRef: period, detail: { note: note || null } });
  return getCloseRun(period);
}

export async function reopenClose(period, actor, note) {
  await query(
    `UPDATE close.close_run SET status = 'REOPENED', locked_by = NULL, locked_at = NULL,
            note = COALESCE($3, note), updated_at = CURRENT_TIMESTAMP WHERE period = $1`,
    [period, actor, note || null]
  );
  await audit({ actor, eventType: "close.reopen", objectType: "close_run", objectRef: period, detail: { note: note || null } });
  return getCloseRun(period);
}

// Set (or clear) a human disposition on a step. status 'CLEAR' removes it.
export async function setStepOverride({ period, stepCode, status, note, actor }) {
  if (status === "CLEAR") {
    await query(`DELETE FROM close.close_step_override WHERE period = $1 AND step_code = $2`, [period, stepCode]);
  } else {
    await query(
      `INSERT INTO close.close_step_override (period, step_code, status, note, actor)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (period, step_code) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
                     actor = EXCLUDED.actor, created_at = CURRENT_TIMESTAMP`,
      [period, stepCode, status, note || null, actor]
    );
  }
  await audit({ actor, eventType: "close.step", objectType: "close_step", objectRef: `${period}·${stepCode}`, detail: { status } });
}

// ---------------------------------------------------------------- board
export async function getCloseBoard(periodArg) {
  const period = periodArg || (await latestPeriod());
  if (!period) return { ready: false, period: null, run: null, signals: null, plan: null, periods: [] };
  const [signals, overrides, periods] = await Promise.all([getSignals(period), getOverrides(period), listPeriods()]);
  const run = await getCloseRun(period);
  const plan = evaluatePlan(signals, overrides);
  return { ready: true, period, run, signals, plan, periods };
}
