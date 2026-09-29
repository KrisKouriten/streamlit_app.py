"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ghost = { fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };

/*
 * The automatic follow-ups, stated once on each Finance desk, with a preview
 * of what the next run would do and a way to run it now. The daily run is the
 * workflow cron (weekday mornings); both buttons call the same endpoint.
 */
export default function AutoFollowups({ scope = "PO" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function go(dryRun) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/workflow/cron", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || "Could not run the follow-ups");
      const refs = (a) => a.map((x) => x.ref).join(", ");
      const po = r.posCancelled || [], pr = r.procurementCancelled || [], ch = r.invoicesChased || [];
      const verb = dryRun ? "Would" : "";
      const parts = [
        po.length ? `${verb ? "Would cancel" : "Cancelled"} ${po.length} P.O${po.length === 1 ? "" : "s"}: ${refs(po)}.` : "",
        pr.length ? `${verb ? "Would cancel" : "Cancelled"} ${pr.length} procurement request${pr.length === 1 ? "" : "s"}: ${refs(pr)}.` : "",
        ch.length ? `${verb ? "Would chase" : "Chased"} ${ch.length} invoice${ch.length === 1 ? "" : "s"}: ${refs(ch)}.` : "",
        r.errors?.length ? `${r.errors.length} failed — ${r.errors[0]}` : "",
      ].filter(Boolean);
      setMsg(parts.join(" ") || (dryRun ? "Nothing is due." : "Nothing was due."));
      if (!dryRun) router.refresh();
    } catch (x) { setMsg(x.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.55, marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 420px" }}>
        <strong style={{ color: "var(--muted)" }}>Automatic follow-ups</strong>, every working day:{" "}
        {scope === "PO"
          ? "a challenged P.O not resubmitted within 5 working days is cancelled, and an invoice you have chased once is chased again every 5 working days until it is recorded."
          : "a challenged request not amended within 5 working days is cancelled."}
        {" "}Cancelled items stay under <em>Cancelled</em> and no longer count against any budget.
        {msg && <div style={{ color: "var(--muted)", marginTop: 4 }}>{msg}</div>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={ghost} disabled={busy} onClick={() => go(true)}>{busy ? "Checking…" : "Preview next run"}</button>
        <button style={ghost} disabled={busy} onClick={() => { if (window.confirm("Run the automatic follow-ups now? Lapsed challenges are cancelled and due reminders are emailed.")) go(false); }}>Run now</button>
      </div>
    </div>
  );
}
