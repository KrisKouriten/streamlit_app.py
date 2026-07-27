"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MIN_LENGTH } from "../../lib/password-rules";

/* The password fields for an invite/reset link. On success it hands the user
   to /login with a flag so the sign-in page can confirm the account is ready. */
export default function SetPasswordForm({ token }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) { setError(`Password must be at least ${MIN_LENGTH} characters`); return; }
    if (password !== confirm) { setError("Password and confirmation do not match"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) router.push("/login?set=1");
      else setError(data.error || "Could not set your password");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  const labelStyle = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", display: "block", marginBottom: 7 };

  return (
    <form onSubmit={submit}>
      <label htmlFor="sp-pw" style={labelStyle}>New password</label>
      <input id="sp-pw" className="fos-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={MIN_LENGTH} required autoFocus style={{ marginBottom: 16 }} />

      <label htmlFor="sp-confirm" style={labelStyle}>Confirm password</label>
      <input id="sp-confirm" className="fos-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={MIN_LENGTH} required style={{ marginBottom: 18 }} />

      {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 13 }}>{error}</div>}

      <button type="submit" disabled={busy} className="fos-btn" style={{ width: "100%", height: 44, fontSize: 14.5 }}>
        {busy ? "Saving…" : "Set password & continue"}
      </button>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--glass-line)", fontSize: 11, color: "var(--faint)", lineHeight: 1.5 }}>
        Choose something at least {MIN_LENGTH} characters. You'll use it with your email address to sign in.
      </div>
    </form>
  );
}
