import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";

export const dynamic = "force-dynamic";

/* The Finance OS operating manual, in-app. Canonical written copy lives in
   docs/SOP.md; this is the version the signed-in team reads in place. */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" };
function H({ children }) { return <h2 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.015em", margin: "30px 0 10px" }}>{children}</h2>; }
function P({ children }) { return <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, margin: "8px 0", maxWidth: "72ch" }}>{children}</p>; }
function Rows({ head, rows }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)", margin: "12px 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: "left", padding: "9px 14px", color: "var(--faint)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--line)" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ padding: "9px 14px", borderBottom: ri === rows.length - 1 ? "none" : "1px solid var(--line)", color: ci === 0 ? "var(--ink)" : "var(--muted)", fontWeight: ci === 0 ? 560 : 400, verticalAlign: "top" }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function Handbook() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.75rem 1.25rem 5rem" }}>
      <header style={{ marginBottom: 8 }}>
        <span className="fos-eyebrow">Govern · Handbook</span>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-.02em", margin: "12px 0 4px" }}>Finance OS — Standard Operating Procedure</h1>
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Version 1.1 · the operating manual for the Connected Finance Function. Canonical copy: <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>docs/SOP.md</code>.</div>
      </header>

      <div style={{ ...card, borderColor: "var(--accent-deep)", background: "var(--accent-bg)", marginTop: 16 }}>
        <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>
          <strong>Four principles.</strong> Completion is never approval (separate rights). AI never auto-acts — every agent output is reviewed by a person. Every figure is tagged real vs illustrative with its source and as-at date. Everything is audited.
        </div>
      </div>

      <H>1 · Access &amp; roles</H>
      <P>Sign in with your Miniso UK email; sessions last 12 hours; sign out is in the top-right on every screen. An ADMIN creates accounts under Govern → Users &amp; roles. Everyone can view all dashboards — the controls below gate actions, not visibility.</P>
      <Rows head={["Role", "Can do beyond viewing"]} rows={[
        ["ADMIN", "Everything, plus manage users, roles and entities."],
        ["FINANCE", "Run agents; approve task reviews; approve action closure; validate benefits; generate the weekly schedule; manage entities."],
        ["EXEC", "Approve action closure; validate benefits."],
        ["OPS", "Do and complete assigned work; raise actions. No closure approval or benefit validation."],
      ]} />

      <H>2 · The pillars</H>
      <Rows head={["Pillar", "Purpose"]} rows={[
        ["HOME", "The connected sphere — position, what needs attention, operating health."],
        ["PLAN", "Strategic planning — Budget & Forecast (its home); scenario planning to follow."],
        ["DASHBOARDS", "The seven specialist dashboards: Management Accounts, Budget & Forecast, Cash Flow, Store Sales & KPI, Inventory, Franchise, Fixed Assets — each badged real feed or illustrative."],
        ["OPERATE", "Operational controls: Intercompany."],
        ["WORKFLOW", "The finance team's cadence — My Week, Team Schedule, Review queue, Month-end close, Task Library."],
        ["AI CONTROL TOWER", "The finance agents — runs, review and controls."],
        ["GOVERN", "Users, Entities, Action Centre, Benefits, this Handbook."],
      ]} />

      <H>3 · The operating rhythm</H>
      <P><strong>Daily:</strong> start at HOME → "Needs attention" (ranked; clear critical first) and clear the AI review queue. <strong>Weekly (Mon):</strong> generate the week (WORKFLOW → Schedule), the team works My Week, reviewers approve, run the store agents, review store trading (DASHBOARDS → Store Sales). <strong>Monthly:</strong> management accounts once Xero actuals are loaded; month-end close tasks; validate realised benefits; chase overdue actions. <strong>Quarterly:</strong> review agent performance, refresh task templates, review roles and entities.</P>

      <H>4 · Modules</H>
      <P><strong>HOME</strong> shows two truths kept distinct by source chip: trading (all stores, store feed) and statutory finance (connected Xero entities). <strong>Weekly Schedule</strong>: an assignee can only reach "ready for review" — only a reviewer's decision completes a task. <strong>AI agents</strong> can only read (SELECT); material outputs require human sign-off before becoming an insight or action. <strong>Action Centre</strong>: OPEN → IN_PROGRESS → COMPLETE → CLOSED, where closure is a separate approval; an expected value auto-creates a benefit opportunity to realise then validate. <strong>Finance dashboards</strong> show real Xero actuals, consolidated across connected entities, with a scope banner.</P>

      <H>5 · Entities &amp; consolidation</H>
      <P>Govern → Entities is the register of legal entities Miniso UK consolidates. The display name is house-style ("Miniso UK — <em>location</em>"); the legal name is used for statutory/Xero mapping. An entity with a live Xero feed is marked "Connected" and its actuals flow into the consolidated finance dashboards. Add or amend entities there (ADMIN/FINANCE); retire one by unticking Active.</P>

      <H>6 · Data feeds &amp; refresh</H>
      <P>The app reads only its database — feeds are loaded into it. <strong>Store sales</strong> load from the store export (9-day freshness tolerance; staleness is flagged). <strong>Xero finance</strong> is refreshed in a Claude session: pull P&amp;L + cash, map &amp; reconcile (the mapper refuses a load if a penny is lost), ingest tagged <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>XERO</code>. To add an entity to the consolidation, connect its Xero org, add it under Govern → Entities, and load it.</P>

      <H>7 · Governance &amp; controls</H>
      <P>Separation of duties throughout (completion vs approval, realised vs validated). AI guardrails are structural — read-only, material outputs always reviewed. Every state change writes an audit event. The Data Quality agent and HOME surface stale or incomplete feeds.</P>

      <H>8 · Security &amp; house style</H>
      <P>"Miniso UK" in all outputs; legal entity names only where a document is legal/statutory or a connected-system identifier. No personal data in exports. Real entity-level financials are internal working material — no share-ready or external summaries without explicit confirmation and human review; escalate anything for a regulator, investors, the Board, or that could be inside information for the listed parent group.</P>

      <div style={{ marginTop: 30, fontSize: 12.5, color: "var(--faint)" }}>
        Full detail — feeds, migrations, extension guide, troubleshooting and glossary — is in <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>docs/SOP.md</code>. Back to <Link href="/govern" style={{ color: "var(--accent)" }}>Govern</Link>.
      </div>
    </div>
  );
}
