import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { findModule } from "../../../lib/nav-registry";
import { Badge } from "../../finance-os/ui";

export const dynamic = "force-dynamic";

// Planned modules from the target navigation render here until built — a
// professional placeholder: name, purpose, module kind, planned milestone,
// current status and dependencies. Feature-flagging a slug in the registry
// (MODULE_FLAGS) sends its navigation entries to the live route instead.
export default async function PlannedModule({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { slug } = await params;
  const mod = findModule(slug);
  if (!mod) notFound();

  const [kindLabel, kindBlurb] = mod.kind || ["Module", ""];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ margin: "0.5rem 0 1.6rem" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>
          {mod.section} · {mod.label}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em" }}>{mod.label}</h1>
          <Badge tone="amber">Planned</Badge>
          <Badge tone="muted">{kindLabel}</Badge>
        </div>
      </header>

      <div className="fos-card" style={{ padding: "18px 20px", marginBottom: 14 }}>
        <Row k="Purpose" v={mod.hint} strong />
        <Row k="Module kind" v={`${kindLabel} — ${kindBlurb}`} />
        <Row k="Planned milestone" v={mod.milestone} />
        <Row k="Current status" v="Planned — designed into the target navigation; the working screen lands at this address without the route changing." />
        <Row k="Dependencies" v={(mod.deps || []).join(" · ")} last />
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

function Row({ k, v, strong, last }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "9px 0", borderBottom: last ? "none" : "1px solid var(--hairline)", alignItems: "baseline" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", width: 148, flex: "none" }}>{k}</span>
      <span style={{ fontSize: strong ? 14 : 13, color: strong ? "var(--ink)" : "var(--muted)", lineHeight: 1.55 }}>{v}</span>
    </div>
  );
}
