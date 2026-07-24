"use client";

// Triggers the browser's print dialog (→ Save as PDF). Hidden from the printed
// output itself via .no-print. Kept tiny and client-only so the page stays a
// server component.
export default function PrintButton() {
  return (
    <button className="fos-btn" onClick={() => window.print()} style={{ whiteSpace: "nowrap" }}>
      ⎙ Print / Save as PDF
    </button>
  );
}
