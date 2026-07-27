"use client";
import { useMemo, useState } from "react";

const PERSPECTIVES = [
  ["EXECUTIVE", "Executive"], ["FINANCE_DIRECTOR", "Finance Director"], ["FPA", "FP&A"],
  ["COMMERCIAL_FINANCE", "Commercial Finance"], ["FINANCIAL_CONTROLLER", "Financial Controller"],
  ["CASH_TREASURY", "Cash & Treasury"], ["OPERATIONAL", "Operational"], ["RISK", "Risk"],
  ["OPPORTUNITY", "Opportunity"], ["ACTION", "Action-oriented"],
];
const DETAILS = ["HEADLINE", "CONCISE", "STANDARD", "DETAILED", "TECHNICAL"];
const LEVEL_TONE = { PASSED: "var(--green)", WARNING: "var(--amber)", FAILED: "var(--red)" };
const STATUS_TONE = { READY: "var(--green)", PARTIAL: "var(--amber)", PENDING: "var(--amber)", MISSING: "var(--red)" };

function money(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v), neg = n < 0;
  const s = `£${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return neg ? `(${s})` : s;
}
function kpiVal(k) {
  if (k.unit === "%") return `${k.value}%`;
  if (k.unit === "count") return Number(k.value).toLocaleString("en-GB");
  return money(k.value);
}

const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "7px 13px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", textDecoration: "none" };
const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 };
const mono = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };

export default function Builder({ reportId, initial, canEdit, canApprove = false }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [perspective, setPerspective] = useState("EXECUTIVE");
  const [detail, setDetail] = useState("STANDARD");

  const included = data.sections || [];
  const all = (data.allSections || []).slice().sort((a, b) => a.position - b.position);
  const [selectedId, setSelectedId] = useState(String(included[0]?.section_inst_id || all[0]?.section_inst_id || ""));

  const status = data.report.status;
  const editable = canEdit && ["DRAFT", "DATA_PENDING", "COMMENTARY_PENDING", "RETURNED"].includes(status);

  const selected = useMemo(() => {
    const res = included.find((s) => String(s.section_inst_id) === selectedId);
    const base = all.find((s) => String(s.section_inst_id) === selectedId);
    return { resolved: res || null, base: base || null };
  }, [selectedId, data]);

  const selComponents = (data.components || []).filter((c) => String(c.section_inst_id) === selectedId);

  async function refresh() {
    const res = await fetch(`/api/reports-centre/${reportId}`);
    const j = await res.json();
    if (res.ok) setData((d) => ({ ...d, ...j }));
  }
  async function op(body, note) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch(`/api/reports-centre/${reportId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok || j.error || j.ok === false) throw new Error(j.error || "Action failed");
      if (note) setMsg(note);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function move(id, dir) {
    const ids = all.map((s) => String(s.section_inst_id));
    const i = ids.indexOf(String(id));
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    op({ op: "section-reorder", orderedIds: ids });
  }

  const v = data.validation || { checks: [], summary: {}, overall: "—", canIssue: false };

  return (
    <div>
      {/* Report action bar */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <span style={mono}>Status</span>
        <strong style={{ fontSize: 13 }}>{String(status).replace(/_/g, " ")}</strong>
        <span style={{ ...mono, color: LEVEL_TONE[v.overall] || "var(--faint)" }}>Validation {v.overall}</span>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>{v.summary.passed || 0} pass · {v.summary.warning || 0} warn · {v.summary.failed || 0} fail</span>
        <div style={{ flex: 1 }} />
        <a style={ghost} href={`/api/reports-centre/${reportId}/export?format=pptx`}>Export PowerPoint</a>
        <a style={ghost} href={`/api/reports-centre/${reportId}/export?format=xlsx`}>Excel appendix</a>
        <a style={ghost} href={`/finance-os/home/reports/${reportId}/print`} target="_blank" rel="noreferrer">Print / PDF</a>
      </div>

      {canEdit && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {["DRAFT", "RETURNED", "DATA_PENDING", "COMMENTARY_PENDING"].includes(status) && <button style={btn("var(--accent)")} disabled={busy} onClick={() => op({ op: "transition", action: "submit_for_review" }, "Submitted for review")}>Submit for review</button>}
          {status === "REVIEW_READY" && <button style={btn("var(--accent)")} disabled={busy} onClick={() => op({ op: "transition", action: "start_review" }, "Review started")}>Start review</button>}
          {status === "IN_REVIEW" && <button style={btn("var(--accent)")} disabled={busy} onClick={() => op({ op: "transition", action: "ready_for_approval" }, "Marked ready for approval")}>Ready for approval</button>}
          {status === "IN_REVIEW" && <button style={btn("var(--red)")} disabled={busy} onClick={() => op({ op: "transition", action: "return" }, "Returned for amendment")}>Return</button>}
          {status === "APPROVAL_READY" && canApprove && <button style={btn("var(--green)")} disabled={busy || !v.canIssue} onClick={() => op({ op: "transition", action: "approve" }, "Approved & locked")}>Approve & lock</button>}
          {status === "APPROVAL_READY" && !canApprove && <span style={{ fontSize: 12, color: "var(--faint)", alignSelf: "center" }}>Awaiting admin (Finance Director) approval</span>}
          {status === "APPROVED" && canApprove && <button style={btn("var(--green)")} disabled={busy} onClick={() => op({ op: "transition", action: "issue" }, "Issued")}>Issue</button>}
          <button style={ghost} disabled={busy} onClick={() => op({ op: "snapshot", label: null }, "Draft snapshot taken")}>Snapshot draft</button>
        </div>
      )}

      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* Three panels */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(320px,2.2fr) minmax(260px,1.2fr)", gap: 14, alignItems: "start" }}>
        {/* LEFT — structure */}
        <div style={card}>
          <div style={{ ...mono, marginBottom: 10 }}>Structure</div>
          {all.map((s) => {
            const res = included.find((x) => x.section_inst_id === s.section_inst_id);
            const dstatus = res?.data_status || s.data_status;
            const on = String(s.section_inst_id) === selectedId;
            return (
              <div key={s.section_inst_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: 7, background: on ? "var(--raise)" : "transparent" }}>
                <input type="checkbox" checked={!!s.included} disabled={!editable} title={s.included ? "Included" : "Excluded"}
                  onChange={(e) => op({ op: "section-toggle", sectionInstId: s.section_inst_id, included: e.target.checked })} />
                <button onClick={() => setSelectedId(String(s.section_inst_id))} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: s.included ? "var(--ink)" : "var(--faint)", padding: 0 }}>
                  {s.title}
                </button>
                {s.included && <span title={dstatus} style={{ width: 7, height: 7, borderRadius: 4, background: STATUS_TONE[dstatus] || "var(--faint)" }} />}
                {editable && <span style={{ display: "flex", flexDirection: "column" }}>
                  <button onClick={() => move(s.section_inst_id, -1)} style={{ ...ghost, padding: "0 4px", border: "none" }}>▲</button>
                  <button onClick={() => move(s.section_inst_id, 1)} style={{ ...ghost, padding: "0 4px", border: "none" }}>▼</button>
                </span>}
              </div>
            );
          })}
        </div>

        {/* CENTRE — page preview */}
        <div style={card}>
          {!selected.base ? <div style={{ color: "var(--faint)", fontSize: 13 }}>Select a section.</div> : (
            <>
              <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 4 }}>{selected.base.title}</div>
              {selected.base.purpose && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>{selected.base.purpose}</div>}
              {!selected.base.included && <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 12 }}>This section is excluded from the report.</div>}

              {selected.resolved?.envelope && !selected.resolved.envelope.ready && (
                <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 12 }}>{selected.resolved.envelope.reason || "Awaiting data."}</div>
              )}

              {/* KPIs */}
              {!!selected.resolved?.envelope?.kpis?.length && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, marginBottom: 14 }}>
                  {selected.resolved.envelope.kpis.map((k, i) => (
                    <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px" }}>
                      <div className="fos-num" style={{ fontSize: 17, fontWeight: 650 }}>{kpiVal(k)}</div>
                      <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>{k.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Table */}
              {selected.resolved?.envelope?.table && (
                <div style={{ overflowX: "auto", marginBottom: 14 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead><tr>{selected.resolved.envelope.table.columns.map((c) => <th key={c.key} style={{ textAlign: c.align || "left", padding: "7px 10px", ...mono, borderBottom: "1px solid var(--line)" }}>{c.label}</th>)}</tr></thead>
                    <tbody>{selected.resolved.envelope.table.rows.map((r, ri) => <tr key={ri}>{selected.resolved.envelope.table.columns.map((c) => <td key={c.key} style={{ textAlign: c.align || "left", padding: "6.5px 10px", borderBottom: "1px solid var(--hairline)" }}>{c.money ? money(r[c.key]) : String(r[c.key] ?? "—")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}

              {/* Commentary components */}
              {selComponents.filter((c) => c.component_type === "commentary").map((c) => (
                <Commentary key={c.component_id} c={c} editable={editable} canEdit={canEdit} busy={busy} op={op} />
              ))}
            </>
          )}
        </div>

        {/* RIGHT — settings + AI */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {selected.resolved?.envelope && (
            <div style={card}>
              <div style={{ ...mono, marginBottom: 8 }}>Page settings</div>
              <Row k="Source" v={selected.resolved.envelope.label || selected.base?.source_key || "—"} />
              <Row k="Data status" v={selected.resolved.data_status} />
              <Row k="Data through" v={selected.resolved.envelope.metadata?.dataThrough ? String(selected.resolved.envelope.metadata.dataThrough).slice(0, 10) : "—"} />
              <Row k="Provenance" v={selected.resolved.envelope.metadata?.provenance} />
              {selected.resolved.envelope.metadata?.sourceRoute && <Row k="Source link" v={<a href={selected.resolved.envelope.metadata.sourceRoute} style={{ color: "var(--accent)" }}>{selected.resolved.envelope.metadata.sourceRoute}</a>} />}
              {!!selected.resolved.envelope.warnings?.length && <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 8 }}>{selected.resolved.envelope.warnings.join(" ")}</div>}
            </div>
          )}

          {canEdit && selected.base?.included && (
            <div style={card}>
              <div style={{ ...mono, marginBottom: 8 }}>AI commentary</div>
              <select value={perspective} onChange={(e) => setPerspective(e.target.value)} style={{ width: "100%", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", marginBottom: 8 }}>
                {PERSPECTIVES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select value={detail} onChange={(e) => setDetail(e.target.value)} style={{ width: "100%", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", marginBottom: 8 }}>
                {DETAILS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button style={{ ...btn("var(--accent)"), width: "100%" }} disabled={busy}
                onClick={() => op({ op: "commentary-generate", sectionInstId: selected.base.section_inst_id, perspective, detailLevel: detail }, "AI draft generated")}>
                {busy ? "Generating…" : "Generate AI draft"}
              </button>
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>Governed draft over the section's figures — for human sign-off.</div>
            </div>
          )}

          {/* Validation checklist */}
          <div style={card}>
            <div style={{ ...mono, marginBottom: 8 }}>Validation</div>
            {v.checks.map((c) => (
              <div key={c.key} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: LEVEL_TONE[c.level], flex: "none", marginTop: 4 }} />
                <div><div style={{ fontSize: 12 }}>{c.label}</div>{c.detail && <div style={{ fontSize: 11, color: "var(--faint)" }}>{c.detail}</div>}</div>
              </div>
            ))}
          </div>

          {/* Versions */}
          {!!data.versions?.length && (
            <div style={card}>
              <div style={{ ...mono, marginBottom: 8 }}>Versions</div>
              {data.versions.map((ver) => (
                <div key={ver.version_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <a href={`/api/reports-centre/${reportId}/export?format=pptx&version=${ver.version_id}`} style={{ color: "var(--ink)", textDecoration: "none" }}>{ver.label}</a>
                  <span style={{ color: "var(--faint)" }}>{ver.locked ? "🔒 " : ""}{ver.status.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "3px 0" }}><span style={{ color: "var(--faint)" }}>{k}</span><span style={{ textAlign: "right", color: "var(--ink)" }}>{v}</span></div>;
}

function Commentary({ c, editable, canEdit, busy, op }) {
  const [text, setText] = useState(c.draft_text || "");
  const approved = c.ai_status === "APPROVED";
  const rejected = c.ai_status === "REJECTED";
  const draft = c.ai_status === "DRAFT" || c.ai_status === "REVIEWED";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 10, background: "var(--raise)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ ...mono, color: approved ? "var(--green)" : rejected ? "var(--red)" : "var(--amber)" }}>
          {approved ? "Approved" : rejected ? "Rejected" : "AI Draft — review required"}
        </span>
        {c.ai_perspective && <span style={{ fontSize: 11, color: "var(--faint)" }}>· {c.ai_perspective.replace(/_/g, " ")}</span>}
        {c.ai_confidence && <span style={{ fontSize: 11, color: "var(--faint)" }}>· confidence {c.ai_confidence}</span>}
        {c.ai_data_through && <span style={{ fontSize: 11, color: "var(--faint)" }}>· data through {String(c.ai_data_through).slice(0, 10)}</span>}
      </div>
      {editable && draft ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} style={{ width: "100%", fontSize: 13, lineHeight: 1.5, padding: 10, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", resize: "vertical" }} />
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink)" }}>{approved ? (c.approved_text || c.draft_text) : c.draft_text}</div>
      )}
      {!!(c.ai_sources?.length) && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>Sources: {c.ai_sources.map((s) => s.label).filter(Boolean).join(", ")}</div>}
      {editable && draft && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button style={btn("var(--accent)")} disabled={busy} onClick={() => op({ op: "commentary-edit", componentId: c.component_id, text }, "Commentary saved")}>Save edit</button>
          {canEdit && <button style={btn("var(--green)")} disabled={busy} onClick={() => op({ op: "commentary-review", componentId: c.component_id, decision: "APPROVED", approvedText: text }, "Commentary approved")}>Approve</button>}
          {canEdit && <button style={btn("var(--red)")} disabled={busy} onClick={() => op({ op: "commentary-review", componentId: c.component_id, decision: "REJECTED" }, "Commentary rejected")}>Reject</button>}
        </div>
      )}
    </div>
  );
}
