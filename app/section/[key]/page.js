import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { findSection, resolveHref } from "../../../lib/nav-registry";
import { Badge } from "../../finance-os/ui";

export const dynamic = "force-dynamic";

// Section mini exec hub — clicking a sidebar section header lands here. It
// surfaces every subsection in that section as a card (live modules link out;
// planned ones show their status), so each section has its own overview.
export default async function SectionHub({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { key } = await params;
  const section = findSection(key);
  if (!section) notFound();

  const [kindLabel, kindBlurb] = section.kind || ["Section", ""];
  const items = section.items.filter((it) => !it.action);
  const live = items.filter((it) => !resolveHref(it).startsWith("/module/")).length;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ margin: "0.5rem 0 1.6rem" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>
          Section overview
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 23, fontWeight: 650, letterSpacing: "-.022em" }}>{section.label}</h1>
          <Badge tone="muted">{kindLabel}</Badge>
        </div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, maxWidth: 680, lineHeight: 1.6 }}>
          {kindBlurb}. {live} of {items.length} modules are live; the rest are scheduled and shown with their status.
        </p>
      </header>

      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
        {items.map((it) => {
          const href = resolveHref(it);
          const planned = href.startsWith("/module/");
          return (
            <Link key={it.label} href={href} className="fos-card hover" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-.015em", color: "var(--ink)" }}>{it.label}</span>
                {planned ? <Badge tone="amber">Planned</Badge> : <Badge tone="accent">Live</Badge>}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>{it.hint}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
