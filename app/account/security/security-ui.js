"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const when = (t) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function SecurityUI({ status, name, email }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // enrolment flow state
  const [enrol, setEnrol] = useState(null); // { secret, otpauth }
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(null); // string[] shown once
  const [manageCode, setManageCode] = useState("");

  async function call(payload) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong");
      return j;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }

  async function begin() {
    const j = await call({ action: "begin" });
    if (j) { setEnrol({ secret: j.secret, otpauth: j.otpauth }); setRecovery(null); setCode(""); }
  }
  async function confirm(e) {
    e.preventDefault();
    const j = await call({ action: "confirm", code });
    if (j) { setRecovery(j.recoveryCodes); setEnrol(null); setCode(""); router.refresh(); }
  }
  async function disable() {
    if (!manageCode) { setErr("Enter a current code to turn two-step off"); return; }
    const j = await call({ action: "disable", code: manageCode });
    if (j) { setManageCode(""); router.refresh(); }
  }
  async function regenerate() {
    if (!manageCode) { setErr("Enter a current code to regenerate recovery codes"); return; }
    const j = await call({ action: "recovery-regenerate", code: manageCode });
    if (j) { setRecovery(j.recoveryCodes); setManageCode(""); router.refresh(); }
  }

  const card = { padding: "18px 20px", display: "grid", gap: 12 };
  const input = { padding: "9px 11px", fontSize: 14, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", letterSpacing: ".12em" };
  const mono = { fontFamily: "var(--mono)", fontSize: 13, wordBreak: "break-all" };

  // Recovery codes panel (shown once, right after confirm / regenerate).
  if (recovery) {
    return (
      <div className="fos-card" style={card}>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Save your recovery codes</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
          Each code works once if you lose your authenticator. Store them somewhere safe — <strong>they won&#39;t be shown again</strong>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8 }}>
          {recovery.map((c) => <span key={c} style={{ ...mono, letterSpacing: ".08em" }}>{c}</span>)}
        </div>
        <div>
          <button className="fos-btn" onClick={() => navigator.clipboard?.writeText(recovery.join("\n")).catch(() => {})} style={{ fontSize: 13 }}>Copy codes</button>
          <button className="fos-btn-ghost" onClick={() => { setRecovery(null); router.refresh(); }} style={{ fontSize: 13, marginLeft: 8 }}>Done</button>
        </div>
      </div>
    );
  }

  // Mid-enrolment: show the secret and a field to confirm the first code.
  if (enrol) {
    return (
      <form className="fos-card" style={card} onSubmit={confirm}>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Set up your authenticator</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
          In your authenticator app (Google Authenticator, Authy, 1Password…), add an account and enter this setup key, then type the 6-digit code it shows.
        </p>
        <div>
          <div className="fos-eyebrow" style={{ margin: "0 0 6px" }}>Setup key</div>
          <div style={{ ...mono, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, letterSpacing: ".12em" }}>{enrol.secret}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>Account: {email} · Issuer: Miniso UK Finance OS · 6 digits · 30s</div>
        </div>
        <div>
          <div className="fos-eyebrow" style={{ margin: "0 0 6px" }}>Enter the 6-digit code</div>
          <input style={input} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" autoFocus />
        </div>
        {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
        <div>
          <button className="fos-btn" type="submit" disabled={busy}>{busy ? "Verifying…" : "Turn on two-step"}</button>
          <button className="fos-btn-ghost" type="button" onClick={() => { setEnrol(null); setErr(null); }} style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      </form>
    );
  }

  // Enrolled: manage.
  if (status.enrolled) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="fos-card" style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)", flex: "none" }} />
            <div style={{ fontSize: 15, fontWeight: 650 }}>Two-step verification is on</div>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Enabled {when(status.confirmedAt)} · <strong>{status.recoveryRemaining}</strong> recovery code{status.recoveryRemaining === 1 ? "" : "s"} left
            {status.recoveryRemaining <= 2 && <span style={{ color: "var(--amber, #b8860b)" }}> — running low, regenerate them</span>}
          </div>
        </div>
        <div className="fos-card" style={card}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Manage</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Enter a current code (or a recovery code) to confirm either change.</p>
          <input style={{ ...input, maxWidth: 220 }} inputMode="text" value={manageCode} onChange={(e) => setManageCode(e.target.value)} placeholder="123 456" />
          {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="fos-btn" onClick={regenerate} disabled={busy}>Regenerate recovery codes</button>
            <button className="fos-btn-ghost" onClick={disable} disabled={busy} style={{ color: "var(--red)" }}>Turn off two-step</button>
          </div>
        </div>
      </div>
    );
  }

  // Not enrolled.
  return (
    <div className="fos-card" style={card}>
      <div style={{ fontSize: 15, fontWeight: 650 }}>Two-step verification is off</div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
        Add a second step at sign-in with an authenticator app. You&#39;ll enter a 6-digit code after your password. Recommended for finance access.
      </p>
      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
      <div><button className="fos-btn" onClick={begin} disabled={busy}>{busy ? "Starting…" : "Turn on two-step"}</button></div>
    </div>
  );
}
