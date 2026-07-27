import { query } from "../db";

/*
 * Server-side model & prompt configuration (CR §16). Model choice per use-case
 * lives in the DB (migration 038) so it is swappable without a deploy — nothing
 * is hard-coded in front-end code. use_case ∈ ROUTING | PERSPECTIVE | BUDDY.
 */

export async function getModelConfig(useCase) {
  const { rows } = await query(
    `SELECT use_case, model, effort, max_tokens, timeout_ms, prompt_code
     FROM intelligence.model_configuration
     WHERE use_case = $1 AND is_active = true
     ORDER BY effective_date DESC LIMIT 1`,
    [useCase]
  );
  return rows[0] || null;
}

export async function getPrompt(promptCode) {
  const { rows } = await query(
    `SELECT prompt_code, version, system_prompt, output_schema
     FROM intelligence.prompt_version
     WHERE prompt_code = $1 AND is_active = true
     ORDER BY version DESC LIMIT 1`,
    [promptCode]
  );
  return rows[0] || null;
}
