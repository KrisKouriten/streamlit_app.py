"use client";

import { useState } from "react";

/*
 * Purchase-order self-approval limit (ADMIN only — enforced again server-side).
 * A single org-wide £ threshold: a P.O whose net value is at or below it is
 * signed off automatically by its creator, so small P.Os don't queue for a
 * department-head. 0 turns the feature off (every P.O needs a sign-off).
 */

const input = { height: 36, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 14, width: 160 };
const btn = { height: 36, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 13.5, cursor: "pointer" };

export default function SelfApproveLimit({ initialLimit = 0 }) {
  const [limit, setLimit] = useState(String(initialLimit || 0));
  const [saved, setSaved] = useState(Number(initialLimit) || 0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const dirty = Number(limit) !== saved;

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-po-self-approve-limit", limit: Number(limit) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the limit");
      setSaved(data.limit); setLimit(String(data.limit));
      setNotice(data.limit > 0 ? `Self-approval limit set to £${Number(data.limit).toLocaleString("en-GB")}.` : "Self-approval turned off — every P.O now needs a department-head sign-off.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", maxWidth: 640 }}>
      {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
      {notice && <div style={{ fontSize: 13, color: "var(--green)", marginBottom: 10 }}>{notice}</div>}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" }}>Self-approval limit (£)</span>
          <input style={input} type="number" min="0" step="1" value={limit}
            onChange={(e) => setLimit(e.target.value)} placeholder="0" />
        </label>
        <button style={{ ...btn, opacity: dirty && !busy ? 1 : 0.5, cursor: dirty && !busy ? "pointer" : "default" }} disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save limit"}
        </button>
        <span style={{ fontSize: 12, color: "var(--faint)", alignSelf: "center" }}>
          {saved > 0 ? `P.Os of £${saved.toLocaleString("en-GB")} or less are self-signed off by their creator.` : "Currently off — every P.O needs a department-head sign-off."}
        </span>
      </div>
    </div>
  );
}
