import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../lib/auth";
import { getReviewQueue } from "../../../lib/agents";
import { SubNav, money } from "../../finance-os/ui";
import { LifecycleChip, OutputReviewPanel } from "../agent-ui";
import { AI_NAV } from "../nav";

export const dynamic = "force-dynamic";
const SEV = { CRITICAL: "#a32d2d", HIGH: "#a32d2d", MEDIUM: "var(--amber)", LOW: "var(--muted)" };

export default async function OutputReviewQueue() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canReview = hasRole(session, "ADMIN", "FINANCE");
  const queue = await getReviewQueue();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>AI Control Tower</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Agent output review queue</div>
      </header>
      <SubNav items={AI_NAV} active="/ai/review" />

      {queue.length === 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", fontSize: 14, color: "var(--muted)" }}>
          Nothing awaiting review. Run an agent from the <Link href="/ai">Agent Centre</Link> to generate outputs.
        </div>
      )}
      {queue.map((o) => (
        <div key={o.output_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: SEV[o.severity] || "var(--muted)" }}>{o.agent_name} · {o.output_type}{o.severity ? ` · ${o.severity}` : ""}</span>
            <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{o.headline}</span>
            {o.financial_impact != null && (
              <span style={{ fontSize: 13, fontWeight: 600, color: Number(o.financial_impact) < 0 ? "#a32d2d" : "var(--green)" }}>{money(o.financial_impact, { compact: true })}</span>
            )}
            <LifecycleChip lifecycle={o.lifecycle} />
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginBottom: 6 }}>{o.body}</div>
          {o.recommended_action && (
            <div style={{ fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
              <span style={{ color: "var(--faint)" }}>Recommended: </span>{o.recommended_action}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--faint)" }}>
            {o.store_name ? `${o.store_name} · ` : ""}run <Link href={`/ai/runs/${o.run_id}`}>#{o.run_id}</Link> · {o.validation_result}{o.is_material ? " · MATERIAL" : ""}
          </div>
          <OutputReviewPanel output={o} canReview={canReview} />
        </div>
      ))}
    </div>
  );
}
