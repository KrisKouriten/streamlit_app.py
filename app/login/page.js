"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "1.75rem" }}>
        <div style={{ fontSize: 13, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 6 }}>Finance</div>
        <h1 style={{ fontSize: 21, fontWeight: 600, marginBottom: 4 }}>Month-end close</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 20 }}>Sign in to update the close.</p>

        <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 5 }}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required
          style={{ width: "100%", height: 40, padding: "0 12px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", marginBottom: 14, fontSize: 15 }} />

        <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 5 }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required
          style={{ width: "100%", height: 40, padding: "0 12px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", marginBottom: 16, fontSize: 15 }} />

        {error && <div style={{ fontSize: 13, color: "#a32d2d", marginBottom: 12 }}>{error}</div>}

        <button type="submit" disabled={busy}
          style={{ width: "100%", height: 42, border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 15, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
