"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* Manual "generate now" for a proactive brief — ADMIN/FINANCE only. Posts to the
   same governed endpoint the cron uses, then refreshes the list. */
export default function GenerateBriefingButton() {
  const router = useRouter();
  const [state, setState] = useState("");
  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/intelligence/briefing/cron", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setState(data.error || "Could not generate"); return; }
      setState("");
      router.refresh();
    } catch { setState("Network error"); }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {state && state !== "running" && <span style={{ fontSize: 12, color: "var(--red)" }}>{state}</span>}
      <button onClick={run} disabled={state === "running"}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "1px solid var(--accent-deep)", borderRadius: 9, padding: "7px 13px", cursor: state === "running" ? "default" : "pointer" }}>
        <span aria-hidden="true">✦</span> {state === "running" ? "Generating…" : "Generate brief now"}
      </button>
    </div>
  );
}
