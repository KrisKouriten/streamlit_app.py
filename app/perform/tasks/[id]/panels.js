"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { taskAction } from "../../task-ui";

const input = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 13.5 };
const btn = { height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 13, cursor: "pointer" };

export default function TaskPanels({ task, canReview }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [ev, setEv] = useState({ label: "", url: "", note: "" });
  const [reviewComment, setReviewComment] = useState("");

  async function act(body, reset) {
    setErr("");
    try { await taskAction({ taskId: task.task_id, ...body }); reset?.(); router.refresh(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
      {err && <div style={{ gridColumn: "1/-1", fontSize: 13, color: "#a32d2d" }}>{err}</div>}

      {canReview && (
        <section style={{ gridColumn: "1/-1", background: "var(--amber-bg)", border: "1px solid var(--amber)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Reviewer decision</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...input, flex: 1, minWidth: 220 }} placeholder="Review comment (required when returning)"
              value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
            <button style={btn} onClick={() => act({ action: "approve", comment: reviewComment }, () => setReviewComment(""))}>Approve</button>
            <button style={{ ...btn, background: "#a32d2d" }}
              onClick={() => reviewComment.trim() ? act({ action: "return", comment: reviewComment }, () => setReviewComment("")) : setErr("A comment is required when returning a task")}>
              Return
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Approval marks the task COMPLETE and is recorded permanently. Returning sends it back to the assignee.</div>
        </section>
      )}

      <section>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Evidence ({task.evidence.length})</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
          {task.evidence.length === 0 && <div style={{ fontSize: 13, color: "var(--faint)", padding: "4px 0 10px" }}>No evidence attached yet.</div>}
          {task.evidence.map((e) => (
            <div key={e.evidence_id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.label} ↗</a> : <strong>{e.label}</strong>}
              {e.note && <span style={{ color: "var(--muted)" }}> — {e.note}</span>}
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{e.added_by}</div>
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            <input style={input} placeholder="Evidence label (e.g. Bank rec summary w/c 20 Jul)" value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} />
            <input style={input} placeholder="Link (SharePoint / Drive URL — optional)" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} />
            <button style={{ ...btn, alignSelf: "flex-start" }}
              onClick={() => ev.label.trim() ? act({ action: "evidence", ...ev }, () => setEv({ label: "", url: "", note: "" })) : setErr("Evidence needs a label")}>
              Attach evidence
            </button>
          </div>
        </div>
      </section>

      <section>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Comments ({task.comments.length})</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
          {task.comments.map((c) => (
            <div key={c.comment_id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div>{c.body}</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{c.author} · {new Date(c.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input style={{ ...input, flex: 1 }} placeholder="Add a comment…" value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && comment.trim()) act({ action: "comment", body: comment }, () => setComment("")); }} />
            <button style={btn} onClick={() => comment.trim() && act({ action: "comment", body: comment }, () => setComment(""))}>Post</button>
          </div>
        </div>
        {task.reviews.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)" }}>
            Review history: {task.reviews.map((r) => `${r.decision} by ${r.reviewer}${r.comment ? ` ("${r.comment}")` : ""}`).join(" · ")}
          </div>
        )}
      </section>
    </div>
  );
}
