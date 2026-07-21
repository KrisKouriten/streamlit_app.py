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
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Version 1.3 · the operating manual for the Connected Finance Function. Canonical copy: <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>docs/SOP.md</code>.</div>
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

      <H>2 · Navigation — eight sections</H>
      <P>A persistent sidebar on every screen, driven by one registry. Each section header links to a mini exec hub of its subsections; the chevron toggles the group. Planned modules show a labelled "soon" placeholder. Go anywhere with ⌘K.</P>
      <Rows head={["Section", "What lives here"]} rows={[
        ["HOME", "Executive Intelligence Hub — position, what needs attention, operating health."],
        ["DASHBOARDS", "Management Accounts, Budget & Forecast, Store Sales & KPI, Franchise, Inventory, SKU Analysis, Cash Flow, Fixed Assets, Month-End status — each badged real feed or illustrative."],
        ["PLAN", "Forecast Builder (3-tab store workbook → store→entity→group) and Scenario Planning."],
        ["PERFORM", "The against-plan read — Management Accounts, Store Performance, Franchise, Inventory, Cash Flow, Fixed Assets."],
        ["OPERATE", "My Finance Week, Team Schedule, Month-End Close, Management Accounts Close, Procurement, Action Centre, Intercompany, Task Review & Library."],
        ["DIGITAL FINANCE TEAM", "The finance agents — Agent Activity, Agent Reviews and AI Benefits."],
        ["FINANCE DATA", "The mastered dimensions — Entities live; chart of accounts, stores, suppliers and the rest to follow."],
        ["GOVERN", "Users & Roles and this SOP Library; permissions, approvals, controls and audit to follow."],
      ]} />

      <H>3 · The operating rhythm</H>
      <P><strong>Daily:</strong> start at HOME → "Needs attention" (ranked; clear critical first) and clear the Agent Reviews queue. <strong>Weekly (Mon):</strong> generate the week (OPERATE → Finance Team Schedule), the team works My Finance Week, reviewers approve, run the store agents, review store trading (DASHBOARDS → Store Sales & KPI). <strong>Monthly:</strong> run the management-accounts pre-close checks; management accounts once Joiin actuals are loaded; work the month-end close board (owner + status per entity); reconcile procurement spend vs the cash budget; validate realised benefits; chase overdue actions. <strong>Quarterly / planning:</strong> refresh the forecast (PLAN → Forecast Builder) and flex it in Scenario Planning; review agent performance, task templates, roles and entities.</P>

      <H>4 · Modules</H>
      <P><strong>HOME</strong> shows two truths kept distinct by source chip: trading (all stores, store feed) and statutory finance (connected entities, the Joiin feed). <strong>Weekly Schedule</strong>: an assignee can only reach "ready for review" — only a reviewer's decision completes a task. <strong>The two closes:</strong> Month-End Close is a status board (each entity's tasks, a finance owner, Open/Done, summary strip); Management Accounts Close is assurance — pre-close checks (completeness/accrual, cost drift, sign) with confirm/correct/explain. <strong>Forecast Builder</strong> ingests a 3-tab store workbook (sales, cost assumptions, labour seasonality) and builds the forecast at store level, rolled up to entity and group, amending &amp; adding on re-upload. <strong>AI agents</strong> can only read (SELECT); material outputs require human sign-off. <strong>Action Centre</strong>: OPEN → IN_PROGRESS → COMPLETE → CLOSED, where closure is a separate approval; an expected value auto-creates a benefit opportunity to realise then validate.</P>

      <H>5 · Entities &amp; consolidation</H>
      <P>Finance Data → Entities is the register of legal entities Miniso UK consolidates. The display name is house-style ("Miniso UK — <em>location</em>"); the legal name is used for statutory mapping and the store→entity forecast hierarchy. A connected entity's actuals flow into the consolidated finance dashboards. Add or amend entities there (ADMIN/FINANCE); retire one by unticking Active.</P>

      <H>6 · Data feeds &amp; refresh</H>
      <P>The app reads only its database — feeds are loaded into it. <strong>Store sales</strong> load from the store export (9-day freshness tolerance; staleness is flagged). <strong>Consolidated finance</strong> comes from <strong>Joiin</strong> (26 companies, eliminations), with Xero as fallback; a refresh pulls the P&amp;L + cash, maps &amp; reconciles (the mapper refuses a load if a penny is lost), and ingests tagged with its source. <strong>Forecast inputs</strong> load through PLAN → Forecast Builder (3-tab workbook, upsert). Procurement and SKU carry an illustrative seed until their real extract is uploaded.</P>

      <H>7 · Governance &amp; controls</H>
      <P>Separation of duties throughout (completion vs approval, realised vs validated). AI guardrails are structural — read-only, material outputs always reviewed. Every state change writes an audit event. The Data Quality agent and HOME surface stale or incomplete feeds.</P>

      <H>8 · Security &amp; house style</H>
      <P>"Miniso UK" in all outputs; legal entity names only where a document is legal/statutory or a connected-system identifier (bank, HMRC, Companies House, Xero/Joiin org names, the store→entity forecast hierarchy). No personal data in exports. Real entity-level financials are internal working material — no share-ready or external summaries without explicit confirmation and human review; escalate anything for a regulator, investors, the Board, or that could be inside information for the listed parent group.</P>

      <div style={{ marginTop: 30, fontSize: 12.5, color: "var(--faint)" }}>
        Full detail — feeds, migrations, extension guide, troubleshooting and glossary — is in <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>docs/SOP.md</code>. Back to <Link href="/govern" style={{ color: "var(--accent)" }}>Govern</Link>.
      </div>
    </div>
  );
}
