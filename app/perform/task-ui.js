"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export const STATUS_STYLE = {
  NOT_RELEASED: ["var(--faint)", "var(--line)", "Not released"],
  AVAILABLE: ["var(--accent)", "var(--accent-bg)", "Available"],
  ASSIGNED: ["var(--muted)", "var(--line)", "Assigned"],
  IN_PROGRESS: ["var(--accent)", "var(--accent-bg)", "In progress"],
  WAITING_FOR_INFORMATION: ["var(--amber)", "var(--amber-bg)", "Waiting for info"],
  READY_FOR_REVIEW: ["var(--amber)", "var(--amber-bg)", "Ready for review"],
  RETURNED: ["var(--red)", "var(--red-bg)", "Returned"],
  COMPLETE: ["var(--green)", "var(--green-bg)", "Complete"],
  BLOCKED: ["var(--red)", "var(--red-bg)", "Blocked"],
  OVERDUE: ["var(--red)", "var(--red-bg)", "Overdue"],
  CANCELLED: ["var(--faint)", "var(--line)", "Cancelled"],
};

export function StatusChip({ status }) {
  const [fg, bg, label] = STATUS_STYLE[status] || ["var(--muted)", "var(--line)", status];
  return (
    <span role="status" style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
      {label.toUpperCase()}
    </span>
  );
}

export const PRIORITY_STYLE = {
  CRITICAL: ["var(--red)", "‼"], HIGH: ["var(--amber)", "!"], MEDIUM: ["var(--muted)", ""], LOW: ["var(--faint)", ""],
};
export function PriorityMark({ priority }) {
  const [fg, mark] = PRIORITY_STYLE[priority] || PRIORITY_STYLE.MEDIUM;
  return <span title={priority} style={{ fontSize: 11.5, fontWeight: 700, color: fg }}>{priority}{mark}</span>;
}

export async function taskAction(body) {
  const res = await fetch("/api/workflow/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Action failed");
  return data;
}

// Buttons appropriate to a task's status for the current viewer.
export function TaskActionButtons({ task, meId, isManager, compact = false }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = task.assigned_to === meId;

  async function act(action, extra = {}) {
    setErr(""); setBusy(true);
    try { await taskAction({ action, taskId: task.task_id, ...extra }); router.refresh(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const btn = (label, action, extra) => (
    <button key={label} disabled={busy} onClick={() => act(action, extra)} style={{
      fontSize: compact ? 11.5 : 12.5, padding: compact ? "3px 9px" : "5px 12px", borderRadius: 7,
      border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)", cursor: "pointer",
    }}>{label}</button>
  );

  const buttons = [];
  const s = task.status;
  if (s === "AVAILABLE" && !task.assigned_to) buttons.push(btn("Take this task", "assign", { userId: meId }));
  if (mine || isManager) {
    if (["ASSIGNED", "RETURNED", "OVERDUE", "AVAILABLE"].includes(s) && task.assigned_to) buttons.push(btn("Start", "start"));
    if (s === "IN_PROGRESS") {
      buttons.push(btn(task.requires_review ? "Submit for review" : "Mark complete", task.requires_review ? "submit" : "complete"));
      buttons.push(btn("Waiting for info", "wait"));
      buttons.push(btn("Blocked", "block"));
    }
    if (["WAITING_FOR_INFORMATION", "BLOCKED"].includes(s)) buttons.push(btn("Resume", "resume"));
    if (["RETURNED", "OVERDUE"].includes(s) && task.assigned_to) buttons.push(btn(task.requires_review ? "Submit for review" : "Mark complete", task.requires_review ? "submit" : "complete"));
  }
  if (isManager && !["COMPLETE", "CANCELLED"].includes(s)) buttons.push(btn("Cancel", "cancel"));

  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {buttons}
      {err && <span style={{ fontSize: 11.5, color: "var(--red)" }}>{err}</span>}
    </span>
  );
}
