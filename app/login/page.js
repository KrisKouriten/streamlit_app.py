"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* The doorway. A quiet, lit field with the orbital motif behind a glass card —
   the first thing anyone sees should already feel like the product. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not sign in");
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", position: "relative", overflow: "hidden" }}>
      {/* orbital field behind the card */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 780, height: 780, borderRadius: "50%",
          border: "1px solid color-mix(in srgb, var(--accent-deep) 55%, transparent)", opacity: .5 }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 520, height: 520, borderRadius: "50%",
          border: "1px dashed var(--line)", opacity: .6 }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 1000, height: 1000, borderRadius: "50%",
          background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 9%, transparent), transparent 62%)" }} />
      </div>

      <form onSubmit={submit} className="fos-glass fos-page" style={{ position: "relative", width: "100%", maxWidth: 384, borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-pop)", padding: "2rem 1.9rem 1.9rem" }}>
        <span className="fos-eyebrow">Miniso UK · Finance OS</span>
        <h1 style={{ fontSize: 22.5, fontWeight: 650, letterSpacing: "-.025em", margin: "14px 0 5px", lineHeight: 1.2 }}>The Connected Finance Function</h1>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 24, lineHeight: 1.55 }}>Sign in to your finance workspace.</p>

        <label htmlFor="fos-email" style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", display: "block", marginBottom: 7 }}>Email</label>
        <input id="fos-email" className="fos-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required
          style={{ marginBottom: 16 }} />

        <label htmlFor="fos-password" style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", display: "block", marginBottom: 7 }}>Password</label>
        <input id="fos-password" className="fos-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required
          style={{ marginBottom: 18 }} />

        {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 13 }}>{error}</div>}

        <button type="submit" disabled={busy} className="fos-btn" style={{ width: "100%", height: 44, fontSize: 14.5 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--glass-line)", fontSize: 11, color: "var(--faint)", lineHeight: 1.5 }}>
          One workspace for the numbers, the work, the agents and the follow-through.
        </div>
      </form>
    </div>
  );
}
