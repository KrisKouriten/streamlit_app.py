"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CLOSE_STAGES } from "../../../lib/close-plan-rules";

/* Client UI for the Close Cockpit: a readiness header, the stages of the close
   with each step's automatic or human status, the outstanding-blockers list,
   and — for managers — sign off / waive / block controls and the lock control. */

const STATUS_META = {
  PASS: { label: "Met", dot: "var(--green)" },
  DONE: { label: "Signed off", dot: "var(--green)" },
  NA: { label: "N/A", dot: "var(--faint)" },
  FAIL: { label: "Blocking", dot: "var(--red)" },
  BLOCKED: { label: "Blocked", dot: "var(--red)" },
  PENDING: { label: "Awaiting sign-off", dot: "var(--amber)" },
};
const STAGE_STATUS = {
  COMPLETE: { label: "Complete", color: "var(--green)" },
  BLOCKED: { label: "Blocking", color: "var(--red)" },
  PENDING: { label: "In progress", color: "var(--amber)" },
  OPEN: { label: "Open", color: "var(--muted)" },
};

async function post(body) {
  const res = await fetch("/api/close", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.PENDING;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: m.dot, flex: "none" }} />
      {m.label}
    </span>
  );
}

function Ring({ score, locked }) {
  const color = locked ? "var(--accent)" : score === 100 ? "var(--green)" : score >= 60 ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ width: 78, height: 78, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center",
      background: `conic-gradient(${color} ${score * 3.6}deg, var(--line-strong) 0)` }}>
      <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center" }}>
        <span style={{ fontSize: 18, fontWeight: 750, color: "var(--ink)" }}>{score}<span style={{ fontSize: 10, color: "var(--muted)" }}>%</span></span>
      </div>
    </div>
  );
}

export default function CloseCockpitUI({ board, canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  if (!board.ready) {
    return (
      <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)" }}>
        No finance actuals are loaded yet — once a period is loaded, its close readiness and the lock control appear here.
      </div>
    );
  }

  const { period, run, plan, periods } = board;
  const locked = plan.locked;
  const status = locked ? "LOCKED" : plan.ready ? "READY" : "OPEN";

  async function act(body, key) {
    setErr(""); setBusy(key);
    try { await post({ period, ...body }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }

  function override(stepCode, stepLabel, statusVal) {
    let note = null;
    if (statusVal === "NA" || statusVal === "BLOCKED") {
      note = window.prompt(statusVal === "NA" ? `Why is "${stepLabel}" not applicable this period?` : `Why is "${stepLabel}" blocked?`);
      if (note === null) return;
    }
    act({ action: "override", stepCode, status: statusVal, note }, `${stepCode}:${statusVal}`);
  }

  function changePeriod(e) { router.push(`/operate/close?period=${e.target.value}`); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div className="fos-card" style={{ padding: "10px 14px", color: "var(--red)", fontSize: 13 }}>{err}</div>}

      {/* Readiness header */}
      <div className="fos-card" style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <Ring score={plan.score} locked={locked} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <select value={period} onChange={changePeriod} className="fos-input"
              style={{ fontSize: 14, fontWeight: 650, padding: "3px 8px" }} aria-label="Close period">
              {(periods.length ? periods : [period]).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", padding: "2px 9px", borderRadius: 20,
              color: locked ? "var(--accent-ink)" : "var(--ink)",
              background: locked ? "var(--accent)" : status === "READY" ? "var(--green-bg)" : "var(--raise)" }}>
              {locked ? "LOCKED" : status === "READY" ? "READY TO LOCK" : "OPEN"}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            {plan.satisfied} of {plan.gateTotal} gates satisfied · {plan.blockers.length} outstanding
            {run?.locked_at && locked ? ` · locked ${new Date(run.locked_at).toLocaleDateString("en-GB")}` : ""}
          </div>
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!locked && (
              <button className="fos-btn" disabled={!plan.ready || busy === "lock"}
                title={plan.ready ? "Lock the period" : "Clear all gates before locking"}
                onClick={() => act({ action: "lock" }, "lock")}>
                {busy === "lock" ? "Locking…" : "Lock period"}
              </button>
            )}
            {locked && (
              <button className="fos-btn-ghost" disabled={busy === "reopen"}
                onClick={() => { const note = window.prompt("Reason for reopening the period:"); if (note !== null) act({ action: "reopen", note }, "reopen"); }}>
                {busy === "reopen" ? "Reopening…" : "Reopen"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Outstanding blockers */}
      {plan.blockers.length > 0 && (
        <div className="fos-card" style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", marginBottom: 8 }}>OUTSTANDING</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {plan.blockers.map((b) => (
              <div key={b.code} style={{ fontSize: 13, color: "var(--ink)" }}>
                <span style={{ color: b.status === "BLOCKED" ? "var(--red)" : "var(--amber)" }}>•</span>{" "}
                <span style={{ fontWeight: 600 }}>{b.label}</span>
                <span style={{ color: "var(--muted)" }}> — {b.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stages */}
      {CLOSE_STAGES.map((st) => {
        const stage = plan.stages.find((s) => s.key === st.key);
        if (!stage) return null;
        const sm = STAGE_STATUS[stage.status] || STAGE_STATUS.OPEN;
        return (
          <div key={st.key} className="fos-card" style={{ padding: "14px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink)" }}>{st.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: sm.color }}>{stage.done}/{stage.total} · {sm.label}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {stage.steps.map((step, i) => (
                <div key={step.code} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
                  padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 550 }}>
                      {step.label}
                      {step.kind === "MANUAL" && <span style={{ fontSize: 10.5, color: "var(--faint)", marginLeft: 7, fontWeight: 600, letterSpacing: ".04em" }}>MANUAL</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {step.detail}
                      {step.overridden && step.by ? ` — ${step.by}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
                    <StatusPill status={step.status} />
                    {canManage && step.kind !== "SYSTEM" && !locked && (
                      <div style={{ display: "flex", gap: 4 }}>
                        {step.status !== "DONE" && (
                          <button className="fos-btn-ghost" style={{ fontSize: 11, padding: "1px 7px" }}
                            disabled={busy === `${step.code}:DONE`} onClick={() => override(step.code, step.label, "DONE")}>Sign off</button>
                        )}
                        {step.status !== "NA" && (
                          <button className="fos-btn-ghost" style={{ fontSize: 11, padding: "1px 7px" }}
                            disabled={busy === `${step.code}:NA`} onClick={() => override(step.code, step.label, "NA")}>Waive</button>
                        )}
                        {step.overridden && (
                          <button className="fos-btn-ghost" style={{ fontSize: 11, padding: "1px 7px" }}
                            disabled={busy === `${step.code}:CLEAR`} onClick={() => act({ action: "override", stepCode: step.code, status: "CLEAR" }, `${step.code}:CLEAR`)}>Clear</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.6 }}>
        Green gates are checked automatically from the data — nobody ticks them. Manual steps and waivers are recorded with who and when.
        Exception detail lives on <a href="/operate/management-close" style={{ color: "var(--accent)" }}>Management accounts close</a>.
      </div>
    </div>
  );
}
