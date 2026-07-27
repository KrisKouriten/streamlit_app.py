/*
 * Microsoft 365 mail transport via the Graph API (application permissions,
 * client-credentials flow). Invites and reset links are sent from a real
 * kouriten.com mailbox, so they land with good deliverability and a familiar
 * From address.
 *
 * Required environment (all four, or email is treated as "not configured"):
 *   MS_GRAPH_TENANT_ID      the Azure AD / Entra tenant (GUID or domain)
 *   MS_GRAPH_CLIENT_ID      the app registration's client id
 *   MS_GRAPH_CLIENT_SECRET  a client secret for that app registration
 *   MS_GRAPH_SENDER         the mailbox to send AS (e.g. no-reply@kouriten.com)
 *
 * Azure setup: register an app, grant the APPLICATION permission Mail.Send
 * (admin consent), create a client secret. Mail.Send (application) can send as
 * any mailbox in the tenant; scope it down with an ApplicationAccessPolicy to
 * just MS_GRAPH_SENDER if you want to restrict it.
 *
 * This module does HTTP only; message bodies come from lib/email/templates.js.
 */

const LOGIN_BASE = "https://login.microsoftonline.com";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function cfg() {
  const env = process.env;
  return {
    tenantId: (env.MS_GRAPH_TENANT_ID || "").trim(),
    clientId: (env.MS_GRAPH_CLIENT_ID || "").trim(),
    clientSecret: (env.MS_GRAPH_CLIENT_SECRET || "").trim(),
    sender: (env.MS_GRAPH_SENDER || "").trim(),
  };
}

export function graphConfigured() {
  const c = cfg();
  return !!(c.tenantId && c.clientId && c.clientSecret && c.sender);
}

// In-memory token cache (per warm server instance). Refreshed a minute before
// the real expiry to avoid using a token that dies mid-request.
let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const c = cfg();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`${LOGIN_BASE}/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Microsoft token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("Microsoft token response was not JSON"); }
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (Number(json.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

/*
 * Send an email. Returns { ok: true } on success; throws with a clear message
 * on failure so callers can decide whether to surface a fallback link.
 *   to       recipient address (string) or array of addresses
 *   subject  plain string
 *   html     HTML body
 *   text     plain-text alternative (optional but recommended)
 */
export async function sendMail({ to, subject, html, text }) {
  if (!graphConfigured()) {
    throw new Error("Microsoft 365 email is not configured (set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER).");
  }
  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
  if (!recipients.length) throw new Error("No recipient for email");

  const token = await getAccessToken();
  const message = {
    subject,
    body: { contentType: html ? "HTML" : "Text", content: html || text || "" },
    toRecipients: recipients,
  };
  // Graph carries only one body; when we have both, prefer HTML and keep text
  // as the plain fallback isn't separately supported here — HTML clients win.
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(cfg().sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: false }),
  });
  if (res.status === 202) return { ok: true };
  const errText = await res.text();
  throw new Error(`Microsoft sendMail failed (${res.status}): ${errText.slice(0, 300)}`);
}
