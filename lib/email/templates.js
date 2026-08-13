/*
 * Pure email builders — no I/O, so they are unit-testable and the transport
 * (lib/email/resend.js) just posts whatever these return. House style: Miniso
 * UK, en-GB, plain and calm. Every email has both an HTML and a text body.
 */

const BRAND = "Miniso UK · Finance OS";

// Email-client-safe HTML echoing the Finance OS front page: a warm near-black
// field with a gold orbital glow, the brand eyebrow and a gold call-to-action.
// Inline styles only (no <style> blocks, no external assets); every gradient
// sits over a solid fallback colour, so Outlook (which ignores gradients) still
// renders a clean dark card.
function shell({ heading, intro, buttonLabel, link, footnote }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0d0c0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0c0a;background-image:radial-gradient(120% 80% at 50% 0%, rgba(164,134,63,0.18), rgba(13,12,10,0) 60%);padding:36px 0;">
    <tr><td align="center" style="padding:0 16px;">
      <table role="presentation" width="490" cellpadding="0" cellspacing="0" style="max-width:490px;width:100%;background:#16130d;border-radius:16px;border:1px solid rgba(164,134,63,0.30);overflow:hidden;">
        <tr><td align="center" style="padding:34px 36px 0 36px;background-image:radial-gradient(90% 130% at 50% 0%, rgba(164,134,63,0.22), rgba(22,19,13,0) 60%);">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:66px;height:66px;border-radius:50%;border:1px solid rgba(231,212,146,0.50);background:#0f0d09;background-image:radial-gradient(circle at 50% 42%, rgba(231,212,146,0.42), rgba(15,13,9,0) 70%);text-align:center;vertical-align:middle;">
              <div style="width:9px;height:9px;border-radius:50%;background:#e7d492;margin:0 auto;box-shadow:0 0 10px rgba(231,212,146,0.9);"></div>
            </td>
          </tr></table>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.17em;text-transform:uppercase;color:#c7b47e;font-weight:700;margin-top:16px;">${BRAND}</div>
        </td></tr>
        <tr><td style="padding:16px 36px 0 36px;">
          <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.32;color:#f4f1e6;margin:0;font-weight:600;letter-spacing:-.01em;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:14px 36px 0 36px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:#c3bcab;">
          ${intro}
        </td></tr>
        <tr><td style="padding:24px 36px 4px 36px;">
          <a href="${link}" style="display:inline-block;background:#e7d492;color:#1a160c;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;font-weight:700;padding:13px 26px;border-radius:9px;">${buttonLabel}</a>
        </td></tr>
        <tr><td style="padding:18px 36px 4px 36px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8f897b;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${link}" style="color:#e7d492;word-break:break-all;">${link}</a>
        </td></tr>
        <tr><td style="padding:20px 36px 30px 36px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#7d776a;border-top:1px solid rgba(164,134,63,0.18);">
          ${footnote}
        </td></tr>
      </table>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#5f5a4f;margin-top:16px;letter-spacing:.05em;">One sphere. Every number connected.</div>
    </td></tr>
  </table></body></html>`;
}

function textBody(lines) {
  return lines.filter((l) => l !== null && l !== undefined).join("\n");
}

// £ with comma thousands, nearest pound — the operational house style.
function gbp(v) {
  const n = Number(v);
  return "£" + (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString("en-GB");
}
// A compact HTML fact block ([label, value] pairs; blank values skipped).
function facts(pairs) {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([l, v]) => `<strong style="color:#e7d492;font-weight:600;">${l}:</strong> ${v}`)
    .join("<br>");
}

/*
 * Invite email — a brand-new account. `link` is the set-password URL,
 * `expiresHours` how long it lasts, `inviterName` optional (who added them).
 */
export function inviteEmail({ name, link, expiresHours = 48, inviterName } = {}) {
  const who = inviterName ? ` by ${inviterName}` : "";
  const first = name ? name.split(" ")[0] : "there";
  const subject = "Set up your Miniso UK Finance OS account";
  const html = shell({
    heading: "Welcome to Finance OS",
    intro: `Hi ${first},<br><br>An account has been created for you${who} on the Miniso UK Finance OS. To get started, set your password using the button below and then sign in.`,
    buttonLabel: "Set your password",
    link,
    footnote: `This link is valid for ${expiresHours} hours and can be used once. If you weren't expecting this, you can ignore this email — no account can be accessed without setting a password.`,
  });
  const text = textBody([
    `Hi ${first},`,
    "",
    `An account has been created for you${who} on the Miniso UK Finance OS.`,
    "Set your password using this link, then sign in:",
    "",
    link,
    "",
    `This link is valid for ${expiresHours} hours and can be used once.`,
    "If you weren't expecting this, you can ignore this email.",
  ]);
  return { subject, html, text };
}

/*
 * Reset email — an existing account whose owner needs a fresh password link.
 * The old password keeps working until a new one is set.
 */
export function resetEmail({ name, link, expiresHours = 48 } = {}) {
  const first = name ? name.split(" ")[0] : "there";
  const subject = "Reset your Miniso UK Finance OS password";
  const html = shell({
    heading: "Reset your password",
    intro: `Hi ${first},<br><br>A password reset was requested for your Miniso UK Finance OS account. Choose a new password using the button below. If you didn't request this, you can safely ignore this email — your current password will keep working.`,
    buttonLabel: "Choose a new password",
    link,
    footnote: `This link is valid for ${expiresHours} hours and can be used once.`,
  });
  const text = textBody([
    `Hi ${first},`,
    "",
    "A password reset was requested for your Miniso UK Finance OS account.",
    "Choose a new password using this link:",
    "",
    link,
    "",
    `This link is valid for ${expiresHours} hours and can be used once.`,
    "If you didn't request this, you can ignore this email — your current password will keep working.",
  ]);
  return { subject, html, text };
}

/*
 * A purchase order has been submitted for sign-off — to the department's sign-off
 * approver(s). `ref` is the P.O reference, `submitter` who raised it, `value` the
 * amount, `link` the Purchase Order Requests screen.
 */
export function poSignoffEmail({ ref, submitter, department, supplier, value, link } = {}) {
  const who = submitter ? `${submitter}` : "A colleague";
  const subject = `Sign-off needed: ${ref} (${gbp(value)})`;
  const html = shell({
    heading: "A purchase order needs your sign-off",
    intro: `${who} has submitted a purchase order for your sign-off.<br><br>${facts([
      ["Reference", ref], ["Department", department], ["Supplier", supplier], ["Value", gbp(value)], ["Submitted by", submitter],
    ])}`,
    buttonLabel: "Review & sign off",
    link,
    footnote: `You're receiving this because you're a sign-off approver${department ? ` for ${department}` : ""}. Approve or reject it on the Purchase Order Requests screen.`,
  });
  const text = textBody([
    `${who} has submitted a purchase order for your sign-off.`,
    "",
    `Reference: ${ref}`,
    department ? `Department: ${department}` : null,
    supplier ? `Supplier: ${supplier}` : null,
    `Value: ${gbp(value)}`,
    submitter ? `Submitted by: ${submitter}` : null,
    "",
    "Review and sign off here:",
    link,
  ]);
  return { subject, html, text };
}

/*
 * An approver has decided a submitter's P.O — to the submitter. `decision` is
 * "APPROVED" or "REJECTED"; `approver` who decided; `note` optional.
 */
export function poDecisionEmail({ ref, decision, approver, value, note, link } = {}) {
  const approved = decision === "APPROVED";
  const verb = approved ? "approved" : "rejected";
  const subject = `Your purchase order ${ref} was ${verb}`;
  const html = shell({
    heading: `Your purchase order was ${verb}`,
    intro: `${approver || "An approver"} has ${verb} your purchase order.<br><br>${facts([
      ["Reference", ref], ["Value", gbp(value)], ["Decision", approved ? "Approved" : "Rejected"], [approved ? null : "Reason", note],
    ].filter(([l]) => l))}`,
    buttonLabel: "View in Finance OS",
    link,
    footnote: approved
      ? "The purchase order has been signed off and moves to Finance for processing."
      : "The purchase order has been sent back. Open it to see any note, make changes and resubmit.",
  });
  const text = textBody([
    `${approver || "An approver"} has ${verb} your purchase order.`,
    "",
    `Reference: ${ref}`,
    `Value: ${gbp(value)}`,
    `Decision: ${approved ? "Approved" : "Rejected"}`,
    !approved && note ? `Reason: ${note}` : null,
    "",
    "View it here:",
    link,
  ]);
  return { subject, html, text };
}

/*
 * Finance has challenged a signed-off P.O back to the submitter to edit — to the
 * submitter. `reasons` is a readable string (or array) of challenge reasons.
 */
export function poChallengeEmail({ ref, reasons, note, value, link } = {}) {
  const reasonText = Array.isArray(reasons) ? reasons.join(", ") : (reasons || "");
  const subject = `Finance has challenged your purchase order ${ref}`;
  const html = shell({
    heading: "Finance has challenged your purchase order",
    intro: `Finance has challenged your purchase order and returned it to you to review.<br><br>${facts([
      ["Reference", ref], ["Value", gbp(value)], ["Reasons", reasonText], ["Note", note],
    ])}`,
    buttonLabel: "Edit & resubmit",
    link,
    footnote: "Open it on the Purchase Order Requests screen, make the changes and resubmit it.",
  });
  const text = textBody([
    "Finance has challenged your purchase order and returned it to you to review.",
    "",
    `Reference: ${ref}`,
    `Value: ${gbp(value)}`,
    reasonText ? `Reasons: ${reasonText}` : null,
    note ? `Note: ${note}` : null,
    "",
    "Edit and resubmit here:",
    link,
  ]);
  return { subject, html, text };
}

/*
 * A merchandising / procurement request has been raised — to the Finance/Ops
 * reviewers. `ref` is the request reference, `submitter` who raised it, `channel`
 * the readable channel, `link` the Procurement Requests screen.
 */
export function merchRequestEmail({ ref, submitter, channel, supplier, value, period, reason, link } = {}) {
  const subject = `New procurement request to review: ${ref} (${gbp(value)})`;
  const html = shell({
    heading: "A procurement request needs review",
    intro: `${submitter || "A colleague"} has raised a merchandising / procurement request.<br><br>${facts([
      ["Reference", ref], ["Channel", channel], ["Supplier", supplier], ["Value", gbp(value)], ["OTB period", period], ["Reason", reason],
    ])}`,
    buttonLabel: "Review the request",
    link,
    footnote: "You're receiving this because you're a Finance / Ops reviewer. Validate it against the Open-to-Buy and take it through review on the Procurement Requests screen.",
  });
  const text = textBody([
    `${submitter || "A colleague"} has raised a merchandising / procurement request.`,
    "",
    `Reference: ${ref}`,
    channel ? `Channel: ${channel}` : null,
    supplier ? `Supplier: ${supplier}` : null,
    `Value: ${gbp(value)}`,
    period ? `OTB period: ${period}` : null,
    reason ? `Reason: ${reason}` : null,
    "",
    "Review it here:",
    link,
  ]);
  return { subject, html, text };
}
