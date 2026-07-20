"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { taskAction } from "../task-ui";

const btn = { height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 13, cursor: "pointer" };

export function GenerateWeek({ week }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  async function run() {
    setMsg("");
    try {
      const r = await taskAction({ action: "generate-week", weekStart: week });
      setMsg(`Created ${r.created} task${r.created === 1 ? "" : "s"}${r.escalated ? `, escalated ${r.escalated} overdue` : ""}.`);
      router.refresh();
    } catch (e) { setMsg(e.message); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button style={btn} onClick={run}>Generate this week's tasks</button>
      {msg && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}

export function AssignSelect({ task, people }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  async function assign(v) {
    setErr("");
    try { await taskAction({ action: "assign", taskId: task.task_id, userId: v === "" ? null : Number(v) }); router.refresh(); }
    catch (e) { setErr(e.message); }
  }
  const locked = ["COMPLETE", "CANCELLED", "READY_FOR_REVIEW"].includes(task.status);
  return (
    <span>
      <select defaultValue={task.assigned_to ?? ""} disabled={locked} onChange={(e) => assign(e.target.value)}
        style={{ height: 30, padding: "0 8px", border: "1px solid var(--line-strong)", borderRadius: 7, background: "var(--surface)", color: "var(--ink)", fontSize: 12.5 }}>
        <option value="">unassigned</option>
        {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
      </select>
      {err && <span style={{ fontSize: 11.5, color: "#a32d2d", marginLeft: 6 }}>{err}</span>}
    </span>
  );
}
