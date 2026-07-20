"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export const LIFECYCLE_STYLE = {
  GENERATED: ["var(--muted)", "var(--line)"],
  AUTOMATED_VALIDATION: ["var(--red)", "var(--red-bg)"],
  PENDING_REVIEW: ["var(--amber)", "var(--amber-bg)"],
  APPROVED: ["var(--green)", "var(--green-bg)"],
  AMENDED: ["var(--green)", "var(--green-bg)"],
  REJECTED: ["var(--red)", "var(--red-bg)"],
  ACTION_CREATED: ["var(--accent)", "var(--accent-bg)"],
  CLOSED: ["var(--faint)", "var(--line)"],
};
export function LifecycleChip({ lifecycle }) {
  const [fg, bg] = LIFECYCLE_STYLE[lifecycle] || ["var(--muted)", "var(--line)"];
  return <span role="status" style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{lifecycle.replace(/_/g, " ")}</span>;
}

export async function agentApi(body) {
  const res = await fetch("/api/agents", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Action failed");
  return data;
}

export function RunAgentButton({ agentCode, canRun }) {
  const router = useRouter();
  const [state, setState] = useState("");
  if (!canRun) return null;
  async function run() {
    setState("running");
    try {
      const r = await agentApi({ action: "run", agentCode });
      setState(`done: ${r.outputs} output(s)`);
      router.push(`/ai/runs/${r.runId}`);
    } catch (e) { setState(e.message); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button onClick={run} disabled={state === "running"} style={{
        height: 32, padding: "0 14px", border: "none", borderRadius: 8,
        background: "var(--accent)", color: "#fff", fontSize: 12.5, cursor: "pointer", opacity: state === "running" ? 0.6 : 1,
      }}>{state === "running" ? "Running…" : "Run now"}</button>
      {state && state !== "running" && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{state}</span>}
    </span>
  );
}

export function OutputReviewPanel({ output, canReview }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [amendHeadline, setAmendHeadline] = useState("");
  const [amendBody, setAmendBody] = useState("");
  const [createAction, setCreateAction] = useState(!!output.recommended_action);
  const [showAmend, setShowAmend] = useState(false);
  if (!canReview || output.lifecycle !== "PENDING_REVIEW") return null;

  async function decide(action) {
    setErr("");
    try {
      await agentApi({ action, outputId: output.output_id, comment, createAction,
        amendedHeadline: amendHeadline, amendedBody: amendBody });
      router.refresh();
    } catch (e) { setErr(e.message); }
  }
  const input = { padding: "6px 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 13, width: "100%" };
  const btn = (bg) => ({ height: 32, padding: "0 14px", border: "none", borderRadius: 8, background: bg, color: "#fff", fontSize: 12.5, cursor: "pointer" });

  return (
    <div style={{ marginTop: 10, background: "var(--amber-bg)", border: "1px solid var(--amber)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...input, flex: 1, minWidth: 200 }} placeholder="Review comment (required when rejecting)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={createAction} onChange={(e) => setCreateAction(e.target.checked)} disabled={!output.recommended_action} />
          create action
        </label>
        <button style={btn("var(--accent)")} onClick={() => decide("approve")}>Approve</button>
        <button style={btn("var(--amber)")} onClick={() => setShowAmend(!showAmend)}>Amend…</button>
        <button style={btn("var(--red)")} onClick={() => comment.trim() ? decide("reject") : setErr("A comment is required when rejecting")}>Reject</button>
      </div>
      {showAmend && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          <input style={input} placeholder="Amended headline (leave blank to keep)" value={amendHeadline} onChange={(e) => setAmendHeadline(e.target.value)} />
          <textarea style={{ ...input, minHeight: 70 }} placeholder="Amended narrative (leave blank to keep)" value={amendBody} onChange={(e) => setAmendBody(e.target.value)} />
          <button style={{ ...btn("var(--amber)"), alignSelf: "flex-start" }}
            onClick={() => (amendHeadline.trim() || amendBody.trim()) ? decide("amend") : setErr("An amendment must change the headline or narrative")}>
            Save amendment & approve
          </button>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{err}</div>}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
        Approval publishes this as a governed insight{output.recommended_action ? " (and optionally an action)" : ""}; the decision is recorded permanently.
      </div>
    </div>
  );
}
