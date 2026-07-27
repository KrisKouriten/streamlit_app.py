"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SUBJECTS = [
  ["MANAGEMENT_ACCOUNTS", "Management accounts"],
  ["CASH", "Cash flow"],
  ["TRADING", "Trading & stores"],
  ["BOARD", "Board pack"],
];

const btn = { fontSize: 12.5, fontWeight: 600, borderRadius: 9, padding: "7px 13px", cursor: "pointer", border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)" };

export function DraftControl() {
  const router = useRouter();
  const [subject, setSubject] = useState("MANAGEMENT_ACCOUNTS");
  const [scopeRef, setScopeRef] = useState("");
  const [state, setState] = useState("");
  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/intelligence/commentary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, scopeRef: scopeRef || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setState(data.error || (data.refusal ? "Model declined" : "Could not draft")); return; }
      setState(""); setScopeRef("");
      router.push(`/finance-os/commentary?c=${data.commentaryId}`);
      router.refresh();
    } catch { setState("Network error"); }
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...btn, cursor: "default" }}>
        {SUBJECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} placeholder="Period / entity (optional)"
        style={{ ...btn, cursor: "text", minWidth: 180 }} />
      <button onClick={run} disabled={state === "running"} style={{ ...btn, color: "var(--accent-ink)", background: "var(--accent)", border: "1px solid var(--accent-deep)" }}>
        {state === "running" ? "Drafting…" : "✦ Draft commentary"}
      </button>
      {state && state !== "running" && <span style={{ fontSize: 12, color: "var(--red)" }}>{state}</span>}
    </div>
  );
}

export function SignOffControls({ commentaryId }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [state, setState] = useState("");
  async function decide(decision) {
    setState(decision);
    try {
      const res = await fetch("/api/intelligence/commentary/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentaryId, decision, note: note || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setState(data.error || "Failed"); return; }
      router.refresh();
    } catch { setState("Network error"); }
  }
  const busy = state === "APPROVED" || state === "REJECTED";
  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
      <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 8 }}>Sign-off</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reviewer note (optional)"
        rows={2} style={{ width: "100%", fontSize: 13, borderRadius: 9, border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)", padding: "8px 10px", resize: "vertical", marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => decide("APPROVED")} disabled={busy} style={{ ...btn, color: "#fff", background: "var(--green)", border: "1px solid var(--green)" }}>Approve</button>
        <button onClick={() => decide("REJECTED")} disabled={busy} style={{ ...btn, color: "var(--red)", borderColor: "var(--red)" }}>Reject</button>
        {typeof state === "string" && !["", "APPROVED", "REJECTED"].includes(state) && <span style={{ fontSize: 12, color: "var(--red)" }}>{state}</span>}
      </div>
    </div>
  );
}
