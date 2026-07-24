import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getMasterDataOverview } from "../../../lib/masterdata";
import { summarise } from "../../../lib/masterdata-rules";
import { PageHeader } from "../../finance-os/ui";

export const dynamic = "force-dynamic";

const TONE = { green: "var(--green)", accent: "var(--accent)", faint: "var(--faint)" };

// Master Data hub (Tier 3.4) — one governed view of the dimensions everything
// joins to, with lineage (row count + who last changed each, from the audit
// trail). Managed dimensions link to their admin screen; live dimensions have
// data but no editor yet; awaiting-feed dimensions have no source loaded — shown
// honestly rather than hidden.
export default async function MasterDataHub() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getMasterDataOverview();
  const s = summarise(rows);
  const when = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

  return (
    <div className="fos-shell">
      <PageHeader crumb="Finance Data" title="Master Data" right={`${s.managed} managed · ${s.live} live · ${s.awaiting} awaiting feed`} />

      <div className="fos-card" style={{ padding: "6px 18px" }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
                {r.screen ? <Link href={r.screen} style={{ color: "var(--ink)", textDecoration: "none" }}>{r.label}</Link> : r.label}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                <span style={{ fontFamily: "var(--mono)" }}>{r.table}</span> · {r.count.toLocaleString("en-GB")} row{r.count === 1 ? "" : "s"}
                {r.lastChangedAt ? ` · last changed ${when(r.lastChangedAt)}${r.lastChangedBy ? ` by ${r.lastChangedBy}` : ""}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: TONE[r.status.tone] || "var(--muted)" }}>{r.status.label}</span>
              {r.screen && <Link className="fos-btn-ghost" href={r.screen} style={{ fontSize: 11.5, padding: "2px 9px" }}>Manage</Link>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.6, marginTop: 10 }}>
        <b style={{ color: "var(--green)" }}>Managed</b> — governed here with an in-app editor and full audit trail.{" "}
        <b style={{ color: "var(--accent)" }}>Live</b> — real data, editor pending.{" "}
        <b>Awaiting feed</b> — no source loaded yet; shown so the gap is visible, not hidden.
      </div>
    </div>
  );
}
