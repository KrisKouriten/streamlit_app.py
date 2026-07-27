import { query } from "../db";
import { audit } from "../governance";
import { scopeForSession } from "../intelligence/permission";
import { getModelConfig, getPrompt } from "../intelligence/config";
import { openRun, recordStep, recordSources, finishRun } from "../intelligence/runs";
import { assessConfidence } from "../intelligence/confidence-rules";
import { generateGoverned } from "../llm";
import { resolveSource } from "./adapters";
import { buildReportContext, renderContextPreamble, PERSPECTIVES, isPerspective } from "./commentary-perspectives";

/*
 * Corporate Reporting Centre — AI commentary (CR §10–§12, §28). Reuses the
 * governed Finance Intelligence Layer end-to-end: the model interprets ONLY the
 * governed figures resolved for the section (the same numbers the page shows —
 * so commentary reconciles to source), takes no action, and lands as a DRAFT
 * that a human must review and approve before it can enter an issued report.
 * Every draft is an auditable intelligence run.
 */

function factLine(f) {
  const v = f.unit === "%" ? `${f.value}%`
    : f.unit === "count" ? `${f.value}`
    : `£${Number(f.value).toLocaleString("en-GB")}`;
  return `- ${f.label}: ${v}`;
}

function buildUser(ctx, focus, envelope) {
  const lines = [renderContextPreamble(ctx, focus), "", "GOVERNED FACTS (use only these figures — do not invent any number):"];
  const facts = (envelope?.kpis || []).filter((k) => k.value != null);
  if (facts.length) for (const f of facts) lines.push(factLine(f));
  else lines.push("- (no governed figures available for this section/scope)");
  if (envelope?.warnings?.length) {
    lines.push("", "DATA LIMITATIONS:");
    for (const w of envelope.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

/*
 * Draft commentary for one report section. Stores (or updates) a 'commentary'
 * component in DRAFT. Returns { ok, componentId, confidence, runId }.
 */
export async function generateReportCommentary({ reportId, sectionInstId, componentId = null, perspective = "EXECUTIVE", detailLevel = "STANDARD", tone = "MANAGEMENT", actor } = {}) {
  if (!isPerspective(perspective)) return { ok: false, error: `Unknown perspective: ${perspective}` };

  const { rows: rrows } = await query(
    `SELECT report_id, template_key, reporting_period, data_through_date, audience, scope, comparator
     FROM finance.report_instance WHERE report_id = $1`, [reportId]);
  const report = rrows[0];
  if (!report) return { ok: false, error: "Report not found" };
  const { rows: srows } = await query(
    `SELECT section_inst_id, section_key, title, source_key, filters FROM finance.report_section_instance WHERE section_inst_id = $1 AND report_id = $2`,
    [sectionInstId, reportId]);
  const section = srows[0];
  if (!section) return { ok: false, error: "Section not found" };

  const scope = scopeForSession(actor);
  const envelope = section.source_key ? await resolveSource(section.source_key, { scope, filters: section.filters || {} }) : null;

  const ctx = buildReportContext({
    reportId, templateKey: report.template_key, reportingPeriod: report.reporting_period,
    dataThroughDate: report.data_through_date, audience: report.audience,
    sectionKey: section.section_key, sectionTitle: section.title,
    scope: report.scope || {}, comparator: report.comparator, perspective, detailLevel, tone,
  });

  const cfg = await getModelConfig("REPORT_COMMENTARY");
  const prompt = cfg?.prompt_code ? await getPrompt(cfg.prompt_code) : null;

  const runId = await openRun({
    surface: "REPORT_COMMENTARY", session: actor, questionType: "REPORTING",
    question: `${report.template_key} · ${section.title} · ${perspective}`,
    model: cfg?.model, promptCode: cfg?.prompt_code, scopeNote: scope.note,
  });

  try {
    await recordStep(runId, 1, "Resolve section source & governed facts", section.source_key || "no source");
    const dataThrough = envelope?.metadata?.dataThrough || (report.data_through_date ? new Date(report.data_through_date).toISOString() : null);
    const sources = [{ label: envelope?.label || section.title, module: envelope?.label, dataThrough, route: envelope?.metadata?.sourceRoute, missing: envelope ? !envelope.ready : false }];
    const confidence = assessConfidence(sources, {
      hasUnapprovedForecast: envelope?.metadata?.approvalStatus === "WORKING_FORECAST",
      incompletePeriod: false,
    });
    await recordSources(runId, sources);

    if (!cfg || !prompt) {
      await finishRun(runId, { status: "FAILED", error: "Report commentary not configured" }, actor);
      return { ok: false, error: "Report commentary is not configured (run migration 045).", runId };
    }

    const out = await generateGoverned({
      system: prompt.system_prompt,
      user: buildUser(ctx, PERSPECTIVES[perspective].focus, envelope),
      model: cfg.model, maxTokens: cfg.max_tokens, schema: prompt.output_schema,
    });
    await recordStep(runId, 2, "Draft commentary", out.refusal ? "refusal" : "ok");

    if (out.refusal || !out.json) {
      await finishRun(runId, { status: out.refusal ? "REFUSED" : "FAILED", confidence: confidence.level, usage: out.usage, error: out.refusal ? null : "No structured output" }, actor);
      return { ok: false, refusal: !!out.refusal, runId };
    }

    const draft = out.json;
    const bodyText = [draft.headline, "", draft.body].filter(Boolean).join("\n");
    const structured = {
      headline: draft.headline, drivers: draft.drivers || [], risks: draft.risks || [],
      opportunities: draft.opportunities || [], recommended_actions: draft.recommended_actions || [],
      financial_effect: draft.financial_effect || null, data_limitations: draft.data_limitations || [],
    };
    const citedSources = (draft.sources || []).map((s) => ({ label: String(s) }));
    await finishRun(runId, { status: "SUCCESS", confidence: confidence.level, summary: draft.headline, usage: out.usage }, actor);

    // Store as a DRAFT commentary component (new or replacing an existing one).
    let compId = componentId;
    if (compId) {
      await query(
        `UPDATE finance.report_component
           SET ai_perspective=$2, ai_status='DRAFT', ai_run_id=$3, ai_model=$4, ai_prompt_code=$5,
               ai_confidence=$6, ai_data_through=$7, ai_sources=$8, draft_text=$9, approved_text=NULL,
               config=$10, reviewed_by=NULL, reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE component_id=$1 AND report_id=$11`,
        [compId, perspective, runId, cfg.model, cfg.prompt_code, confidence.level,
         report.data_through_date || null, JSON.stringify(citedSources), bodyText, JSON.stringify(structured), reportId]
      );
    } else {
      const { rows: pos } = await query(`SELECT COALESCE(max(position),0)+1 AS n FROM finance.report_component WHERE section_inst_id=$1`, [sectionInstId]);
      const { rows } = await query(
        `INSERT INTO finance.report_component
           (report_id, section_inst_id, component_type, title, position, ai_perspective, ai_status,
            ai_run_id, ai_model, ai_prompt_code, ai_confidence, ai_data_through, ai_sources, draft_text, config)
         VALUES ($1,$2,'commentary',$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11,$12,$13) RETURNING component_id`,
        [reportId, sectionInstId, `${PERSPECTIVES[perspective].label} commentary`, pos[0].n, perspective,
         runId, cfg.model, cfg.prompt_code, confidence.level, report.data_through_date || null,
         JSON.stringify(citedSources), bodyText, JSON.stringify(structured)]
      );
      compId = rows[0].component_id;
    }
    await query(`UPDATE finance.report_section_instance SET commentary_status='DRAFT', updated_at=CURRENT_TIMESTAMP WHERE section_inst_id=$1`, [sectionInstId]);
    await audit({ actor, eventType: "report.commentary.draft", objectType: "report_component", objectRef: String(compId), detail: { reportId, perspective, runId } });
    return { ok: true, componentId: compId, confidence: confidence.level, runId };
  } catch (e) {
    await finishRun(runId, { status: "FAILED", error: e.message }, actor);
    return { ok: false, error: e.message, runId };
  }
}

// Edit the working text of a draft commentary (a human amendment). Keeps DRAFT.
export async function editReportCommentary(componentId, text, actor) {
  const { rows } = await query(
    `UPDATE finance.report_component SET draft_text=$2, updated_at=CURRENT_TIMESTAMP
     WHERE component_id=$1 AND component_type='commentary' AND ai_status IN ('DRAFT','REVIEWED')
     RETURNING report_id`, [componentId, text]);
  if (!rows.length) return { ok: false, error: "Not found or locked" };
  await audit({ actor, eventType: "report.commentary.edit", objectType: "report_component", objectRef: String(componentId) });
  return { ok: true };
}

// Sign-off (CR §12). decision APPROVED|REJECTED. Only a DRAFT/REVIEWED can be
// decided. approvedText, if provided, is the final wording; else the draft text.
export async function reviewReportCommentary(componentId, decision, { note = null, approvedText = null } = {}, actor) {
  const status = decision === "APPROVED" ? "APPROVED" : "REJECTED";
  const { rows } = await query(
    `UPDATE finance.report_component
       SET ai_status=$2, approved_text = CASE WHEN $2='APPROVED' THEN COALESCE($3, draft_text) ELSE approved_text END,
           reviewed_by=$4, reviewed_at=CURRENT_TIMESTAMP, config = jsonb_set(COALESCE(config,'{}'::jsonb), '{review_note}', to_jsonb($5::text)), updated_at=CURRENT_TIMESTAMP
     WHERE component_id=$1 AND component_type='commentary' AND ai_status IN ('DRAFT','REVIEWED')
     RETURNING report_id, section_inst_id`,
    [componentId, status, approvedText, actor.email || actor.name, note]);
  if (!rows.length) return { ok: false, error: "Not found or already decided" };
  await query(`UPDATE finance.report_section_instance SET commentary_status=$2 WHERE section_inst_id=$1`, [rows[0].section_inst_id, status === "APPROVED" ? "APPROVED" : "REJECTED"]);
  await audit({ actor, eventType: "report.commentary.review", objectType: "report_component", objectRef: String(componentId), detail: { decision: status } });
  return { ok: true, status };
}
