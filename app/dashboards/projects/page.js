import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getProjectsWithSpend } from "../../../lib/business-projects";
import { summarise, groupByCategory, groupByMonth } from "../../../lib/business-projects-rules";
import { PageHeader, StatRow, Stat, Panel, Table, Badge, Bar, ProvenanceBadge, IllustrativeBanner, money, num } from "../../finance-os/ui";
import PerspectivePanel from "../../perspective-panel";

export const dynamic = "force-dynamic";

/*
 * Projects Dashboard — an outward, read-only report over the Business Projects
 * register (Plan — HO). Budget commitment, delivery timeline and delivery
 * confidence (RAG/status) come straight from the register. Planned costs
 * (finance.business_project_cost) and ACTUAL P.O burn (POs tagged to a project)
 * now roll up per project via getProjectsWithSpend, so this reports commitment,
 * status AND burn — variance = planned − actual.
 */

const RAG_TONE = { red: "red", amber: "amber", green: "green" };
const STATUS_TONE = { Active: "accent", Planned: "muted", "On hold": "amber", Done: "green" };
const monthLabel = (ym) => {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m]} ${y}`;
};

export default async function ProjectsDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { ready, projects } = await getProjectsWithSpend();
  const summary = summarise(projects);
  const byCategory = groupByCategory(projects);
  const byMonth = groupByMonth(projects);
  const maxCat = Math.max(1, ...byCategory.map((c) => c.budget));
  // Portfolio burn: planned costs and actual P.O spend across every project.
  const totalPlanned = projects.reduce((a, p) => a + (Number(p.planned) || 0), 0);
  const totalActual = projects.reduce((a, p) => a + (Number(p.actual) || 0), 0);
  // Honesty: the register ships with illustrative seed rows. If every project
  // is still seed data, say so; once real projects are entered it reads as real.
  const allSeed = ready && projects.length > 0 && projects.every((p) => p.created_by === "seed");

  const box = { fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" };

  return (
    <div className="fos-shell">
      <PageHeader crumb="Dashboards · Change portfolio" title="Projects Dashboard"
        right={ready ? `${summary.total} projects · ${summary.active} active` : "Awaiting register"} />

      {ready && projects.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, margin: "-1rem 0 1rem" }}>
          {allSeed ? <ProvenanceBadge kind="illustrative" /> : <ProvenanceBadge kind="model" />}
          <PerspectivePanel pageId="business-projects" pageName="Projects Dashboard" />
        </div>
      )}

      {!ready ? (
        <div style={box}>
          Run migration <span style={{ fontFamily: "var(--mono)" }}>026</span> to enable the Business Projects register that feeds this dashboard.
        </div>
      ) : projects.length === 0 ? (
        <div style={box}>
          No projects in the register yet. Add them under <strong>Plan — HO → Business Projects</strong>; this dashboard reports on them automatically.
        </div>
      ) : (
        <>
          {allSeed && (
            <IllustrativeBanner>
              These are illustrative seed projects. Replace them under Plan — HO → Business Projects and this dashboard updates automatically.
            </IllustrativeBanner>
          )}

          <StatRow>
            <Stat label="Committed budget" value={money(summary.budget, { compact: true })} sub="Open projects (excludes delivered)" />
            <Stat label="Actual (P.O burn)" value={money(totalActual, { compact: true })} sub={`vs ${money(totalPlanned, { compact: true })} planned`} />
            <Stat label="Projects" value={num(summary.total)} sub={`${summary.active} active · ${summary.byStatus.Planned} planned`} />
            <Stat label="At risk" value={num(summary.atRisk)} sub="Red RAG" tone={summary.atRisk ? "red" : "green"} />
            <Stat label="Watch" value={num(summary.rag.amber)} sub="Amber RAG" tone={summary.rag.amber ? "amber" : "muted"} />
          </StatRow>

          <Panel title="Budget commitment by category" note="open projects">
            <Table
              columns={[
                { label: "Category", render: (r) => r.category },
                { label: "Projects", align: "right", render: (r) => num(r.count) },
                { label: "Committed £", align: "right", render: (r) => money(r.budget, { compact: true }) },
                { label: "", render: (r) => <Bar value={r.budget} max={maxCat} /> },
              ]}
              rows={byCategory}
            />
          </Panel>

          <Panel title="Delivery timeline" note="by target month · open projects">
            <Table
              columns={[
                { label: "Target month", render: (r) => monthLabel(r.ym) },
                { label: "Projects", align: "right", render: (r) => num(r.count) },
                { label: "Committed £", align: "right", render: (r) => money(r.budget, { compact: true }) },
              ]}
              rows={byMonth}
              empty="No target months set on the open projects."
            />
          </Panel>

          <Panel title="Portfolio" note="budget · planned cost · actual P.O burn · every project">
            <Table
              columns={[
                { label: "Project", render: (r) => <a href={`/plan/business-projects/${r.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.name}</a> },
                { label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status] || "muted"}>{r.status}</Badge> },
                { label: "RAG", render: (r) => <Badge tone={RAG_TONE[r.rag] || "muted"}>{r.rag}</Badge> },
                { label: "Target", render: (r) => monthLabel(r.target_ym) },
                { label: "Budget", align: "right", render: (r) => money(r.budget, { compact: true }) },
                { label: "Planned", align: "right", render: (r) => money(r.planned, { compact: true }) },
                { label: "Actual (P.O)", align: "right", render: (r) => money(r.actual, { compact: true }) },
                { label: "Variance", align: "right", tone: (r) => ((Number(r.planned) || 0) - (Number(r.actual) || 0)) < 0 ? "red" : undefined, render: (r) => money((Number(r.planned) || 0) - (Number(r.actual) || 0), { compact: true }) },
              ]}
              rows={projects}
            />
          </Panel>

          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4, maxWidth: "82ch", lineHeight: 1.6 }}>
            Source: Business Projects register (Plan — HO). Committed budget counts open projects only. Planned cost comes from each project&rsquo;s per-department cost lines; actual P.O burn is the total of Purchase Orders tagged to the project on the P.O Requests screen. Variance = planned − actual (a negative variance means burn is running ahead of the plan).
          </div>
        </>
      )}
    </div>
  );
}
