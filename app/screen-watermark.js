"use client";

/* On-screen confidential watermark — a faint, tiled, diagonal repeat of the
   viewer's identity across sensitive pages, so any screenshot is traceable.
   Decorative and non-interactive (pointer-events: none); theme-aware via --ink. */
export default function ScreenWatermark({ text }) {
  if (!text) return null;
  const rows = Array.from({ length: 16 });
  const cols = Array.from({ length: 8 });
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 40, pointerEvents: "none", overflow: "hidden", userSelect: "none" }}>
      <div style={{ position: "absolute", top: "-25%", left: "-25%", width: "150%", height: "150%", transform: "rotate(-28deg)", display: "flex", flexDirection: "column", gap: 70, opacity: 0.05 }}>
        {rows.map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 90, whiteSpace: "nowrap" }}>
            {cols.map((_, c) => (
              <span key={c} style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".08em", color: "var(--ink)", textTransform: "uppercase", fontFamily: "var(--mono, ui-monospace, monospace)" }}>{text}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
