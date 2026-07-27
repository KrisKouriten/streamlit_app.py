"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * AI Perspective (Phase 3) — the page-anchored surface of the shared Finance
 * Intelligence Layer. A button drops into a governed page and passes its
 * pageContext (pageId + the page's current filters) to /api/intelligence/
 * perspective, which runs the SAME governed orchestrator as Finance Buddy:
 * permissions → retrieve only the governed slices the existing services produce
 * → confidence → the model interprets (never computes) → audited run.
 *
 * This is pure chrome + a thin client: it renders the structured perspective,
 * its sources and honest confidence, and lets a user turn a recommendation into
 * a governed Action. It computes nothing and the model can take no action.
 */

const CONF = {
  HIGH: ["High confidence", "var(--green)", "var(--green-bg)"],
  MEDIUM: ["Medium confidence", "var(--amber)", "var(--amber-bg)"],
  LOW: ["Low confidence", "var(--red)", "var(--red-bg)"],
};

async function perspectiveApi(body) {
  const res = await fetch("/api/intelligence/perspective", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function Section({ title, items }) {
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

function RecommendedActions({ actions, pageId, runId }) {
  const [state, setState] = useState({}); // index → "saving" | actionId | "error"
  if (!actions || !actions.length) return null;
  async function create(i, text) {
    setState((s) => ({ ...s, [i]: "saving" }));
    const { ok, data } = await perspectiveApi({
      action: "create-action", pageId, runId,
      title: text, description: `${text}\n\nRaised from AI Perspective (${pageId}).`,
    });
    setState((s) => ({ ...s, [i]: ok ? data.actionId : "error" }));
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div className="fos-eyebrow" style={{ color: "var(--faint)", marginBottom: 6 }}>Recommended actions <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· draft, for human sign-off</span></div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.map((t, i) => {
          const st = state[i];
          return (
            <li key={i} style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ flex: 1 }}>{t}</span>
              {typeof st === "number" ? (
                <span style={{ fontSize: 11, color: "var(--green)", whiteSpace: "nowrap", fontWeight: 600 }}>✓ Action #{st}</span>
              ) : (
                <button onClick={() => create(i, t)} disabled={st === "saving"}
                  style={{ flex: "none", fontSize: 11, fontWeight: 600, color: st === "error" ? "var(--red)" : "var(--accent)", background: "transparent", border: "1px solid var(--line-strong)", borderRadius: 7, padding: "3px 9px", cursor: st === "saving" ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {st === "saving" ? "Creating…" : st === "error" ? "Retry" : "Create Action"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Sources({ sources }) {
  if (!sources || !sources.length) return null;
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
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
  );
}

function Feedback({ runId }) {
  const [sent, setSent] = useState(null);
  if (!runId) return null;
  async function rate(rating) { setSent(rating); try { await perspectiveApi({ action: "feedback", runId, rating }); } catch {} }
  if (sent) return <span style={{ fontSize: 11, color: "var(--faint)" }}>Thanks for the feedback.</span>;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--faint)" }}>Useful?</span>
      <button onClick={() => rate("HELPFUL")} aria-label="Helpful" style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>👍</button>
      <button onClick={() => rate("NOT_HELPFUL")} aria-label="Not helpful" style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>👎</button>
    </div>
  );
}

export default function PerspectivePanel({ pageId, pageName = "this page", filters = null, label = "AI Perspective" }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { perspective, sources, confidence, claimsVerified, warnings, runId, refusal }
  const [error, setError] = useState(null);

  const loadSuggestions = useCallback(async () => {
    try { const { data } = await perspectiveApi({ action: "suggestions", pageId }); setSuggestions(data.questions || []); } catch {}
  }, [pageId]);

  useEffect(() => { if (open && !suggestions.length) loadSuggestions(); }, [open, suggestions.length, loadSuggestions]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && open) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function run(question = "") {
    setLoading(true); setError(null); setResult(null);
    try {
      const { ok, data } = await perspectiveApi({ action: "perspective", pageId, filters: filters || {}, question });
      if (!ok) setError(data.error || "Could not generate a perspective.");
      else setResult(data);
    } catch { setError("Network error — please try again."); }
    finally { setLoading(false); }
  }

  const p = result?.perspective;
  const conf = result?.confidence?.level || p?.confidence?.level;
  const [confLabel, confFg, confBg] = CONF[conf] || CONF.MEDIUM;

  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "1px solid var(--accent-deep)", borderRadius: 9, padding: "7px 13px", cursor: "pointer" }}>
        <span aria-hidden="true">✦</span> {label}
      </button>

      {open && (
        <>
          <div onMouseDown={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(8,7,6,.34)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }} />
          <div className="fos-glass" role="dialog" aria-modal="true" aria-label={`AI Perspective — ${pageName}`}
            style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 200, width: "min(500px, 96vw)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)", borderLeft: "1px solid var(--glass-line)", animation: "fosSlideIn .26s var(--ease) both" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--glass-line)" }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)", flex: "none" }} />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                <strong style={{ fontSize: 14.5, color: "var(--ink)", letterSpacing: "-.01em" }}>AI Perspective</strong>
                <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{pageName} · governed figures only, never invented</span>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="fos-kbd" style={{ marginLeft: "auto", cursor: "pointer", padding: "3px 8px" }}>esc</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {/* Idle: intro + generate + suggested questions */}
              {!loading && !result && !error && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, margin: 0 }}>
                    A governed read of what you’re looking at — position, drivers, risks and draft recommendations — over the same figures shown on this page{filters && Object.keys(filters).length ? ", with your current filters applied" : ""}. Sources and confidence are shown; nothing is invented and no action is taken.
                  </p>
                  <button onClick={() => run("")}
                    style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--accent-deep)", background: "var(--accent)", color: "var(--accent-ink)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    ✦ Generate perspective
                  </button>
                  {suggestions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <div className="fos-eyebrow" style={{ color: "var(--faint)" }}>Or ask</div>
                      {suggestions.map((s) => (
                        <button key={s.question || s} onClick={() => run(s.question || s)}
                          style={{ textAlign: "left", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 12.5, cursor: "pointer", lineHeight: 1.4 }}>
                          {s.question || s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {loading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, color: "var(--faint)", fontSize: 13 }}>
                  <span>Reading the governed figures and forming a perspective…</span>
                  <span style={{ fontSize: 11.5 }}>Retrieving only the approved data for this page, then interpreting.</span>
                </div>
              )}

              {error && (
                <div style={{ fontSize: 13, color: "var(--red)", lineHeight: 1.5 }}>
                  {error}
                  <div style={{ marginTop: 12 }}>
                    <button onClick={() => run("")} className="fos-kbd" style={{ cursor: "pointer", padding: "4px 10px" }}>Try again</button>
                  </div>
                </div>
              )}

              {result?.refusal && (
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                  I can’t provide a perspective on that — it falls outside what I’m allowed to do. I interpret governed finance data for this page and can’t take actions or go beyond it.
                </div>
              )}

              {p && !result?.refusal && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <span title={result?.confidence?.reason || p?.confidence?.reason || ""} style={{ fontSize: 10.5, fontWeight: 600, color: confFg, background: confBg, padding: "2px 8px", borderRadius: 6 }}>{confLabel}</span>
                    {result?.claimsVerified === true && <span style={{ fontSize: 10.5, color: "var(--green)" }}>figures verified against sources</span>}
                    {result?.claimsVerified === false && <span style={{ fontSize: 10.5, color: "var(--amber)" }}>some figures unverified — review</span>}
                  </div>

                  {p.executive_summary && (
                    <p style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6, margin: 0, fontWeight: 500 }}>{p.executive_summary}</p>
                  )}

                  <Section title="Facts" items={p.facts} />
                  <Section title="Drivers" items={p.drivers} />
                  <Section title="Connected context" items={p.connected_context} />
                  <Section title="Risks" items={p.risks} />
                  <Section title="Opportunities" items={p.opportunities} />
                  <RecommendedActions actions={p.recommended_actions} pageId={pageId} runId={result?.runId} />
                  <Section title="Financial effects" items={p.financial_effects} />
                  <Section title="Data quality" items={p.data_quality} />
                  {result?.warnings?.length ? <Section title="Data limitations" items={result.warnings} /> : null}

                  <Sources sources={result?.sources} />

                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--hairline)", flexWrap: "wrap" }}>
                    <Feedback runId={result?.runId} />
                    <button onClick={() => run("")} className="fos-kbd" style={{ marginLeft: "auto", cursor: "pointer", padding: "4px 10px" }}>Regenerate</button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: "9px 16px", borderTop: "1px solid var(--glass-line)", fontSize: 10, color: "var(--faint)", textAlign: "center" }}>
              Governed interpretation, not advice. Board / investor material is always a draft for human sign-off.
            </div>
          </div>
        </>
      )}
    </>
  );
}
