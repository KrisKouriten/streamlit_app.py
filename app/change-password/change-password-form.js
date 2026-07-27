"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MIN_LENGTH } from "../../lib/password-rules";

/* New-password fields for the forced first-sign-in change. No "current
   password" field — the user proved it at sign-in a moment ago. On success we
   send them to the home hub; the fresh session issued by the API clears the
   forced-change gate. */
export default function ChangePasswordForm() {
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
      const res = await fetch("/api/account/first-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { router.push("/"); router.refresh(); }
      else setError(data.error || "Could not set your password");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  const labelStyle = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", display: "block", marginBottom: 7 };
  const inputStyle = { width: "100%", padding: "9px 11px", fontSize: 14, border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)" };

  return (
    <form onSubmit={submit}>
      <label htmlFor="cp-pw" style={labelStyle}>New password</label>
      <input id="cp-pw" type="password" style={{ ...inputStyle, marginBottom: 16 }} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={MIN_LENGTH} required autoFocus />

      <label htmlFor="cp-confirm" style={labelStyle}>Confirm password</label>
      <input id="cp-confirm" type="password" style={{ ...inputStyle, marginBottom: 18 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={MIN_LENGTH} required />

      {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 13 }}>{error}</div>}

      <button type="submit" disabled={busy} className="fos-btn" style={{ width: "100%", height: 44, fontSize: 14.5 }}>
        {busy ? "Saving…" : "Set password & continue"}
      </button>
      <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--faint)", lineHeight: 1.5 }}>
        At least {MIN_LENGTH} characters, and different from the temporary one you were given.
      </div>
    </form>
  );
}
