import { query } from "./db";
import { notifyUser } from "./notifications";
import { emailConfigured, sendMail } from "./email/resend";
import { poSignoffEmail, poDecisionEmail, poChallengeEmail } from "./email/templates";
import { poRef } from "./po-rules";

/*
 * Workflow notifications — pings people when a purchase order moves through
 * sign-off. Every recipient gets an in-app notification (the bell / inbox) and,
 * when Resend is configured, an email too. Both channels are best-effort: a
 * failure here never fails the underlying P.O action (the API route wraps these
 * in try/catch and logs), so an unreachable mailbox can't block an approval.
 *
 * `baseUrl` is the public origin for building the link; recipients are resolved
 * to app users by email (approvers) or by the P.O's created_by (submitter),
 * which is stored as an email or a display name.
 */

const PO_LINK = (baseUrl) => `${(baseUrl || "").replace(/\/$/, "")}/operate/po-tracker`;

// Look up active users for a list of email addresses → [{ id, name, email }].
async function usersByEmail(emails) {
  const list = [...new Set((emails || []).map((e) => (e || "").trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  try {
    const { rows } = await query(
      `SELECT id, name, email FROM users WHERE lower(email) = ANY($1) AND is_active <> false`, [list]);
    return rows;
  } catch { return []; }
}

// Resolve the P.O's submitter (created_by = email or display name) to a user.
async function submitterUser(createdBy) {
  const who = (createdBy || "").trim();
  if (!who) return null;
  try {
    const { rows } = await query(
      `SELECT id, name, email FROM users
        WHERE (lower(email) = lower($1) OR name = $1) AND is_active <> false LIMIT 1`, [who]);
    return rows[0] || null;
  } catch { return null; }
}

// Send one email to many recipients, best-effort. Never throws.
async function email(to, msg) {
  const recipients = [...new Set((to || []).map((e) => (e || "").trim()).filter(Boolean))];
  if (!recipients.length || !emailConfigured()) return;
  try {
    await sendMail({ to: recipients, subject: msg.subject, html: msg.html, text: msg.text });
  } catch (e) {
    console.error("workflow email failed:", e.message);
  }
}

/* A P.O has been submitted for sign-off → its department's approver(s). */
export async function notifyPoAwaitingSignoff({ po, approverEmails, baseUrl }) {
  if (!po) return;
  const ref = poRef(po);
  const link = PO_LINK(baseUrl);
  const approvers = await usersByEmail(approverEmails);
  const title = `${ref} awaiting your sign-off`;
  const body = `${po.created_by || "A colleague"} submitted a purchase order (${po.department || "—"}) for £${Math.round(Number(po.payment_value) || 0).toLocaleString("en-GB")}.`;
  for (const u of approvers) {
    await notifyUser({ userId: u.id, kind: "po_signoff", title, body, link, actor: po.created_by || null, objectType: "purchase_order", objectRef: String(po.po_id) });
  }
  await email(approverEmails, poSignoffEmail({
    ref, submitter: po.created_by, department: po.department, supplier: po.supplier, value: po.payment_value, link,
  }));
}

/* An approver approved / rejected a P.O → the submitter. */
export async function notifyPoDecision({ po, decision, actor, baseUrl }) {
  if (!po) return;
  const ref = poRef(po);
  const link = PO_LINK(baseUrl);
  const approver = actor?.name || actor?.email || "An approver";
  const approved = decision === "APPROVED";
  const submitter = await submitterUser(po.created_by);
  if (submitter) {
    await notifyUser({
      userId: submitter.id, kind: "po_decision",
      title: `${ref} ${approved ? "approved" : "rejected"}`,
      body: `${approver} ${approved ? "approved" : "rejected"} your purchase order (£${Math.round(Number(po.payment_value) || 0).toLocaleString("en-GB")}).`,
      link, actor: approver, objectType: "purchase_order", objectRef: String(po.po_id),
    });
  }
  await email(submitter ? [submitter.email] : emailOf(po.created_by), poDecisionEmail({
    ref, decision, approver, value: po.payment_value, note: po.challenge_note || null, link,
  }));
}

/* Finance challenged a signed-off P.O back for edits → the submitter. */
export async function notifyPoChallenge({ po, reasons, note, baseUrl }) {
  if (!po) return;
  const ref = poRef(po);
  const link = PO_LINK(baseUrl);
  const submitter = await submitterUser(po.created_by);
  if (submitter) {
    await notifyUser({
      userId: submitter.id, kind: "po_challenge",
      title: `${ref} challenged by Finance`,
      body: note ? `Finance returned your purchase order: ${note}` : "Finance returned your purchase order to review.",
      link, actor: "Finance", objectType: "purchase_order", objectRef: String(po.po_id),
    });
  }
  await email(submitter ? [submitter.email] : emailOf(po.created_by), poChallengeEmail({
    ref, reasons, note, value: po.payment_value, link,
  }));
}

// created_by may itself be an email — use it as a fallback recipient when no user row matched.
function emailOf(createdBy) {
  const who = (createdBy || "").trim();
  return /@/.test(who) ? [who] : [];
}
