/*
 * Email transport via Resend (https://resend.com). A single authenticated HTTP
 * POST with an API key — no mailbox, OAuth or SMTP. Account invites and
 * password-reset links are sent from a verified sender on your own domain for
 * good deliverability and a familiar From address.
 *
 * Required environment (both, or email is treated as "not configured" and the
 * admin UI falls back to showing the one-time link on screen):
 *   RESEND_API_KEY   the Resend API key (starts "re_…")
 *   RESEND_SENDER    the From address on a Resend-verified domain, e.g.
 *                    "Miniso UK Finance OS <no-reply@your-domain>"
 *                    (EMAIL_FROM is accepted as an alias.)
 *
 * Setup: create a Resend account, add and verify your sending domain (a couple
 * of DNS records), create an API key. That is the whole configuration.
 *
 * This module does HTTP only; message bodies come from lib/email/templates.js.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function cfg() {
  const env = process.env;
  return {
    apiKey: (env.RESEND_API_KEY || "").trim(),
    sender: (env.RESEND_SENDER || env.EMAIL_FROM || "").trim(),
  };
}

// True only when both the API key and a From address are present.
export function emailConfigured() {
  const c = cfg();
  return !!(c.apiKey && c.sender);
}

/*
 * Send an email. Returns { ok: true } on success; throws with a clear message
 * on failure so callers can decide whether to surface a fallback link.
 *   to       recipient address (string) or array of addresses
 *   subject  plain string
 *   html     HTML body
 *   text     plain-text alternative (recommended)
 */
export async function sendMail({ to, subject, html, text }) {
  const c = cfg();
  if (!emailConfigured()) {
    throw new Error("Email is not configured (set RESEND_API_KEY and RESEND_SENDER).");
  }
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) throw new Error("No recipient for email");

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: c.sender,
      to: recipients,
      subject,
      html: html || undefined,
      text: text || undefined,
    }),
  });
  if (res.ok) return { ok: true };
  const errText = await res.text();
  throw new Error(`Resend sendMail failed (${res.status}): ${errText.slice(0, 300)}`);
}
