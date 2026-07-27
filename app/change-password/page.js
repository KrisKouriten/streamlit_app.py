import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import ChangePasswordForm from "./change-password-form";

/*
 * Forced first-sign-in password change. A user issued a starter password by an
 * admin is diverted here by the root middleware and cannot reach the rest of
 * the app until they set their own password. Rendered inside the app shell (they
 * are signed in), but every other route bounces back here until it is done.
 */
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mustChange) redirect("/"); // normal users have nothing to do here

  const first = session.name ? session.name.split(" ")[0] : "there";
  return (
    <div className="fos-shell-narrow">
      <div className="fos-card fos-page" style={{ maxWidth: 440, margin: "3rem auto 0", padding: "1.75rem 1.75rem 1.5rem" }}>
        <span className="fos-eyebrow">Miniso UK · Finance OS</span>
        <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.025em", margin: "12px 0 6px", lineHeight: 1.2 }}>Set your own password</h1>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 22, lineHeight: 1.55 }}>
          Hi {first} — you signed in with a temporary password set by an administrator. Choose your own password to continue. You&#39;ll only be asked to do this once.
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
