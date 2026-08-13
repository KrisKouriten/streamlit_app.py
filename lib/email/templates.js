/*
 * Pure email builders — no I/O, so they are unit-testable and the transport
 * (lib/email/resend.js) just posts whatever these return. House style: Miniso
 * UK, en-GB, plain and calm. Every email has both an HTML and a text body.
 */

const BRAND = "Miniso UK · Finance OS";

// Minimal, email-client-safe HTML. Inline styles only (no <style> blocks, no
// external assets) so it renders the same in Outlook, Gmail and Apple Mail.
function shell({ heading, intro, buttonLabel, link, footnote }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e6e8eb;overflow:hidden;">
        <tr><td style="padding:26px 32px 0 32px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:#8a9099;font-weight:600;">${BRAND}</div>
          <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.3;color:#1a1d21;margin:12px 0 0 0;font-weight:650;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:14px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:#42474d;">
          ${intro}
        </td></tr>
        <tr><td style="padding:22px 32px 4px 32px;">
          <a href="${link}" style="display:inline-block;background:#2f6df6;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;font-weight:600;padding:12px 22px;border-radius:8px;">${buttonLabel}</a>
        </td></tr>
        <tr><td style="padding:16px 32px 4px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#6b7178;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${link}" style="color:#2f6df6;word-break:break-all;">${link}</a>
        </td></tr>
        <tr><td style="padding:18px 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a9099;border-top:1px solid #eef0f2;margin-top:12px;">
          ${footnote}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function textBody(lines) {
  return lines.filter((l) => l !== null && l !== undefined).join("\n");
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
