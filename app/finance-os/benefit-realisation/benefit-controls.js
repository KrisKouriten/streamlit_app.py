"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = { fontSize: 12.5, borderRadius: 9, border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)", padding: "7px 10px" };
const btn = { fontSize: 12.5, fontWeight: 600, borderRadius: 9, padding: "7px 13px", cursor: "pointer", color: "var(--accent-ink)", background: "var(--accent)", border: "1px solid var(--accent-deep)" };

// Capture an AI recommendation as a tracked benefit opportunity. Prefills from
// query params so other surfaces (e.g. a briefing) can link straight in.
export function CaptureForm({ prefill = {} }) {
  const router = useRouter();
  const [title, setTitle] = useState(prefill.title || "");
  const [expected, setExpected] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  async function run() {
    if (!title.trim()) { setState("Title required"); return; }
    setState("running");
    try {
      const res = await fetch("/api/intelligence/benefit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "capture", title, expectedValueGbp: expected || null, category: category || null, runId: prefill.run || null, originSurface: prefill.origin || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setState(data.error || "Could not capture"); return; }
      setTitle(""); setExpected(""); setCategory(""); setState("");
      router.refresh();
    } catch { setState("Network error"); }
  }
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 20 }}>
      <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 8 }}>Capture an AI recommendation{prefill.run ? ` (run #${prefill.run})` : ""}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recommendation / opportunity" style={{ ...field, flex: "2 1 260px" }} />
        <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Expected £ (you set)" inputMode="numeric" style={{ ...field, flex: "1 1 140px" }} />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" style={{ ...field, flex: "1 1 140px" }} />
        <button onClick={run} disabled={state === "running"} style={btn}>{state === "running" ? "Saving…" : "Track benefit"}</button>
      </div>
      {state && state !== "running" && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{state}</div>}
      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>The expected value is yours to set — the model never invents a figure. Finance validation happens on Govern › Benefits.</div>
    </div>
  );
}

// Record a realised value against one opportunity.
export function RecordMeasurement({ opportunityId, suggested }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(suggested != null ? String(suggested) : "");
  const [state, setState] = useState("");
  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/intelligence/benefit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "measure", opportunityId, value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setState(data.error || "Failed"); return; }
      setOpen(false); router.refresh();
    } catch { setState("Network error"); }
  }
  if (!open) return <button onClick={() => setOpen(true)} style={{ ...field, cursor: "pointer", fontWeight: 600 }}>Record realised</button>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="£" inputMode="numeric" style={{ ...field, width: 90 }} />
      <button onClick={run} disabled={state === "running"} style={{ ...btn, padding: "6px 10px" }}>{state === "running" ? "…" : "Save"}</button>
      <button onClick={() => setOpen(false)} style={{ ...field, cursor: "pointer" }}>✕</button>
    </span>
  );
}
