"use client";

import { useState } from "react";
import { STATUSES, RAGS, projectDateLabel } from "../../../lib/business-projects-rules";
import DateField from "../../finance-os/date-field";
import MoneyInput from "../../money-input";

/* The business project form — one layout for setting a project up (Business
   Projects) and editing it (the project page), so the two can't drift apart.
   Grouped into sections with room between them: what the project is, where it
   stands, its dates and budget, and notes. Posts nothing itself — the caller
   passes onSubmit(payload). */

const RAG_COLOR = { green: "var(--green)", amber: "var(--amber, #b8860b)", red: "var(--red)" };
const RAG_LABEL = { green: "Green — on track", amber: "Amber — at risk", red: "Red — off track" };

const labelSt = { fontSize: 12, fontWeight: 600, color: "var(--muted)" };
const hintSt = { fontSize: 11.5, color: "var(--faint)" };
const inputSt = { height: 38, padding: "0 12px", fontSize: 13.5, border: "1px solid var(--line)", borderRadius: 9, background: "var(--surface)", color: "var(--ink)", width: "100%", boxSizing: "border-box" };
// The date field draws its own box; it takes the size, not the input padding.
const dateBox = { height: 38, width: "100%", borderRadius: 9, boxSizing: "border-box" };
// Each section is a row of equal columns, capped at a comfortable width so
// fields don't stretch across a wide screen; they stack on a narrow one.
const MAX = 980;
const cols = (n) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${n >= 3 ? 200 : 240}px, 1fr))`, columnGap: 20, rowGap: 16, maxWidth: MAX });

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={labelSt}>{label}</span>
      {children}
      {hint && <span style={hintSt}>{hint}</span>}
    </label>
  );
}

function Section({ title, children, first }) {
  return (
    <section style={{ paddingTop: first ? 0 : 20, borderTop: first ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  );
}

export const EMPTY_PROJECT = { name: "", category: "", owner: "", status: "Planned", rag: "green", start_date: "", target_date: "", budget: "", notes: "" };

export default function ProjectForm({ initial = null, title, submitLabel = "Save project", busy = false, error = null, onSubmit, onCancel }) {
  const [f, setF] = useState(() => (initial ? {
    name: initial.name || "", category: initial.category || "", owner: initial.owner || "",
    status: initial.status || "Planned", rag: initial.rag || "green",
    start_date: initial.start_date || "", target_date: initial.target_date || "",
    budget: initial.budget == null ? "" : String(initial.budget), notes: initial.notes || "",
  } : EMPTY_PROJECT));
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));

  // A project set up before the dates existed has a target month only. It is
  // kept until a target finish date is given.
  const legacyYm = initial && !initial.target_date && initial.target_ym ? initial.target_ym : null;
  const datesWrong = f.start_date && f.target_date && f.target_date < f.start_date;

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim() || datesWrong) return;
    onSubmit({
      ...f,
      name: f.name.trim(),
      start_date: f.start_date || null,
      target_date: f.target_date || null,
      budget: f.budget === "" ? null : f.budget,
      ...(legacyYm && !f.target_date ? { target_ym: legacyYm } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="fos-card" style={{ padding: "22px 24px 20px", display: "grid", gap: 20 }}>
      {title && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 650 }}>{title}</div>
          <div style={{ ...hintSt, marginTop: 3 }}>Fields marked * are required.</div>
        </div>
      )}

      <Section title="Project" first={!title}>
        {/* The name sits on its own row: spanning a grid row made the grid
            keep a column per screen width and squeezed the fields beside it. */}
        <div style={{ maxWidth: MAX, marginBottom: 16, display: "grid" }}>
          <Field label="Project name *">
            <input style={inputSt} value={f.name} onChange={set("name")} required placeholder="e.g. Warehouse automation phase 2" autoFocus={!initial} />
          </Field>
        </div>
        <div style={cols(2)}>
          <Field label="Category"><input style={inputSt} value={f.category} onChange={set("category")} placeholder="e.g. Property, Marketing" /></Field>
          <Field label="Owner"><input style={inputSt} value={f.owner} onChange={set("owner")} placeholder="Department or person" /></Field>
        </div>
      </Section>

      <Section title="Status">
        <div style={cols(2)}>
          <Field label="Status">
            <select style={inputSt} value={f.status} onChange={set("status")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="RAG">
            <div style={{ position: "relative" }}>
              <span aria-hidden style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: RAG_COLOR[f.rag], fontSize: 12 }}>●</span>
              <select style={{ ...inputSt, paddingLeft: 30 }} value={f.rag} onChange={set("rag")}>{RAGS.map((s) => <option key={s} value={s}>{RAG_LABEL[s] || s}</option>)}</select>
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Dates & budget">
        <div style={cols(3)}>
          <Field label="Planned start date">
            <DateField value={f.start_date} onChange={set("start_date")} inputStyle={dateBox} />
          </Field>
          <Field label="Target finish date" hint={legacyYm && !f.target_date ? `Was set as a month only: ${projectDateLabel(null, legacyYm)}` : null}>
            <DateField value={f.target_date} onChange={set("target_date")} inputStyle={dateBox} />
          </Field>
          <Field label="Budget (£)">
            <MoneyInput style={{ ...inputSt, textAlign: "right" }} className="fos-num" value={f.budget} onChange={set("budget")} placeholder="0" />
          </Field>
        </div>
        {datesWrong && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 10 }}>The target finish date is before the planned start date.</div>}
      </Section>

      <Section title="Notes">
        <textarea style={{ ...inputSt, maxWidth: MAX, height: "auto", minHeight: 76, padding: "10px 12px", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
          value={f.notes} onChange={set("notes")} placeholder="What it is for, scope, dependencies…" />
      </Section>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 4 }}>
        <button className="fos-btn" type="submit" disabled={busy || !f.name.trim() || datesWrong}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} disabled={busy}
          style={{ height: 36, padding: "0 16px", fontSize: 13, borderRadius: 9, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Cancel</button>}
        {error && <span style={{ color: "var(--red)", fontSize: 13 }}>{error}</span>}
      </div>
    </form>
  );
}
