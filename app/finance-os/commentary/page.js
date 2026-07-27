import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listCommentary, getCommentary } from "../../../lib/intelligence/commentary";
import { COMMENTARY_SUBJECTS } from "../../../lib/intelligence/commentary-rules";
import { PageHeader } from "../ui";
import { DraftControl, SignOffControls } from "./commentary-controls";

export const dynamic = "force-dynamic";

const CONF = { HIGH: ["High confidence", "var(--green)", "var(--green-bg)"], MEDIUM: ["Medium confidence", "var(--amber)", "var(--amber-bg)"], LOW: ["Low confidence", "var(--red)", "var(--red-bg)"] };
const STATUS = { DRAFT: ["Draft", "var(--amber)", "var(--amber-bg)"], APPROVED: ["Approved", "var(--green)", "var(--green-bg)"], REJECTED: ["Rejected", "var(--red)", "var(--red-bg)"] };

function Pill({ map, k }) {
  const [label, fg, bg] = map[k] || ["—", "var(--muted)", "var(--chip)"];
  return <span style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6 }}>{label}</span>;
}

export default async function Commentary({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canDraft = hasRole(session, "ADMIN", "FINANCE");
  const canSignOff = hasRole(session, "ADMIN", "FINANCE", "EXEC");

  const sp = (await searchParams) || {};
  const items = await listCommentary(30);
  const selectedId = sp.c ? Number(sp.c) : (items[0]?.commentary_id ?? null);
  const current = selectedId ? await getCommentary(selectedId) : null;
  const draft = current?.draft || null;
  const sources = current?.sources || [];

  return (
    <div className="fos-shell">
      <PageHeader crumb="Home · Finance Intelligence" title="Drafted commentary"
        right={items.length ? `${items.length} recent` : "None yet"} />

      <div style={{ fontSize: 12.5, color: "var(--faint)", marginBottom: 16, maxWidth: 720, lineHeight: 1.5 }}>
        AI-drafted narrative over governed figures, for a human to check and sign off. A draft is never final — Board / investor commentary must be approved by a person before use.
      </div>

      {canDraft && (
        <div style={{ marginBottom: 18 }}><DraftControl /></div>
      )}

      {!items.length ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          No commentary yet. {canDraft ? "Pick a subject above and draft one." : "A finance user can draft one."}
          <div style={{ marginTop: 8, fontSize: 12 }}>If drafting fails, confirm migration <span style={{ fontFamily: "var(--mono)" }}>042</span> has been run.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 20, alignItems: "start" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "20px 22px", boxShadow: "var(--shadow-1)" }}>
            {current && draft ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <span className="fos-eyebrow" style={{ color: "var(--faint)" }}>{COMMENTARY_SUBJECTS[current.subject]?.label || current.subject}{current.scope_ref ? ` · ${current.scope_ref}` : ""}</span>
                  <Pill map={STATUS} k={current.status} />
                  {current.confidence && <Pill map={CONF} k={current.confidence} />}
                </div>
                <h2 style={{ fontSize: 19, fontWeight: 650, letterSpacing: "-.02em", margin: "4px 0 12px", lineHeight: 1.25 }}>{draft.title || current.title}</h2>
                {draft.summary && <p style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.6, margin: "0 0 14px", fontWeight: 500 }}>{draft.summary}</p>}
                {(draft.sections || []).map((s, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 4 }}>{s.heading}</div>
                    <p style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{s.body}</p>
                  </div>
                ))}

                {sources.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
                    <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 6 }}>{sources.length} source{sources.length > 1 ? "s" : ""}</div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                      {sources.map((s, i) => (
                        <li key={i} style={{ fontSize: 11.5, color: "var(--muted)", borderLeft: "2px solid var(--line-strong)", paddingLeft: 9, lineHeight: 1.4 }}>
                          <span style={{ color: "var(--ink)", fontWeight: 550 }}>{s.label}</span>{s.period ? ` · ${s.period}` : ""}
                          {s.route ? <a href={s.route} style={{ color: "var(--accent)", marginLeft: 6 }}>open →</a> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {current.status === "DRAFT" && canSignOff && <SignOffControls commentaryId={current.commentary_id} />}
                {current.status !== "DRAFT" && (
                  <div style={{ marginTop: 16, fontSize: 11.5, color: "var(--faint)" }}>
                    {current.status === "APPROVED" ? "Approved" : "Rejected"} by {current.reviewed_by} · {current.reviewed_at ? new Date(current.reviewed_at).toLocaleString("en-GB") : ""}
                    {current.review_note ? <div style={{ marginTop: 4, fontStyle: "italic" }}>“{current.review_note}”</div> : null}
                  </div>
                )}
                <div style={{ marginTop: 14, fontSize: 10.5, color: "var(--faint)" }}>Governed interpretation of the figures shown — a draft for human sign-off, not advice or a published statement.</div>
              </>
            ) : (
              <p style={{ fontSize: 13.5, color: "var(--faint)" }}>Select a draft to view it.</p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 2 }}>Recent</div>
            {items.map((c) => {
              const on = c.commentary_id === selectedId;
              return (
                <a key={c.commentary_id} href={`/finance-os/commentary?c=${c.commentary_id}`}
                  style={{ display: "block", textDecoration: "none", padding: "9px 11px", borderRadius: 10, border: `1px solid ${on ? "var(--accent-deep)" : "var(--line)"}`, background: on ? "var(--accent-bg)" : "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>{COMMENTARY_SUBJECTS[c.subject]?.label || c.subject}</span>
                    <Pill map={STATUS} k={c.status} />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>{new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}{c.scope_ref ? ` · ${c.scope_ref}` : ""}</div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
