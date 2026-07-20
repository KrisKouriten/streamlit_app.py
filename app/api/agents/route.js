import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getSession, hasRole } from "../../../lib/auth";
import { audit } from "../../../lib/governance";
import { runAgent, reviewError, AGENT_DASHBOARD, DECISIONS } from "../../../lib/agents";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const canOperate = hasRole(session, "ADMIN", "FINANCE");

  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "run") {
      if (!canOperate) return NextResponse.json({ error: "agents.run requires ADMIN or FINANCE" }, { status: 403 });
      const result = await runAgent(String(body.agentCode || ""), session, "MANUAL");
      return NextResponse.json(result, { status: result.failed ? 500 : 200 });
    }

    if (DECISIONS[body.action]) {
      const decision = body.action;
      const { rows } = await query(
        `SELECT o.*, ar.agent_code, ar.period_start, ar.period_end
         FROM agent.agent_output o JOIN agent.agent_run ar ON ar.run_id = o.run_id
         WHERE o.output_id = $1`, [body.outputId]);
      if (!rows.length) return NextResponse.json({ error: "Output not found" }, { status: 404 });
      const output = { ...rows[0], amended_headline: body.amendedHeadline?.trim(), amended_body: body.amendedBody?.trim() };

      const err = reviewError(decision, output, session);
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      if (decision === "close") {
        await query(`UPDATE agent.agent_output SET lifecycle='CLOSED' WHERE output_id=$1`, [body.outputId]);
        await audit({ actor: session, eventType: "agent.output-close", objectType: "agent_output", objectRef: String(body.outputId) });
        return NextResponse.json({ ok: true, lifecycle: "CLOSED" });
      }

      await query(
        `INSERT INTO agent.agent_review (output_id, reviewer, decision, comment, amended_headline, amended_body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [body.outputId, session.email, decision === "approve" ? "APPROVED" : decision === "amend" ? "AMENDED" : "REJECTED",
         body.comment?.trim() || null, output.amended_headline || null, output.amended_body || null]
      );

      let lifecycle = DECISIONS[decision].to;
      let insightId = null, actionId = null;

      if (decision === "approve" || decision === "amend") {
        const headline = output.amended_headline || output.headline;
        const narrative = output.amended_body || output.body;
        const { rows: ins } = await query(
          `INSERT INTO intelligence.ai_insight
             (dashboard_code, period_start, period_end, store_id, entity_id, insight_type, severity, headline,
              narrative, recommended_action, financial_impact, confidence_pct, digital_colleague,
              human_review_status, reviewed_by, reviewed_at, agent_run_id, agent_output_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP,$16,$17)
           RETURNING insight_id`,
          [AGENT_DASHBOARD[output.agent_code] || "MASTER", output.period_start, output.period_end,
           output.store_id, output.entity_id,
           output.output_type === "EXCEPTION" ? "ANOMALY" : "RECOMMENDATION",
           output.severity, headline, narrative, output.recommended_action, output.financial_impact,
           output.confidence_pct, output.agent_code, decision === "approve" ? "APPROVED" : "AMENDED",
           session.email, output.run_id, output.output_id]
        );
        insightId = ins[0].insight_id;

        if (body.createAction && output.recommended_action) {
          const { rows: act } = await query(
            `INSERT INTO intelligence.action_register (insight_id, action_title, action_description, owner_name, status, expected_value_gbp)
             VALUES ($1, $2, $3, $4, 'OPEN', $5) RETURNING action_id`,
            [insightId, headline.slice(0, 250), output.recommended_action, body.actionOwner?.trim() || session.name,
             output.financial_impact != null ? Math.abs(Number(output.financial_impact)) : null]
          );
          actionId = act[0].action_id;
          lifecycle = "ACTION_CREATED";
        }
      }

      await query(
        `UPDATE agent.agent_output SET lifecycle=$2, insight_id=$3, action_id=$4 WHERE output_id=$1`,
        [body.outputId, lifecycle, insightId, actionId]
      );
      await query(
        `UPDATE agent.agent_performance SET
           approved_outputs = approved_outputs + $2, rejected_outputs = rejected_outputs + $3, updated_at = CURRENT_TIMESTAMP
         WHERE agent_code = $1`,
        [output.agent_code, decision === "reject" ? 0 : 1, decision === "reject" ? 1 : 0]
      );
      await audit({ actor: session, eventType: `agent.output-${decision}`, objectType: "agent_output",
        objectRef: String(body.outputId), detail: { insightId, actionId } });
      return NextResponse.json({ ok: true, lifecycle, insightId, actionId });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("agents API error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
