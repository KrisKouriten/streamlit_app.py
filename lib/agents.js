import { query } from "./db";
import { audit, getFreshness } from "./governance";
import { validateOutput } from "./agent-rules.js";

export { LIFECYCLE, DECISIONS, reviewError, validateOutput, AGENT_DASHBOARD } from "./agent-rules.js";

/*
 * Agent runner. Guardrails are structural: implementations receive a read-only
 * SELECT helper; the only writes happen here, into agent.* tables. There is no
 * code path for posting journals, releasing payments, changing forecasts or
 * sending communications — see agent.agent_control for the visible switches.
 */

const selectOnly = async (sql, params) => {
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error("Agent implementations may only SELECT");
  return query(sql, params);
};

// ---------------------------------------------------------------- agents
const IMPLEMENTATIONS = {
  // Scan store YTD KPIs vs last year; flag stores needing attention.
  STORE_PRIORITIES: async (ctx) => {
    const { rows: win } = await selectOnly(
      `SELECT MAX(d.calendar_date) AS max_date
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       JOIN core.dim_date d ON d.date_key = s.date_key
       WHERE sc.scenario_type='ACTUAL' AND st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER'`
    );
    if (!win[0].max_date) throw new Error("No store trading data loaded");
    const maxIso = win[0].max_date instanceof Date ? win[0].max_date.toISOString().slice(0, 10) : String(win[0].max_date).slice(0, 10);
    const dk = (iso) => Number(iso.replace(/-/g, ""));
    const year = Number(maxIso.slice(0, 4));
    const cyFrom = dk(`${year}-01-01`), cyTo = dk(maxIso);
    const pyFrom = dk(`${year - 1}-01-01`);
    const pyToIso = new Date(new Date(maxIso + "T00:00:00Z").getTime() - 365 * 86400000).toISOString().slice(0, 10);
    ctx.plan(`Compare each store's YTD (01/01/${year} – ${maxIso}) with the same dates last year on the governed KPI definitions; flag breaches and rank by annualised impact.`);
    ctx.period(`${year}-01-01`, maxIso);

    const { rows } = await ctx.step("Compute per-store YTD KPIs vs last year", () => selectOnly(
      `WITH cy AS (
         SELECT st.store_id, st.store_code, st.store_name, st.operator_name, st.first_trading_date,
                SUM(s.net_sales) net, SUM(s.transactions) trans, SUM(s.footfall) ff, SUM(s.return_value) ret
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id
         WHERE sc.scenario_type='ACTUAL' AND st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER'
           AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2
         GROUP BY st.store_id, st.store_code, st.store_name, st.operator_name, st.first_trading_date),
       py AS (
         SELECT st.store_id, SUM(s.net_sales) net, SUM(s.transactions) trans, SUM(s.footfall) ff, SUM(s.return_value) ret
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id
         WHERE sc.scenario_type='ACTUAL' AND s.is_valid_day AND s.date_key BETWEEN $3 AND $4
         GROUP BY st.store_id),
       be AS (SELECT store_id, ytd_status FROM commercial.store_cost_profile)
       SELECT cy.*, py.net py_net, py.trans py_trans, py.ff py_ff, py.ret py_ret, be.ytd_status
       FROM cy JOIN py ON py.store_id = cy.store_id
       LEFT JOIN be ON be.store_id = cy.store_id
       WHERE cy.first_trading_date <= ($5::date - 28)`,
      [cyFrom, cyTo, pyFrom, dk(pyToIso), `${year}-01-01`]
    ));

    const outputs = [];
    await ctx.step(`Apply flag rules to ${rows.length} comparable stores`, async () => {
      const daysElapsed = Math.round((new Date(maxIso) - new Date(`${year}-01-01`)) / 86400000) + 1;
      for (const r of rows) {
        const yoy = (a, b) => (Number(b) ? Number(a) / Number(b) - 1 : null);
        const sales = yoy(r.net, r.py_net), ff = yoy(r.ff, r.py_ff), ret = yoy(r.ret, r.py_ret);
        const conv = Number(r.ff) && Number(r.py_ff) && Number(r.py_trans)
          ? (Number(r.trans) / Number(r.ff)) / (Number(r.py_trans) / Number(r.py_ff)) - 1 : null;
        const reasons = [];
        if (sales !== null && sales < -0.10) reasons.push(`net sales ${(sales * 100).toFixed(1)}% vs LY`);
        if (ff !== null && ff < -0.10) reasons.push(`footfall ${(ff * 100).toFixed(1)}%`);
        if (conv !== null && conv < -0.05) reasons.push(`conversion ${(conv * 100).toFixed(1)}%`);
        if (ret !== null && ret > 0.25) reasons.push(`returns value +${(ret * 100).toFixed(1)}%`);
        if (r.ytd_status === "BELOW") reasons.push("trading below break-even YTD");
        if (!reasons.length) continue;
        const impact = Math.round(((Number(r.net) - Number(r.py_net)) / daysElapsed) * 365);
        const sev = Math.abs(impact) >= 100000 ? "CRITICAL" : Math.abs(impact) >= 50000 ? "HIGH" : "MEDIUM";
        outputs.push({
          output_type: "INSIGHT", severity: sev,
          headline: `${r.store_name}: ${reasons[0]}`,
          body: `${r.store_name} (${r.operator_name}) needs attention. Flags: ${reasons.join("; ")}. ` +
                `YTD net sales £${Math.round(r.net).toLocaleString("en-GB")} vs £${Math.round(r.py_net).toLocaleString("en-GB")} last year. ` +
                `Estimated annualised sales impact £${impact.toLocaleString("en-GB")}.`,
          recommended_action: r.ytd_status === "BELOW"
            ? "Review the cost profile on the Break-even board and agree a recovery plan with the area manager."
            : "Review the store drilldown with the area manager and agree the first corrective move this week.",
          financial_impact: impact, confidence_pct: 0.85, store_id: r.store_id,
        });
      }
      outputs.sort((a, b) => Math.abs(b.financial_impact) - Math.abs(a.financial_impact));
      outputs.splice(10); // top 10 by impact — noise control
    });
    ctx.summary(`${rows.length} comparable stores scanned; ${outputs.length} flagged (top 10 by annualised impact retained).`);
    return outputs;
  },

  // Freshness and integrity checks over the data behind the dashboards.
  DATA_QUALITY: async (ctx) => {
    ctx.plan("Run the four standing data-quality checks: load freshness, footfall coverage, invalid-day exclusions, overdue critical tasks.");
    const outputs = [];

    await ctx.step("Check data load freshness (tolerance 9 days)", async () => {
      const { rows } = await selectOnly(
        `SELECT source_system, completed_at, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - completed_at))/86400 AS age_days
         FROM governance.data_refresh_log WHERE status='SUCCESS' ORDER BY completed_at DESC LIMIT 1`
      );
      if (!rows.length) {
        outputs.push({ output_type: "EXCEPTION", severity: "HIGH", headline: "No successful data load recorded",
          body: "governance.data_refresh_log has no SUCCESS entries — dashboard freshness cannot be verified.", confidence_pct: 1 });
      } else if (Number(rows[0].age_days) > 9) {
        outputs.push({ output_type: "EXCEPTION", severity: "HIGH",
          headline: `Store data is ${Math.floor(rows[0].age_days)} days old`,
          body: `Latest successful load (${rows[0].source_system}) completed ${Math.floor(rows[0].age_days)} days ago — beyond the 9-day tolerance. Numbers on the store dashboards no longer reflect current trading.`,
          recommended_action: "Run the weekly store data load and confirm the refresh log entry.", confidence_pct: 1 });
      }
    });

    await ctx.step("Check footfall coverage (last 4 weeks of data)", async () => {
      const { rows } = await selectOnly(
        `WITH w AS (SELECT MAX(date_key) mx FROM commercial.fact_store_sales s
                    JOIN core.dim_scenario sc ON sc.scenario_id=s.scenario_id WHERE sc.scenario_type='ACTUAL')
         SELECT count(*) FILTER (WHERE s.footfall = 0 AND s.net_sales > 0)::float / NULLIF(count(*),0) AS zero_share
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id, w
         WHERE sc.scenario_type='ACTUAL' AND st.operator_name IS NOT NULL AND s.is_valid_day
           AND s.date_key >= (SELECT to_char(to_date(mx::text,'YYYYMMDD') - 28, 'YYYYMMDD')::int FROM w)`
      );
      const share = Number(rows[0]?.zero_share || 0);
      if (share > 0.10) {
        outputs.push({ output_type: "EXCEPTION", severity: "MEDIUM",
          headline: `Footfall missing on ${(share * 100).toFixed(1)}% of trading days`,
          body: `${(share * 100).toFixed(1)}% of trading days in the last 4 weeks of data have sales but zero footfall — conversion is understated for those stores.`,
          recommended_action: "Check footfall counters/feeds for the affected stores.", confidence_pct: 0.95 });
      }
    });

    await ctx.step("Check invalid-day exclusions (last 4 weeks of data)", async () => {
      const { rows } = await selectOnly(
        `WITH w AS (SELECT MAX(date_key) mx FROM commercial.fact_store_sales s
                    JOIN core.dim_scenario sc ON sc.scenario_id=s.scenario_id WHERE sc.scenario_type='ACTUAL')
         SELECT count(*)::int AS invalid_rows FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id, w
         WHERE sc.scenario_type='ACTUAL' AND NOT s.is_valid_day
           AND s.date_key >= (SELECT to_char(to_date(mx::text,'YYYYMMDD') - 28, 'YYYYMMDD')::int FROM w)`
      );
      const n = rows[0]?.invalid_rows || 0;
      if (n > 20) {
        outputs.push({ output_type: "EXCEPTION", severity: "MEDIUM",
          headline: `${n} store-days excluded as invalid in the last 4 weeks`,
          body: `${n} rows failed the validity check in the latest 4 weeks of data — above the usual level; worth confirming the source export is clean.`,
          recommended_action: "Review the data flags on the excluded rows with the data owner.", confidence_pct: 0.9 });
      }
    });

    await ctx.step("Check overdue critical tasks", async () => {
      const { rows } = await selectOnly(
        `SELECT count(*)::int AS n FROM workflow.task_instance WHERE status='OVERDUE' AND priority='CRITICAL'`
      );
      if (rows[0].n > 0) {
        outputs.push({ output_type: "EXCEPTION", severity: "HIGH",
          headline: `${rows[0].n} critical finance task${rows[0].n === 1 ? " is" : "s are"} overdue`,
          body: `${rows[0].n} CRITICAL task(s) on the weekly schedule are past due — including controls the dashboards rely on.`,
          recommended_action: "Review the team schedule and reassign or unblock the overdue critical tasks today.", confidence_pct: 1 });
      }
    });

    if (!outputs.length) {
      outputs.push({ output_type: "REPORT", severity: "LOW", headline: "All data-quality checks passed",
        body: "Freshness, footfall coverage, validity exclusions and critical-task checks all within tolerance.", confidence_pct: 1 });
    }
    ctx.summary(`${outputs.filter(o => o.output_type === "EXCEPTION").length} exception(s) raised.`);
    return outputs;
  },
};

// ---------------------------------------------------------------- engine
export async function runAgent(agentCode, actor, triggerType = "MANUAL") {
  const { rows: reg } = await query(`SELECT * FROM agent.agent_registry WHERE agent_code = $1 AND is_active`, [agentCode]);
  if (!reg.length) throw new Error("Unknown or inactive agent");
  const a = reg[0];
  const impl = IMPLEMENTATIONS[agentCode];
  if (!impl) throw new Error("No implementation registered for this agent");

  const fresh = await getFreshness(null);
  const freshness = fresh
    ? `Latest load: ${fresh.source_system} at ${new Date(fresh.completed_at).toISOString()} (${Number(fresh.rows_loaded).toLocaleString("en-GB")} rows)`
    : "No successful data load recorded";

  const { rows: runRows } = await query(
    `INSERT INTO agent.agent_run (agent_code, version_number, trigger_type, triggered_by, data_freshness, plan)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING run_id`,
    [agentCode, a.current_version, triggerType, actor.email, freshness, a.instructions.slice(0, 500)]
  );
  const runId = runRows[0].run_id;
  let stepNo = 0;
  const state = { plan: null, summary: null, period: [null, null] };
  const ctx = {
    plan: (p) => { state.plan = p; },
    summary: (s) => { state.summary = s; },
    period: (from, to) => { state.period = [from, to]; },
    step: async (title, fn) => {
      const n = ++stepNo;
      const started = new Date();
      try {
        const result = await fn();
        await query(
          `INSERT INTO agent.agent_run_step (run_id, step_no, title, status, started_at, finished_at)
           VALUES ($1, $2, $3, 'SUCCESS', $4, CURRENT_TIMESTAMP)`, [runId, n, title, started]);
        return result;
      } catch (e) {
        await query(
          `INSERT INTO agent.agent_run_step (run_id, step_no, title, detail, status, started_at, finished_at)
           VALUES ($1, $2, $3, $4, 'FAILED', $5, CURRENT_TIMESTAMP)`, [runId, n, title, e.message, started]);
        throw e;
      }
    },
  };

  try {
    const outputs = await impl(ctx);
    let material = 0;
    for (const o of outputs) {
      const validation = validateOutput(o);
      const isMaterial = a.materiality_gbp != null && o.financial_impact != null
        ? Math.abs(Number(o.financial_impact)) >= Number(a.materiality_gbp)
        : o.output_type !== "REPORT";
      if (isMaterial) material++;
      const needsReview = a.approval_required || isMaterial;
      const lifecycle = validation.startsWith("FAILED") ? "AUTOMATED_VALIDATION" : needsReview ? "PENDING_REVIEW" : "CLOSED";
      await query(
        `INSERT INTO agent.agent_output
           (run_id, output_type, severity, headline, body, recommended_action, financial_impact,
            confidence_pct, is_material, validation_result, lifecycle, store_id, entity_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [runId, o.output_type, o.severity || null, o.headline, o.body, o.recommended_action || null,
         o.financial_impact ?? null, o.confidence_pct ?? null, isMaterial, validation, lifecycle,
         o.store_id || null, o.entity_id || null]
      );
    }
    const avgConf = outputs.length ? outputs.reduce((s, o) => s + (o.confidence_pct || 0), 0) / outputs.length : null;
    await query(
      `UPDATE agent.agent_run SET status='SUCCESS', finished_at=CURRENT_TIMESTAMP,
              plan=COALESCE($2, plan), summary=$3, confidence_pct=$4, period_start=$5, period_end=$6
       WHERE run_id=$1`,
      [runId, state.plan, state.summary || `${outputs.length} output(s), ${material} material.`, avgConf, state.period[0], state.period[1]]
    );
    await query(
      `INSERT INTO agent.agent_performance (agent_code, total_runs, total_outputs, last_run_at)
       VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (agent_code) DO UPDATE SET
         total_runs = agent_performance.total_runs + 1,
         total_outputs = agent_performance.total_outputs + $2,
         last_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
      [agentCode, outputs.length]
    );
    await audit({ actor, eventType: "agent.run", objectType: "agent_run", objectRef: String(runId), detail: { agentCode, outputs: outputs.length } });
    return { runId, outputs: outputs.length };
  } catch (e) {
    await query(`UPDATE agent.agent_run SET status='FAILED', finished_at=CURRENT_TIMESTAMP, summary=$2 WHERE run_id=$1`, [runId, e.message]);
    await query(`INSERT INTO agent.agent_exception (run_id, severity, message) VALUES ($1, 'HIGH', $2)`, [runId, e.message]);
    await query(
      `INSERT INTO agent.agent_performance (agent_code, total_runs, failed_runs, last_run_at)
       VALUES ($1, 1, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (agent_code) DO UPDATE SET
         total_runs = agent_performance.total_runs + 1, failed_runs = agent_performance.failed_runs + 1,
         last_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`, [agentCode]);
    await audit({ actor, eventType: "agent.run-failed", objectType: "agent_run", objectRef: String(runId), detail: { agentCode, error: e.message } });
    return { runId, failed: true, error: e.message };
  }
}

// ---------------------------------------------------------------- queries
export async function listAgents() {
  const { rows } = await query(
    `SELECT r.*, p.total_runs, p.failed_runs, p.total_outputs, p.approved_outputs, p.rejected_outputs, p.last_run_at,
            (SELECT count(*)::int FROM agent.agent_output o JOIN agent.agent_run ar ON ar.run_id = o.run_id
             WHERE ar.agent_code = r.agent_code AND o.lifecycle = 'PENDING_REVIEW') AS pending_reviews,
            (SELECT status FROM agent.agent_run ar WHERE ar.agent_code = r.agent_code ORDER BY started_at DESC LIMIT 1) AS last_status
     FROM agent.agent_registry r
     LEFT JOIN agent.agent_performance p ON p.agent_code = r.agent_code
     ORDER BY r.agent_name`
  );
  return rows;
}

export async function getAgent(code) {
  const [reg, versions, runs, prompts] = await Promise.all([
    query(`SELECT * FROM agent.agent_registry WHERE agent_code = $1`, [code]),
    query(`SELECT version_number, created_by, created_at FROM agent.agent_version WHERE agent_code = $1 ORDER BY version_number DESC`, [code]),
    query(`SELECT run_id, trigger_type, triggered_by, status, summary, started_at, finished_at,
                  (SELECT count(*)::int FROM agent.agent_output o WHERE o.run_id = agent_run.run_id) AS outputs
           FROM agent.agent_run WHERE agent_code = $1 ORDER BY started_at DESC LIMIT 25`, [code]),
    query(`SELECT version_number, created_at, created_by FROM agent.agent_prompt WHERE agent_code = $1 ORDER BY version_number DESC`, [code]),
  ]);
  if (!reg.rows.length) return null;
  return { ...reg.rows[0], versions: versions.rows, runs: runs.rows, prompts: prompts.rows };
}

export async function getRun(runId) {
  const [run, steps, outputs, exceptions] = await Promise.all([
    query(`SELECT ar.*, r.agent_name, r.reviewer_name, r.risk_rating FROM agent.agent_run ar
           JOIN agent.agent_registry r ON r.agent_code = ar.agent_code WHERE ar.run_id = $1`, [runId]),
    query(`SELECT * FROM agent.agent_run_step WHERE run_id = $1 ORDER BY step_no`, [runId]),
    query(`SELECT o.*, st.store_name,
                  (SELECT json_agg(json_build_object('reviewer', v.reviewer, 'decision', v.decision, 'comment', v.comment, 'decided_at', v.decided_at))
                   FROM agent.agent_review v WHERE v.output_id = o.output_id) AS reviews
           FROM agent.agent_output o
           LEFT JOIN core.dim_store st ON st.store_id = o.store_id
           WHERE o.run_id = $1 ORDER BY ABS(COALESCE(o.financial_impact,0)) DESC`, [runId]),
    query(`SELECT * FROM agent.agent_exception WHERE run_id = $1`, [runId]),
  ]);
  if (!run.rows.length) return null;
  return { ...run.rows[0], steps: steps.rows, outputs: outputs.rows, exceptions: exceptions.rows };
}

export async function getReviewQueue() {
  const { rows } = await query(
    `SELECT o.*, ar.agent_code, r.agent_name, st.store_name
     FROM agent.agent_output o
     JOIN agent.agent_run ar ON ar.run_id = o.run_id
     JOIN agent.agent_registry r ON r.agent_code = ar.agent_code
     LEFT JOIN core.dim_store st ON st.store_id = o.store_id
     WHERE o.lifecycle = 'PENDING_REVIEW'
     ORDER BY CASE o.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
              ABS(COALESCE(o.financial_impact,0)) DESC`
  );
  return rows;
}

export async function getRecentExceptions(limit = 10) {
  const { rows } = await query(
    `SELECT e.*, ar.agent_code FROM agent.agent_exception e
     JOIN agent.agent_run ar ON ar.run_id = e.run_id
     WHERE NOT e.is_resolved ORDER BY e.created_at DESC LIMIT $1`, [limit]
  );
  return rows;
}
