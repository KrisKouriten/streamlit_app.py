"use client";

import { useState } from "react";
import { MIN_LENGTH, validatePasswordChange } from "../../../lib/password-rules";

/* Self-service "change your password" card. Proves the current password on the
   server before setting the new one; on success every other session is dropped
   and the user is told how many. Client-side validation mirrors the pure rules
   the API enforces, so obvious mistakes are caught before the round-trip. */
export default function PasswordUI() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(null); setOk(null);
    const check = validatePasswordChange({ current, next, confirm });
    if (!check.ok) { setErr(check.error); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next, confirm }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong");
      setCurrent(""); setNext(""); setConfirm("");
      setOk(j.otherSessionsEnded > 0
        ? `Password changed. Signed out of ${j.otherSessionsEnded} other session${j.otherSessionsEnded === 1 ? "" : "s"}.`
        : "Password changed.");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const card = { padding: "18px 20px", display: "grid", gap: 12 };
  const field = { display: "grid", gap: 6, maxWidth: 340 };
  const input = { padding: "9px 11px", fontSize: 14, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" };

  return (
    <form className="fos-card" style={card} onSubmit={submit}>
      <div style={{ fontSize: 15, fontWeight: 650 }}>Password</div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
        Change your sign-in password. You&#39;ll stay signed in here; any other device is signed out.
      </p>

      <div style={field}>
        <label className="fos-eyebrow" htmlFor="pw-current">Current password</label>
        <input id="pw-current" type="password" autoComplete="current-password" style={input} value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div style={field}>
        <label className="fos-eyebrow" htmlFor="pw-next">New password</label>
        <input id="pw-next" type="password" autoComplete="new-password" style={input} value={next} onChange={(e) => setNext(e.target.value)} placeholder={`At least ${MIN_LENGTH} characters`} />
      </div>
      <div style={field}>
        <label className="fos-eyebrow" htmlFor="pw-confirm">Confirm new password</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
      {ok && <div style={{ color: "var(--green)", fontSize: 13 }}>{ok}</div>}

      <div>
        <button className="fos-btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
      </div>
    </form>
  );
}
