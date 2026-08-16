"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ConnectedSphere from "../connected-sphere";

/* The doorway. The connected sphere fills the field — the whole concept, live —
   and the sign-in details stay out of the way behind a "Sign in" control until
   they're asked for, so the first thing anyone sees is the product itself. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("password"); // "password" | "mfa"
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false); // sign-in panel revealed
  const emailRef = useRef(null);

  // A user who just set their password via an invite/reset link lands here with
  // ?set=1 — confirm the account is ready and open the sign-in panel for them.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("set") === "1") {
        setNotice("Your password has been set. Sign in below to continue.");
        setOpen(true);
      }
    } catch {}
  }, []);

  // Close the panel on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus the first field when the panel opens.
  useEffect(() => { if (open && step === "password") setTimeout(() => emailRef.current?.focus(), 80); }, [open, step]);

  function safeNext() {
    try {
      const n = new URLSearchParams(window.location.search).get("next");
      if (n && n.startsWith("/") && !n.startsWith("//")) return n;
    } catch {}
    return "/";
  }
  function done() { router.push(safeNext()); router.refresh(); }

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { if (data.mfaRequired) { setStep("mfa"); setError(""); } else done(); }
      else setError(data.error || "Could not sign in");
    } catch { setError("Could not reach the server"); }
    finally { setBusy(false); }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) done();
      else setError(data.error || "That code didn't match");
    } catch { setError("Could not reach the server"); }
    finally { setBusy(false); }
  }

  const lbl = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", display: "block", marginBottom: 7 };

  return (
    <div className="fos-force-dark" style={{ minHeight: "100vh", position: "relative", overflow: "hidden", color: "var(--ink)",
      background: "radial-gradient(120% 90% at 50% 46%, rgba(164,134,63,0.16), transparent 60%), linear-gradient(180deg, #0d0c0a 0%, #12100b 55%, #0d0c0a 100%)" }}>

      <style>{`
        @keyframes lgRise { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: none; } }
        @keyframes lgSphereIn { from { opacity: 0; transform: scale(1.08); } to { opacity: 1; transform: none; } }
        .lg-rise { opacity: 0; animation: lgRise .8s cubic-bezier(.2,.7,.2,1) both; }
        .lg-sphere-in { animation: lgSphereIn 1.2s cubic-bezier(.2,.7,.2,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .lg-rise, .lg-sphere-in { animation: none; opacity: 1; }
        }
      `}</style>

      {/* the connected sphere — the whole concept, live. Scales in on first paint and
          carries a slight brightness/saturation + bloom lift so it stands out. */}
      <div className="lg-sphere-in" style={{ position: "absolute", inset: 0, zIndex: 0,
        filter: "brightness(1.04) drop-shadow(0 0 50px rgba(255,255,255,.10))" }}>
        <ConnectedSphere labels shell />
      </div>

      {/* vignette + film grain — kills gradient banding and adds atmosphere */}
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
        background: "radial-gradient(120% 90% at 50% 42%, transparent 52%, rgba(0,0,0,.5))" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: 0.05, mixBlendMode: "overlay",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      {/* tagline overlay (non-interactive) */}
      <div style={{ position: "relative", zIndex: 2, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "clamp(20px,4vw,46px)", pointerEvents: "none" }}>
        <div style={{ maxWidth: 640 }}>
          <span className="fos-eyebrow lg-rise" style={{ animationDelay: "60ms" }}>Miniso UK · Finance OS</span>
          <h1 className="lg-rise" style={{ animationDelay: "150ms", fontWeight: 600, fontSize: "clamp(30px,5.4vw,58px)", lineHeight: 1.03, letterSpacing: "-.03em", margin: "18px 0 0", textWrap: "balance", textShadow: "0 2px 40px rgba(0,0,0,.6)" }}>
            One sphere.<br />
            <span style={{ backgroundImage: "linear-gradient(96deg, #f4e6ac, #e7d492 55%, #a4863f)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Every number connected.</span>
          </h1>
          <p className="lg-rise" style={{ animationDelay: "320ms", fontSize: "clamp(14px,1.6vw,17px)", color: "var(--muted)", lineHeight: 1.55, margin: "16px 0 0", maxWidth: "44ch" }}>
            Stores, ledgers, pricing, stock and plans — every feed crossing the same surface and drawn into one control tower at the centre.
          </p>
        </div>
        <div className="lg-rise" style={{ animationDelay: "460ms", display: "flex", gap: 18, flexWrap: "wrap", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
          {[["#f4e6ac", "Pillars"], ["#e7d492", "Data feeds"], ["#cf8f4a", "Live streams"]].map(([c, l]) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <i style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 9px ${c}` }} />{l}
            </span>
          ))}
        </div>
      </div>

      {/* top-right sign-in control */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="signin-panel" className="fos-btn lg-rise"
        style={{ position: "fixed", top: 22, right: 24, zIndex: 6, height: 40, padding: "0 18px", fontSize: 13.5, animationDelay: "560ms" }}>
        {open ? "Close" : "Sign in"}
      </button>

      {/* the reveal panel */}
      <div id="signin-panel" role="dialog" aria-label="Sign in" className="fos-glass"
        style={{ position: "fixed", top: 72, right: 24, zIndex: 6, width: 340, maxWidth: "calc(100vw - 40px)", borderRadius: 16, padding: "22px 22px 20px", boxShadow: "var(--shadow-pop)",
          opacity: open ? 1 : 0, transform: open ? "translateY(0) scale(1)" : "translateY(-10px) scale(.98)", pointerEvents: open ? "auto" : "none", transition: "opacity .22s ease, transform .22s ease" }}>
        {step === "password" ? (
          <form onSubmit={submit}>
            <span className="fos-eyebrow">Miniso UK · Finance OS</span>
            <h2 style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-.02em", margin: "12px 0 3px" }}>Welcome back</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 18px" }}>Sign in to your finance workspace.</p>
            {notice && <div style={{ fontSize: 12.5, color: "var(--green)", background: "var(--green-bg)", border: "1px solid color-mix(in srgb, var(--green) 40%, transparent)", borderRadius: 8, padding: "9px 12px", marginBottom: 15, lineHeight: 1.45 }}>{notice}</div>}
            <label htmlFor="fos-email" style={lbl}>Email</label>
            <input id="fos-email" ref={emailRef} className="fos-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required style={{ marginBottom: 15 }} />
            <label htmlFor="fos-password" style={lbl}>Password</label>
            <input id="fos-password" className="fos-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required style={{ marginBottom: 16 }} />
            {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={busy} className="fos-btn" style={{ width: "100%", height: 44, fontSize: 14.5 }}>{busy ? "Signing in…" : "Sign in"}</button>
            <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid var(--glass-line)", fontSize: 11, color: "var(--faint)", lineHeight: 1.5 }}>One workspace for the numbers, the work, the agents and the follow-through.</div>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <span className="fos-eyebrow">Miniso UK · Finance OS</span>
            <h2 style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-.02em", margin: "12px 0 3px" }}>Two-step verification</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 18px" }}>Enter the 6-digit code from your authenticator app.</p>
            <label htmlFor="fos-code" style={lbl}>Authentication code</label>
            <input id="fos-code" className="fos-input" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" required style={{ marginBottom: 16, letterSpacing: ".2em", fontFamily: "var(--mono)" }} />
            {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={busy} className="fos-btn" style={{ width: "100%", height: 44, fontSize: 14.5 }}>{busy ? "Verifying…" : "Verify"}</button>
            <button type="button" onClick={() => { setStep("password"); setCode(""); setError(""); }} className="fos-btn-ghost" style={{ width: "100%", marginTop: 10, fontSize: 12.5, justifyContent: "center" }}>Back</button>
            <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--glass-line)", fontSize: 11, color: "var(--faint)", lineHeight: 1.5 }}>Lost your device? Enter one of your recovery codes instead.</div>
          </form>
        )}
      </div>
    </div>
  );
}
