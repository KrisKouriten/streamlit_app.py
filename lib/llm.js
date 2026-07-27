/*
 * Minimal Anthropic client — one non-streaming Messages call, no SDK dependency
 * (a single fetch keeps the runtime lean and matches the codebase's style). The
 * model gets a system + user prompt and NO tools, so it can only return text —
 * it cannot query or write anything. The key lives only in ANTHROPIC_API_KEY
 * (Vercel env, Sensitive); it is never logged or returned.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";

export function anthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Generate text from a system + user prompt. Returns { text, usage, model }.
// Throws with a clear message when the key is missing or the API errors, so the
// agent runner records it as a failed run rather than a silent empty output.
export async function generateText({ system, user, maxTokens = 1200 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set — add it as an environment secret to enable LLM commentary.");
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data?.stop_reason === "refusal") throw new Error("Claude declined to generate this commentary (safety refusal).");
  const text = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Claude returned no text");
  return { text, usage: data.usage, model: data.model || model };
}

/*
 * Config-driven generation for the Finance Intelligence Layer (Finance Buddy /
 * AI Perspective). Same single-fetch, no-tools design as generateText — the
 * model can only return text/JSON, never query or write. The model id comes from
 * the DB (intelligence.model_configuration), never hard-coded here. When a JSON
 * `schema` is supplied, output is constrained via output_config.format; the
 * parsed object is returned as `json`. Returns { text, json, usage, model, refusal }.
 *
 * `messages` (optional) supplies a full multi-turn history for conversational
 * Finance Buddy; when omitted the single `user` string is sent as one turn. The
 * model still has NO tools either way — prior turns are context, not capability.
 */
export async function generateGoverned({ system, user, messages = null, model, maxTokens = 4000, schema = null }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set — add it as an environment secret to enable the intelligence layer.");
  const useModel = model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const turns = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: "user", content: user }];

  const body = {
    model: useModel,
    max_tokens: maxTokens,
    system,
    messages: turns,
  };
  if (schema) body.output_config = { format: { type: "json_schema", schema } };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  // A safety refusal is a normal outcome to surface honestly, not an error to hide (CR §19).
  if (data?.stop_reason === "refusal") {
    return { text: null, json: null, usage: data.usage, model: data.model || useModel, refusal: true };
  }
  const text = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  let json = null;
  if (schema && text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { text, json, usage: data.usage, model: data.model || useModel, refusal: false };
}
