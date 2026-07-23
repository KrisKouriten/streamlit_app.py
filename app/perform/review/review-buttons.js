"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { taskAction } from "../task-ui";

export default function ReviewButtons({ taskId }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  async function act(action) {
    setErr("");
    if (action === "return" && !comment.trim()) { setErr("Comment required to return"); return; }
    try { await taskAction({ action, taskId, comment }); router.refresh(); }
    catch (e) { setErr(e.message); }
  }
  const b = { height: 30, padding: "0 12px", border: "none", borderRadius: 7, fontSize: 12.5, cursor: "pointer", color: "#fff" };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Review comment"
        style={{ height: 30, padding: "0 8px", border: "1px solid var(--line-strong)", borderRadius: 7, background: "var(--bg)", color: "var(--ink)", fontSize: 12.5, width: 180 }} />
      <button style={{ ...b, background: "var(--accent)" }} onClick={() => act("approve")}>Approve</button>
      <button style={{ ...b, background: "var(--red)" }} onClick={() => act("return")}>Return</button>
      {err && <span style={{ fontSize: 11.5, color: "var(--red)" }}>{err}</span>}
    </span>
  );
}
