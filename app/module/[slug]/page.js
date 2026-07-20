import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { findModule } from "../../../lib/nav-registry";
import { Badge } from "../../finance-os/ui";

export const dynamic = "force-dynamic";

// Planned modules from the target navigation render here until built — with a
// real page title, breadcrumb and purpose, so navigation is complete and honest.
export default async function PlannedModule({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { slug } = await params;
  const mod = findModule(slug);
  if (!mod) notFound();

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ margin: "0.5rem 0 1.6rem" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>
          {mod.section} · {mod.label}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em" }}>{mod.label}</h1>
          <Badge tone="amber">Planned</Badge>
        </div>
      </header>

      <div className="fos-card" style={{ padding: "18px 20px", marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.6, marginBottom: 6 }}>{mod.hint}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          This module is part of the target operating platform and is scheduled in the build plan.
          It has a permanent home in the navigation now so the structure is complete; the working
          screen lands here without the address changing.
        </div>
      </div>

      {mod.related?.length > 0 && (
        <div className="fos-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>
            Live today — closest existing modules
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {mod.related.map(([label, href]) => (
              <Link key={href} href={href} className="fos-btn-ghost" style={{ textDecoration: "none" }}>{label} →</Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
