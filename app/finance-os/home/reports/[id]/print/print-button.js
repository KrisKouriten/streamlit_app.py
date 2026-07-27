"use client";
export default function PrintButton() {
  return (
    <button className="no-print" onClick={() => window.print()}
      style={{ fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 9, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent,#fff)", cursor: "pointer", marginBottom: 18 }}>
      Print / Save as PDF
    </button>
  );
}
