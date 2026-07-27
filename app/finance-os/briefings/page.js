import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listBriefings, getBriefing } from "../../../lib/intelligence/briefing";
import { PageHeader } from "../ui";
import GenerateBriefingButton from "./generate-button";

export const dynamic = "force-dynamic";

const CONF = {
  HIGH: ["High confidence", "var(--green)", "var(--green-bg)"],
  MEDIUM: ["Medium confidence", "var(--amber)", "var(--amber-bg)"],
  LOW: ["Low confidence", "var(--red)", "var(--red-bg)"],
};

function Chip({ level }) {
  const [label, fg, bg] = CONF[level] || CONF.MEDIUM;
  return <span style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6 }}>{label}</span>;
}

function List({ title, items }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 6 }}>{title}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5, paddingLeft: 14, position: "relative" }}>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, color: "var(--accent)" }}>·</span>{t}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function Briefings({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canGenerate = hasRole(session, "ADMIN", "FINANCE");

  const sp = (await searchParams) || {};
  const briefs = await listBriefings(20);
  const selectedId = sp.b ? Number(sp.b) : (briefs[0]?.briefing_id ?? null);
  const current = selectedId ? await getBriefing(selectedId) : null;
  const body = current?.body || null;
  const sources = current?.sources || [];

  return (
    <div className="fos-shell">
      <PageHeader crumb="Home · Finance Intelligence" title="Proactive briefings"
        right={briefs.length ? `${briefs.length} recent` : "None yet"} />

      {canGenerate && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "-0.5rem 0 1rem" }}>
          <GenerateBriefingButton />
        </div>
      )}

      {!briefs.length ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", lineHeight: 1.55 }}>
          No briefings yet. One is generated automatically on weekday mornings; {canGenerate ? "or use “Generate brief now” above." : "check back after the next run."}
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--faint)" }}>If this persists, confirm migration <span style={{ fontFamily: "var(--mono)" }}>041</span> has been run.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 20, alignItems: "start" }}>
          {/* Current brief */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "20px 22px", boxShadow: "var(--shadow-1)" }}>
            {current && body ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                  <span className="fos-eyebrow" style={{ color: "var(--faint)" }}>{current.title}</span>
                  {current.confidence && <Chip level={current.confidence} />}
                </div>
                {body.headline && <h2 style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-.02em", margin: "6px 0 10px", lineHeight: 1.25 }}>{body.headline}</h2>}
                {body.summary && <p style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.6, margin: 0 }}>{body.summary}</p>}
                <List title="Highlights" items={body.highlights} />
                <List title="Watch items" items={body.watch_items} />
                <List title="Recommended focus" items={body.recommended_focus} />
                {body.recommended_focus?.length > 0 && (
                  <a href={`/finance-os/benefit-realisation?run=${current.run_id}&origin=BRIEFING`}
                    style={{ display: "inline-block", marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                    Track a recommendation as a benefit →
                  </a>
                )}
                {sources.length > 0 && (
                  <div style={{ marginTop: 18, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
                    <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 6 }}>{sources.length} source{sources.length > 1 ? "s" : ""}</div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                      {sources.map((s, i) => (
                        <li key={i} style={{ fontSize: 11.5, color: "var(--muted)", borderLeft: "2px solid var(--line-strong)", paddingLeft: 9, lineHeight: 1.4 }}>
                          <span style={{ color: "var(--ink)", fontWeight: 550 }}>{s.label}</span>
                          {s.period ? ` · ${s.period}` : ""}
                          {s.dataThrough ? ` · as at ${new Date(s.dataThrough).toLocaleDateString("en-GB")}` : ""}
                          {s.route ? <a href={s.route} style={{ color: "var(--accent)", marginLeft: 6 }}>open →</a> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div style={{ marginTop: 16, fontSize: 10.5, color: "var(--faint)" }}>
                  Governed interpretation over the figures shown across Finance OS — not advice. Board / investor material is a draft for human sign-off.
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13.5, color: "var(--faint)" }}>Select a briefing to view it.</p>
            )}
          </div>

          {/* Recent list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 2 }}>Recent</div>
            {briefs.map((b) => {
              const on = b.briefing_id === selectedId;
              return (
                <a key={b.briefing_id} href={`/finance-os/briefings?b=${b.briefing_id}`}
                  style={{ display: "block", textDecoration: "none", padding: "9px 11px", borderRadius: 10, border: `1px solid ${on ? "var(--accent-deep)" : "var(--line)"}`, background: on ? "var(--accent-bg)" : "var(--surface)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>{b.headline || b.title}</div>
                  <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>{new Date(b.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
