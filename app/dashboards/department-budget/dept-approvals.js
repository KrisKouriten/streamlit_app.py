"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/*
 * Budget-holder approvals queue on a department dashboard — the P.Os for this
 * department that are awaiting department-head sign-off. A sign-off approver (or
 * an admin) can Approve/Reject inline; everyone else sees the queue read-only.
 */
const money = (v, c = "GBP") => (v == null || v === "" ? "—" : `${c === "GBP" ? "£" : c + " "}${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 650, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };

export default function DeptApprovals({ pos = [], canApprove = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState({});

  async function act(poId, op) {
    setBusy(poId); setErr((s) => ({ ...s, [poId]: null }));
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed");
      router.refresh();
    } catch (e) { setErr((s) => ({ ...s, [poId]: e.message })); }
    finally { setBusy(null); }
  }

  if (!pos.length) return <div style={{ fontSize: 13, color: "var(--faint)", padding: "6px 2px" }}>Nothing awaiting sign-off.</div>;

  return (
    <div className="fos-card" style={{ padding: "6px 16px", borderColor: canApprove ? "color-mix(in srgb, var(--amber) 35%, var(--line))" : "var(--line)" }}>
      {pos.map((p) => (
        <div key={p.po_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--hairline)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{p.xero_po_number}</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.supplier}</span>
          <span style={{ fontSize: 12, color: "var(--faint)" }}>{p.po_category}{p.marketing_campaign ? ` · ${p.marketing_campaign}` : ""}</span>
          <span className="fos-num" style={{ fontSize: 12.5, fontWeight: 600 }}>{money(p.payment_value, p.currency)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {canApprove ? (
              <>
                <button style={btn("var(--green)")} disabled={busy === p.po_id} onClick={() => act(p.po_id, "approve")}>Approve</button>
                <button style={ghost} disabled={busy === p.po_id} onClick={() => act(p.po_id, "reject")}>Reject</button>
              </>
            ) : (
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Awaiting sign-off</span>
            )}
          </div>
          {err[p.po_id] && <div style={{ width: "100%", color: "var(--red)", fontSize: 11.5 }}>{err[p.po_id]}</div>}
        </div>
      ))}
    </div>
  );
}
