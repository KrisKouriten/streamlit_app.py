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
