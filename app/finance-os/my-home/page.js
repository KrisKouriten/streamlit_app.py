import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getMyHome, greeting } from "../../../lib/my-home";
import { getMyActions } from "../../../lib/personal";
import { HeroBand, Panel, Badge } from "../ui";
import PageIntel from "../../page-intel";
import RecentFavourites from "./recent-favourites";
import MyActionsNotes from "./my-actions";

export const dynamic = "force-dynamic";

const SEV_TONE = { CRITICAL: "red", RED: "red", HIGH: "amber", AMBER: "amber", MEDIUM: "muted", LOW: "muted", INFO: "muted" };
const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "there";

// My Finance Home — "here's your day". Composed from governed feeds (lib/my-home).
export default async function MyFinanceHome() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [data, actions] = await Promise.all([getMyHome(session), getMyActions(session.id)]);
  const hour = new Date().getHours();
  const asAt = data.financeAsAt || data.tradingAsAt;

  const row = { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--hairline)" };
  const linkCard = { textDecoration: "none", color: "inherit" };

  return (
    <div className="fos-shell">
      <header style={{ margin: "0.5rem 0 1.3rem" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>
          Home · My Finance Home
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-.022em" }}>{greeting(hour)}, {firstName(session.name)}.</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>
          Here&rsquo;s today&rsquo;s position and what needs you{asAt ? ` · figures as at ${new Date(asAt).toLocaleDateString("en-GB")}` : ""}.
        </p>
      </header>

      <HeroBand stats={data.counts} />
      <MyActionsNotes initialNotes={actions.notes} initialTodos={actions.todos} />
      <RecentFavourites />
      <PageIntel pageName="My Finance Home" report={null}
        related={[
          ["My Finance Week", "/perform/my-week"],
          ["Executive Hub", "/finance-os/executive"],
          ["Proactive Briefings", "/finance-os/briefings"],
          ["Reporting Centre", "/finance-os/home/reports"],
        ].map(([label, href]) => ({ label, href }))} />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 22, alignItems: "start" }}>
        {/* Left — what needs you */}
        <div>
          <Panel title="Needs you" note="ranked by urgency across the platform">
            {data.attention.length ? (
              <div className="fos-card" style={{ padding: "4px 16px" }}>
                {data.attention.map((a, i) => (
                  <Link key={i} href={a.href || "#"} style={{ ...linkCard, ...row, display: "flex" }}>
                    <span style={{ marginTop: 2 }}><Badge tone={SEV_TONE[a.severity] || "muted"}>{a.severity}</Badge></span>
                    <span style={{ flex: 1 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 550, color: "var(--ink)", display: "block" }}>{a.headline}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{a.detail}</span>
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--faint)", whiteSpace: "nowrap", marginTop: 2 }}>{a.tag}</span>
                  </Link>
                ))}
              </div>
            ) : <div style={{ fontSize: 13, color: "var(--faint)" }}>Nothing flagged — you&rsquo;re clear.</div>}
          </Panel>

          <Panel title="Your approvals" note="work waiting on your sign-off">
            {data.approvals.length ? (
              <div className="fos-card" style={{ padding: "4px 16px" }}>
                {data.approvals.map((a, i) => (
                  <Link key={i} href={a.href} style={{ ...linkCard, ...row, display: "flex" }}>
                    <span style={{ marginTop: 1 }}><Badge tone="accent">{a.kind}</Badge></span>
                    <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink)" }}>{a.title}</span>
                    {a.meta && <span style={{ fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{a.meta}</span>}
                  </Link>
                ))}
              </div>
            ) : <div style={{ fontSize: 13, color: "var(--faint)" }}>No approvals waiting.</div>}
          </Panel>
        </div>

        {/* Right — you & the AI brief */}
        <div>
          <Panel title="Your week">
            <div className="fos-card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
                {data.week.complete}/{data.week.total} done{data.week.overdue > 0 ? ` · ${data.week.overdue} overdue` : ""}
              </div>
              {data.week.mine.length ? data.week.mine.map((t, i) => (
                <Link key={i} href={t.href} style={{ ...linkCard, display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: i < data.week.mine.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{t.title}</span>
                  <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{(t.status || "").replace(/_/g, " ").toLowerCase()}</span>
                </Link>
              )) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Nothing assigned to you this week.</div>}
              <div style={{ marginTop: 10 }}><Link href="/perform/my-week" style={{ fontSize: 12.5, color: "var(--accent)" }}>Open My Finance Week →</Link></div>
            </div>
          </Panel>

          <Panel title="Latest brief" note="governed — drafted for sign-off">
            <div className="fos-card" style={{ padding: "14px 16px" }}>
              {data.briefing ? (
                <>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{data.briefing.headline || data.briefing.title || "Finance brief"}</div>
                  {data.briefing.summary && <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>{String(data.briefing.summary).slice(0, 220)}{String(data.briefing.summary).length > 220 ? "…" : ""}</div>}
                  <div style={{ marginTop: 10 }}><Link href="/finance-os/briefings" style={{ fontSize: 12.5, color: "var(--accent)" }}>Read the full brief →</Link></div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No brief yet. <Link href="/finance-os/briefings" style={{ color: "var(--accent)" }}>Open Proactive Briefings →</Link></div>
              )}
            </div>
          </Panel>

          <Panel title="Recent reports">
            <div className="fos-card" style={{ padding: "8px 16px" }}>
              {data.reports.length ? data.reports.map((r, i) => (
                <Link key={r.id} href={`/finance-os/home/reports/${r.id}`} style={{ ...linkCard, display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: i < data.reports.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{r.title}</span>
                  <Badge tone={r.status === "APPROVED" || r.status === "ISSUED" ? "green" : r.status === "DRAFT" ? "muted" : "amber"}>{r.status}</Badge>
                </Link>
              )) : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No reports yet.</div>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
