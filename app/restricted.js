import Link from "next/link";

/* Shown in place of a sensitive page when the viewer isn't in the reporting
   protection group (Finance / Exec / Head / Admin). */
export default function Restricted({ title = "Restricted" }) {
  return (
    <div className="fos-shell">
      <div style={{ maxWidth: 520, margin: "12vh auto 0", textAlign: "center", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", padding: "34px 28px" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.01em" }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.55 }}>
          This information is restricted to Finance, Exec and department heads. If you need access,
          ask an administrator to review your role.
        </div>
        <Link href="/" style={{ display: "inline-block", marginTop: 18, fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>← Back to Home</Link>
      </div>
    </div>
  );
}
