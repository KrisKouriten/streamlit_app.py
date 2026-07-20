import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { getDashboards } from "../lib/finance-os";
import { getFreshness } from "../lib/governance";

/*
 * Shared server component for the pillar hub pages (PLAN / PERFORM / OPERATE /
 * AI CONTROL TOWER / GOVERN). Cards come from the dashboard registry filtered
 * by nav_pillar, plus pillar-specific extras (e.g. month-end close, admin).
 */

function Card({ href, title, purpose, meta, disabled }) {
  const body = (
    <div className={`fos-card${href && !disabled ? " hover" : ""}`} style={{ padding: "17px 18px", height: "100%", opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-.015em", color: "var(--ink)" }}>{title}</div>
        {disabled && <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", flex: "none" }}>Coming soon</span>}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginBottom: meta ? 11 : 0 }}>{purpose}</div>
      {meta && <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{meta}</div>}
    </div>
  );
  return href && !disabled
    ? <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link>
    : <div>{body}</div>;
}

export default async function PillarHub({ pillar, title, intro, extras = [] }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [dashboards, freshness] = await Promise.all([getDashboards(), getFreshness(null)]);
  // pillar=null → fixed-content hub: only the extras, no registry cards.
  const cards = (pillar ? dashboards.filter((d) => d.nav_pillar === pillar) : [])
    .map((d) => ({
      href: d.route, title: d.dashboard_name, purpose: d.purpose,
      meta: `Owner: ${d.finance_owner} · ${d.refresh_frequency}`,
    }));
  const visibleExtras = extras.filter((e) => !e.roles || e.roles.some((r) => session.roles?.includes(r)));

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ margin: "0.5rem 0 1.9rem" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>Finance OS · {title}</div>
        <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em", lineHeight: 1.15 }}>{title}</div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>{intro}</p>
      </header>
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {[...cards, ...visibleExtras].map((c) => <Card key={c.title} {...c} />)}
      </div>
      {freshness && pillar === "OPERATE" && (
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 20 }}>
          Latest data load: {new Date(freshness.completed_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          {" · "}{Number(freshness.rows_loaded).toLocaleString("en-GB")} rows · {freshness.source_system}
        </div>
      )}
    </div>
  );
}
