import { findInvite } from "../../lib/invite";
import { inviteProblemMessage } from "../../lib/invite-rules";
import SetPasswordForm from "./set-password-form";

/*
 * Public "set your password" page — the destination of an emailed invite or
 * reset link. It renders on the server so the one-time token is checked before
 * anything is shown; a bad/expired/used link shows a calm message instead of a
 * form. Setting the password itself is a POST to /api/auth/set-password.
 */
export const dynamic = "force-dynamic";

function Frame({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", position: "relative", overflow: "hidden" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 780, height: 780, borderRadius: "50%", border: "1px solid color-mix(in srgb, var(--accent-deep) 55%, transparent)", opacity: .5 }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 520, height: 520, borderRadius: "50%", border: "1px dashed var(--line)", opacity: .6 }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 1000, height: 1000, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 9%, transparent), transparent 62%)" }} />
      </div>
      <div className="fos-glass fos-page" style={{ position: "relative", width: "100%", maxWidth: 384, borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-pop)", padding: "2rem 1.9rem 1.9rem" }}>
        {children}
      </div>
    </div>
  );
}

export default async function SetPasswordPage({ searchParams }) {
  const token = typeof searchParams?.token === "string" ? searchParams.token : "";
  const found = await findInvite(token);

  if (!found.valid) {
    return (
      <Frame>
        <span className="fos-eyebrow">Miniso UK · Finance OS</span>
        <h1 style={{ fontSize: 21, fontWeight: 650, letterSpacing: "-.025em", margin: "14px 0 6px", lineHeight: 1.25 }}>Link not valid</h1>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 20, lineHeight: 1.55 }}>{inviteProblemMessage(found.reason)}</p>
        <a href="/login" className="fos-btn" style={{ width: "100%", height: 44, fontSize: 14.5, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Go to sign in</a>
      </Frame>
    );
  }

  const isReset = found.invite.purpose === "RESET";
  return (
    <Frame>
      <span className="fos-eyebrow">Miniso UK · Finance OS</span>
      <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.025em", margin: "14px 0 5px", lineHeight: 1.2 }}>
        {isReset ? "Choose a new password" : "Set your password"}
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 24, lineHeight: 1.55 }}>
        {found.invite.name ? `Hi ${found.invite.name.split(" ")[0]} — ` : ""}
        {isReset ? "pick a new password for your account, then sign in." : "welcome. Pick a password to activate your account, then sign in."}
      </p>
      <SetPasswordForm token={token} />
    </Frame>
  );
}
