"use client";

import { useMemo, useState } from "react";
import { MEASUREMENT_PERIODS, CANCELLED_PO_POLICIES } from "../../../lib/po-rules";

/*
 * Department PO Approval Settings (ADMIN only — enforced again server-side).
 * Per-department self-approval policy: a count limit, a measurement period, an
 * individual-P.O value cap and a cumulative value cap. Once the first of those is
 * reached, the next P.O routes to the line manager (or department) for sign-off.
 * Departments with no policy fall back to the org-wide self-approval limit above.
 */

const lbl = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const input = { height: 36, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 14, width: "100%" };
const btn = { height: 36, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 13.5, cursor: "pointer" };
const field = (span = 1) => ({ display: "flex", flexDirection: "column", gap: 5, gridColumn: `span ${span}` });

const EMPTY = {
  count_limit: "", measurement_period: "FINANCIAL_PERIOD", custom_period_days: "",
  max_individual_value: "", max_cumulative_value: "", line_manager_name: "", line_manager_email: "",
  secondary_name: "", secondary_email: "", cancelled_po_policy: "RETAIN_IN_COUNT",
  period_reset_rule: "", exception_policy: "", notes: "", effective_from: "", effective_to: "", active: true,
};

function toForm(p) {
  if (!p) return { ...EMPTY };
  const s = (v) => (v == null ? "" : String(v));
  return {
    count_limit: s(p.count_limit), measurement_period: p.measurement_period || "FINANCIAL_PERIOD",
    custom_period_days: s(p.custom_period_days), max_individual_value: s(p.max_individual_value),
    max_cumulative_value: s(p.max_cumulative_value), line_manager_name: s(p.line_manager_name),
    line_manager_email: s(p.line_manager_email), secondary_name: s(p.secondary_name),
    secondary_email: s(p.secondary_email), cancelled_po_policy: p.cancelled_po_policy || "RETAIN_IN_COUNT",
    period_reset_rule: s(p.period_reset_rule), exception_policy: s(p.exception_policy), notes: s(p.notes),
    effective_from: p.effective_from ? String(p.effective_from).slice(0, 10) : "",
    effective_to: p.effective_to ? String(p.effective_to).slice(0, 10) : "", active: p.active !== false,
  };
}

export default function PoPolicySettings({ departments = [], initialPolicies = [] }) {
  const [policies, setPolicies] = useState(initialPolicies);
  const byDept = useMemo(() => Object.fromEntries(policies.map((p) => [p.department, p])), [policies]);
  const [dept, setDept] = useState(departments[0] || "");
  const [form, setForm] = useState(() => toForm(byDept[departments[0]]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function pickDept(name) {
    setDept(name); setForm(toForm(byDept[name])); setError(""); setNotice("");
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-po-policy", policy: { department: dept, ...form } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the policy");
      const saved = { department: dept, ...form, policy_id: data.policyId };
      setPolicies((prev) => [...prev.filter((p) => p.department !== dept), saved].sort((a, b) => a.department.localeCompare(b.department)));
      setNotice(`Saved the self-approval policy for ${dept}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!departments.length) {
    return <div style={{ fontSize: 13, color: "var(--muted)" }}>No departments are configured yet.</div>;
  }
  const isCustom = form.measurement_period === "CUSTOM_PERIOD";

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", maxWidth: 860 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {departments.map((name) => {
          const on = name === dept;
          const has = !!byDept[name];
          return (
            <button key={name} onClick={() => pickDept(name)} style={{
              height: 30, padding: "0 12px", borderRadius: 100, cursor: "pointer", fontSize: 12.5,
              border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
              background: on ? "var(--accent)" : "var(--bg)", color: on ? "#fff" : "var(--ink)",
            }}>
              {name}{has ? " ●" : ""}
            </button>
          );
        })}
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
      {notice && <div style={{ fontSize: 13, color: "var(--green)", marginBottom: 10 }}>{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <label style={field()}>
          <span style={lbl}>Self-approved P.O count limit</span>
          <input style={input} type="number" min="0" step="1" value={form.count_limit} onChange={set("count_limit")} placeholder="No count cap" />
        </label>
        <label style={field()}>
          <span style={lbl}>Measurement period</span>
          <select style={input} value={form.measurement_period} onChange={set("measurement_period")}>
            {MEASUREMENT_PERIODS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
        </label>
        {isCustom && (
          <label style={field()}>
            <span style={lbl}>Custom period (days)</span>
            <input style={input} type="number" min="1" step="1" value={form.custom_period_days} onChange={set("custom_period_days")} placeholder="e.g. 28" />
          </label>
        )}
        <label style={field()}>
          <span style={lbl}>Max individual value (£)</span>
          <input style={input} type="number" min="0" step="1" value={form.max_individual_value} onChange={set("max_individual_value")} placeholder="No cap" />
        </label>
        <label style={field()}>
          <span style={lbl}>Max cumulative value (£)</span>
          <input style={input} type="number" min="0" step="1" value={form.max_cumulative_value} onChange={set("max_cumulative_value")} placeholder="No cap" />
        </label>
        <label style={field()}>
          <span style={lbl}>Cancelled-P.O counting</span>
          <select style={input} value={form.cancelled_po_policy} onChange={set("cancelled_po_policy")}>
            {CANCELLED_PO_POLICIES.map((c) => <option key={c.code} value={c.code}>{c.code === "RETAIN_IN_COUNT" ? "Keep in count" : "Remove from count"}</option>)}
          </select>
        </label>
        <label style={field()}>
          <span style={lbl}>Line manager (name)</span>
          <input style={input} value={form.line_manager_name} onChange={set("line_manager_name")} placeholder="Head of department" />
        </label>
        <label style={field()}>
          <span style={lbl}>Line manager (email)</span>
          <input style={input} type="email" value={form.line_manager_email} onChange={set("line_manager_email")} placeholder="approver@example.com" />
        </label>
        <label style={field()}>
          <span style={lbl}>Secondary approver (name)</span>
          <input style={input} value={form.secondary_name} onChange={set("secondary_name")} placeholder="Optional" />
        </label>
        <label style={field()}>
          <span style={lbl}>Secondary approver (email)</span>
          <input style={input} type="email" value={form.secondary_email} onChange={set("secondary_email")} placeholder="Optional" />
        </label>
        <label style={field()}>
          <span style={lbl}>Effective from</span>
          <input style={input} type="date" value={form.effective_from} onChange={set("effective_from")} />
        </label>
        <label style={field()}>
          <span style={lbl}>Effective to</span>
          <input style={input} type="date" value={form.effective_to} onChange={set("effective_to")} />
        </label>
        <label style={field(2)}>
          <span style={lbl}>Exception policy</span>
          <input style={input} value={form.exception_policy} onChange={set("exception_policy")} placeholder="When may this policy be overridden, and by whom" />
        </label>
        <label style={field(2)}>
          <span style={lbl}>Notes</span>
          <input style={input} value={form.notes} onChange={set("notes")} placeholder="Anything the approvers should know" />
        </label>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13, color: "var(--ink)" }}>
          <input type="checkbox" checked={form.active} onChange={set("active")} /> Policy active
        </label>
        <button style={{ ...btn, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={save}>{busy ? "Saving…" : `Save ${dept} policy`}</button>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>
          Self-approval defers to the first limit reached — count, individual value or cumulative value.
        </span>
      </div>
    </div>
  );
}
