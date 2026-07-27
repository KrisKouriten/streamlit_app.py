import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getHubData } from "../../../lib/hub";
import { PageHeader, StatRow, Stat, Panel, Table, Badge, EntityScopeBanner, money, pct, num, dateLabel } from "../../finance-os/ui";
import PerspectivePanel from "../../perspective-panel";

export const dynamic = "force-dynamic";

/*
 * Master Finance Dashboard — the whole finance function on one read-only screen.
 * A report presentation of the same governed composition (lib/hub.js) that
 * drives the Executive Intelligence Hub: trading + statutory headlines, the
 * forward view, the health of actions / operations / agents, and what needs
 * attention. Every figure is sourced upstream (store feed, Joiin, workflow,
 * agents, actions); missing feeds show "Awaiting …" rather than a fabricated
 * number.
 */

const heroValue = (h) => (h.value === null || h.value === undefined ? "—" : h.unit === "GBP" ? money(h.value, { compact: true }) : h.unit === "PCT" ? pct(h.value) : num(h.value));
const SEV_TONE = { CRITICAL: "red", HIGH: "red", RED: "red", AMBER: "amber", MEDIUM: "amber", WATCH: "amber" };
const sevTone = (s) => SEV_TONE[s] || "muted";

export default async function MasterFinanceDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const d = await getHubData();
  const attention = (d.attention || []).slice(0, 10);

  return (
    <div className="fos-shell">
      <PageHeader crumb="Dashboards · Executive" title="Master Finance Dashboard"
        right={d.tradingAsAt ? `Trading to ${dateLabel(d.tradingAsAt)}` : "Read-only overview"} />

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, margin: "-1rem 0 1rem" }}>
        <PerspectivePanel pageId="executive" pageName="Master Finance Dashboard" />
      </div>

      {d.financeScope && (d.financeScope.kind === "JOIIN" || d.financeScope.count > 0) && (
        <EntityScopeBanner scope={d.financeScope} asAt={d.financeAsAt} />
      )}

      {/* Headline band — trading + statutory, each tagged with its source. */}
      <Panel title="Headlines">
        <StatRow>
          {d.hero.map((h) => (
            <Stat key={h.key} label={h.label} value={heroValue(h)}
              sub={h.sub} tone={h.tone || (h.subTone && h.value !== null ? h.subTone : undefined)} />
          ))}
        </StatRow>
      </Panel>

      {/* Forward view — only when trading + plan are present. */}
      {d.forward && (
        <Panel title="Forward view" note="year to date, extrapolated">
          <StatRow>
            <Stat label="Projected FY revenue" value={money(d.forward.projectedFy, { compact: true })} sub="Run-rate from YTD" />
            <Stat label="vs plan" value={d.forward.pctOfPlan != null ? pct(d.forward.pctOfPlan) : "—"} sub="YTD revenue ÷ FY plan" />
            <Stat label="vs forecast" value={d.forward.vsForecast != null ? pct(d.forward.vsForecast) : "—"}
              sub="YTD vs forecast to date" tone={d.forward.vsForecast != null ? (d.forward.vsForecast >= 0 ? "green" : "red") : undefined} />
          </StatRow>
        </Panel>
      )}

      {/* Function health — actions, operations, agents, KPI RAG. */}
      <Panel title="Function health">
        <StatRow>
          <Stat label="KPIs on watch / off target" value={num((d.ragCounts?.AMBER || 0) + (d.ragCounts?.RED || 0))}
            sub={`${d.ragCounts?.RED || 0} red · ${d.ragCounts?.AMBER || 0} amber`} tone={d.ragCounts?.RED ? "red" : d.ragCounts?.AMBER ? "amber" : "green"} />
          <Stat label="Open actions" value={num(d.health.actions.open)}
            sub={`${d.health.actions.overdue} overdue · ${money(d.health.actions.openValue, { compact: true })} expected`} tone={d.health.actions.overdue ? "amber" : undefined} />
          <Stat label="This week's tasks" value={`${num(d.health.operations.complete)}/${num(d.health.operations.total)}`}
            sub={`${d.health.operations.overdue} overdue · ${d.health.operations.awaitingReview} awaiting review`} tone={d.health.operations.overdue ? "amber" : "green"} />
          <Stat label="Agent reviews pending" value={num(d.health.agents.pendingReviews)}
            sub={`${d.health.agents.pendingMaterial} material · ${d.health.agents.openExceptions} exceptions`} tone={d.health.agents.openExceptions ? "amber" : undefined} />
        </StatRow>
      </Panel>

      {/* What needs attention — the ranked cross-function feed. */}
      <Panel title="Needs attention" note={attention.length ? `${d.attention.length} open` : undefined}>
        <Table
          columns={[
            { label: "", render: (r) => <Badge tone={sevTone(r.severity)}>{r.severity}</Badge> },
            { label: "Item", render: (r) => (
              <span>
                {r.href ? <Link href={r.href} style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 550 }}>{r.headline}</Link> : <span style={{ fontWeight: 550 }}>{r.headline}</span>}
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{r.detail}</div>
              </span>
            ) },
            { label: "Source", align: "right", render: (r) => <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{r.tag}</span> },
          ]}
          rows={attention}
          empty="Nothing needs attention right now — no off-target KPIs, overdue actions, exceptions or overdue tasks."
        />
      </Panel>

      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4, maxWidth: "82ch", lineHeight: 1.6 }}>
        A read-only executive report. Trading headlines come from the store sales feed; statutory headlines and scope from the Joiin consolidation; health and attention from the workflow, agent and action registers. Where a feed isn&#39;t connected, the tile shows &quot;Awaiting …&quot; rather than an assumed figure.
      </div>
    </div>
  );
}
