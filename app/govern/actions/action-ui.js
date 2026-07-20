"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export const ACTION_STATUS_STYLE = {
  OPEN: ["var(--accent)", "var(--accent-bg)"],
  IN_PROGRESS: ["var(--accent)", "var(--accent-bg)"],
  COMPLETE: ["var(--amber)", "var(--amber-bg)"],
  CLOSED: ["var(--green)", "var(--green-bg)"],
  CANCELLED: ["var(--faint)", "var(--line)"],
  OVERDUE: ["#a32d2d", "#f7e6e3"],
};
export function ActionStatusChip({ status }) {
  const [fg, bg] = ACTION_STATUS_STYLE[status] || ["var(--muted)", "var(--line)"];
  return <span role="status" style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{status.replace(/_/g, " ")}</span>;
}

export const SOURCE_LABEL = {
  DASHBOARD: "Dashboard", MONTH_END: "Month-end", WEEKLY_TASK: "Weekly task", AI_AGENT: "AI agent",
  MANAGEMENT_ACCOUNTS: "Mgmt accounts", BOARD: "Board", CONTROL: "Control", AUDIT: "Audit", MANUAL: "Manual",
};

async function api(body) {
  const res = await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Action failed");
  return data;
}

const input = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 13.5 };
const btn = (bg = "var(--accent)") => ({ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: bg, color: "#fff", fontSize: 13, cursor: "pointer" });
const ghost = { ...btn(), background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line-strong)" };

const SOURCES = ["MANUAL", "DASHBOARD", "MONTH_END", "WEEKLY_TASK", "MANAGEMENT_ACCOUNTS", "BOARD", "CONTROL", "AUDIT"];

export function CreateActionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", ownerName: "", sponsor: "", dueDate: "", sourceType: "MANUAL", rootCause: "", expectedValue: "", description: "" });
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault(); setErr("");
    try { await api({ action: "create", ...f }); setOpen(false); setF({ title: "", ownerName: "", sponsor: "", dueDate: "", sourceType: "MANUAL", rootCause: "", expectedValue: "", description: "" }); router.refresh(); }
    catch (e) { setErr(e.message); }
  }
  if (!open) return <button style={btn()} onClick={() => setOpen(true)}>Raise an action</button>;
  return (
    <form onSubmit={submit} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 16, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
      <input style={input} placeholder="Action title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
      <input style={input} placeholder="Owner" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} required />
      <input style={input} placeholder="Sponsor (optional)" value={f.sponsor} onChange={(e) => setF({ ...f, sponsor: e.target.value })} />
      <input style={input} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      <select style={input} value={f.sourceType} onChange={(e) => setF({ ...f, sourceType: e.target.value })}>
        {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
      </select>
      <input style={input} type="number" placeholder="Expected value £ (optional)" value={f.expectedValue} onChange={(e) => setF({ ...f, expectedValue: e.target.value })} />
      <input style={{ ...input, gridColumn: "1/-1" }} placeholder="Root cause (optional)" value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} />
      <textarea style={{ ...input, height: 60, gridColumn: "1/-1", padding: "8px 10px" }} placeholder="Description (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      {err && <div style={{ gridColumn: "1/-1", fontSize: 12.5, color: "#a32d2d" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" style={btn()}>Create</button>
        <button type="button" style={ghost} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function ActionControls({ action, isManager, canClose, isOwner }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  async function act(body) {
    setErr("");
    try { await api({ actionId: action.action_id, ...body }); setNote(""); router.refresh(); }
    catch (e) { setErr(e.message); }
  }
  const canWork = isManager || isOwner;
  const s = action.status;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {canWork && s === "OPEN" && <button style={ghost} onClick={() => act({ action: "start" })}>Start</button>}
        {canWork && ["OPEN", "IN_PROGRESS", "OVERDUE"].includes(s) && <button style={ghost} onClick={() => act({ action: "complete", note })}>Mark complete</button>}
        {canWork && s === "COMPLETE" && <button style={ghost} onClick={() => act({ action: "reopen", note })}>Reopen</button>}
        {canClose && s === "COMPLETE" && <button style={btn("var(--green)")} onClick={() => act({ action: "close", note })}>Approve closure</button>}
        {isManager && !["CLOSED", "CANCELLED"].includes(s) && <button style={ghost} onClick={() => act({ action: "cancel", note })}>Cancel</button>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...input, flex: 1, minWidth: 180 }} placeholder="Progress note…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button style={ghost} onClick={() => note.trim() ? act({ action: "update", body: note }) : setErr("Add a note first")}>Add note</button>
      </div>
      {s === "COMPLETE" && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Completion is the owner saying the work is done. Closure is a separate approval by ADMIN/FINANCE/EXEC.
        </div>
      )}
      {err && <div style={{ fontSize: 12.5, color: "#a32d2d" }}>{err}</div>}
    </div>
  );
}

export function RealisedValueForm({ actionId, current }) {
  const router = useRouter();
  const [v, setV] = useState(current ?? "");
  const [err, setErr] = useState("");
  async function save() {
    setErr("");
    try { await api({ action: "record-realised", actionId, value: Number(v) }); router.refresh(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input style={{ ...input, width: 140 }} type="number" placeholder="Realised value £" value={v} onChange={(e) => setV(e.target.value)} />
      <button style={ghost} onClick={save}>Record</button>
      {err && <span style={{ fontSize: 11.5, color: "#a32d2d" }}>{err}</span>}
    </span>
  );
}

export function ValidateBenefitControl({ opportunityId, suggested }) {
  const router = useRouter();
  const [v, setV] = useState(suggested ?? "");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  async function decide(decision) {
    setErr("");
    try { await api({ action: "validate-benefit", opportunityId, value: Number(v || 0), decision, comment }); router.refresh(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input style={{ ...input, width: 130, height: 30 }} type="number" placeholder="Validated £" value={v} onChange={(e) => setV(e.target.value)} />
      <input style={{ ...input, width: 160, height: 30 }} placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button style={{ ...btn("var(--green)"), height: 30 }} onClick={() => decide("VALIDATED")}>Validate</button>
      <button style={{ ...btn("#a32d2d"), height: 30 }} onClick={() => decide("DISPUTED")}>Dispute</button>
      {err && <span style={{ fontSize: 11.5, color: "#a32d2d" }}>{err}</span>}
    </span>
  );
}
