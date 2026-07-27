"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Finance Buddy — the persistent conversational surface for the shared Finance
 * Intelligence Layer (Phase 2). A floating button (⌘/Ctrl-J, or the "Ask Finance
 * Buddy" palette action firing "fos:buddy") opens a right-hand workspace panel.
 *
 * It is pure chrome + a thin client for /api/intelligence/ask: it renders the
 * dialogue, sources and honest confidence, but computes nothing — every figure
 * and every guardrail lives server-side in the governed orchestrator.
 */

const CONF = {
  HIGH: ["High confidence", "var(--green)", "var(--green-bg)"],
  MEDIUM: ["Medium confidence", "var(--amber)", "var(--amber-bg)"],
  LOW: ["Low confidence", "var(--red)", "var(--red-bg)"],
};

const STARTERS = [
  "How did revenue and gross margin perform this period?",
  "Where is the biggest variance to forecast, and is it timing or structural?",
  "What's our cash position and are there any liquidity risks?",
  "Which stores are underperforming on conversion and basket?",
];

async function buddyApi(body) {
  const res = await fetch("/api/intelligence/ask", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function ConfidenceChip({ level }) {
  const [label, fg, bg] = CONF[level] || CONF.MEDIUM;
  return (
    <span title="Confidence reflects data freshness, whether figures are approved vs working, and source coverage."
      style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Sources({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources || !sources.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ background: "transparent", border: "none", color: "var(--faint)", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontFamily: "var(--mono)", letterSpacing: ".08em", textTransform: "uppercase" }}>{sources.length} source{sources.length > 1 ? "s" : ""}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {sources.map((s, i) => (
            <li key={i} style={{ fontSize: 11.5, color: "var(--muted)", borderLeft: "2px solid var(--line-strong)", paddingLeft: 9, lineHeight: 1.4 }}>
              <span style={{ color: "var(--ink)", fontWeight: 550 }}>{s.label}</span>
              {s.period ? ` · ${s.period}` : ""}
              {s.dataThrough ? ` · as at ${new Date(s.dataThrough).toLocaleDateString("en-GB")}` : ""}
              {s.route ? <a href={s.route} style={{ color: "var(--accent)", marginLeft: 6 }}>open →</a> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Feedback({ runId }) {
  const [sent, setSent] = useState(null);
  if (!runId) return null;
  async function rate(rating) {
    setSent(rating);
    try { await buddyApi({ action: "feedback", runId, rating }); } catch {}
  }
  if (sent) return <span style={{ fontSize: 11, color: "var(--faint)" }}>Thanks for the feedback.</span>;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--faint)" }}>Helpful?</span>
      <button onClick={() => rate("HELPFUL")} aria-label="Helpful"
        style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>👍</button>
      <button onClick={() => rate("NOT_HELPFUL")} aria-label="Not helpful"
        style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>👎</button>
    </div>
  );
}

function Message({ m }) {
  const mine = m.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
      <div style={{
        maxWidth: "92%", padding: "10px 13px", borderRadius: 13,
        background: mine ? "var(--accent-bg)" : "var(--surface)",
        border: `1px solid ${mine ? "var(--accent-deep)" : "var(--line)"}`,
        color: "var(--ink)", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {m.pending
          ? <span style={{ color: "var(--faint)" }}>Thinking through the governed figures…</span>
          : m.content}
      </div>
      {!mine && !m.pending && (
        <div style={{ maxWidth: "92%", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
            {m.confidence && <ConfidenceChip level={m.confidence} />}
            {m.refused && <span style={{ fontSize: 10.5, color: "var(--faint)" }}>within-scope refusal</span>}
          </div>
          <Sources sources={m.sources} />
          <Feedback runId={m.runId} />
        </div>
      )}
    </div>
  );
}

export default function FinanceBuddy() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const openPanel = useCallback(() => setOpen(true), []);

  // ⌘/Ctrl-J anywhere; "fos:buddy" from the command palette; Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("fos:buddy", openPanel);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("fos:buddy", openPanel); };
  }, [open, openPanel]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); }, [open]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, open]);

  async function send(question) {
    const q = (question ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", pending: true }]);
    try {
      const { ok, data } = await buddyApi({ action: "ask", question: q, conversationId });
      setMessages((prev) => {
        const next = prev.slice(0, -1); // drop the pending placeholder
        if (ok) {
          if (!conversationId && data.conversationId) setConversationId(data.conversationId);
          next.push({
            role: "assistant", content: data.answer, confidence: data.confidence?.level || null,
            sources: data.sources, refused: data.refused, runId: data.runId,
          });
        } else {
          next.push({ role: "assistant", content: data.error || "Sorry — I couldn't answer that.", confidence: null });
        }
        return next;
      });
    } catch {
      setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: "Network error — please try again." }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 20);
  }

  async function loadHistory() {
    setShowHistory((s) => !s);
    if (!showHistory) {
      try { const { data } = await buddyApi({ action: "history" }); setHistory(data.conversations || []); } catch {}
    }
  }

  async function openConversation(id) {
    setShowHistory(false);
    try {
      const { ok, data } = await buddyApi({ action: "conversation", conversationId: id });
      if (!ok) return;
      setConversationId(id);
      setMessages((data.messages || []).map((m) => ({
        role: m.role === "ASSISTANT" ? "assistant" : "user",
        content: m.content, confidence: m.confidence, sources: m.sources, refused: m.refused, runId: m.run_id,
      })));
    } catch {}
  }

  return (
    <>
      {/* Persistent trigger */}
      <button onClick={() => setOpen((o) => !o)} aria-label="Open Finance Buddy (⌘J)" title="Finance Buddy — ⌘/Ctrl-J"
        style={{
          position: "fixed", right: 22, bottom: 22, zIndex: 190, width: 52, height: 52, borderRadius: "50%",
          border: "1px solid var(--accent-deep)", background: "var(--accent)", color: "var(--accent-ink)",
          boxShadow: "var(--shadow-2)", cursor: "pointer", display: open ? "none" : "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 700, transition: "transform var(--t-fast) var(--ease)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px) scale(1.04)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}>
        <span aria-hidden="true">✦</span>
      </button>

      {open && (
        <>
          <div onMouseDown={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(8,7,6,.34)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }} />
          <div className="fos-glass" role="dialog" aria-modal="true" aria-label="Finance Buddy"
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 200, width: "min(460px, 96vw)",
              display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)", borderLeft: "1px solid var(--glass-line)",
              animation: "fosSlideIn .26s var(--ease) both",
            }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--glass-line)" }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)", flex: "none" }} />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                <strong style={{ fontSize: 14.5, color: "var(--ink)", letterSpacing: "-.01em" }}>Finance Buddy</strong>
                <span style={{ fontSize: 10.5, color: "var(--faint)" }}>Interprets governed Finance OS data — never invents figures</span>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button onClick={loadHistory} className="fos-kbd" style={{ cursor: "pointer", padding: "3px 8px" }}>History</button>
                <button onClick={newConversation} className="fos-kbd" style={{ cursor: "pointer", padding: "3px 8px" }}>New</button>
                <button onClick={() => setOpen(false)} aria-label="Close" className="fos-kbd" style={{ cursor: "pointer", padding: "3px 8px" }}>esc</button>
              </div>
            </div>

            {/* History dropdown */}
            {showHistory && (
              <div style={{ borderBottom: "1px solid var(--glass-line)", maxHeight: "40%", overflowY: "auto", background: "var(--overlay)" }}>
                {history.length === 0
                  ? <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--faint)" }}>No earlier conversations.</div>
                  : history.map((c) => (
                    <button key={c.conversation_id} onClick={() => openConversation(c.conversation_id)}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 16px", border: "none", borderBottom: "1px solid var(--hairline)", background: "transparent", cursor: "pointer", color: "var(--ink)", fontSize: 13 }}>
                      <span style={{ fontWeight: 550 }}>{c.title}</span>
                      <span style={{ color: "var(--faint)", fontSize: 11, marginLeft: 8 }}>{new Date(c.last_message_at).toLocaleDateString("en-GB")}</span>
                    </button>
                  ))}
              </div>
            )}

            {/* Thread */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
              {messages.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                  <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, margin: 0 }}>
                    Ask about performance, variance, cash, stores or inventory. I read the same governed figures the dashboards show, cite my sources, and tell you how confident I am. I can draft and recommend — I can’t post, approve, release or send anything.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
                    {STARTERS.map((s) => (
                      <button key={s} onClick={() => send(s)}
                        style={{ textAlign: "left", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 12.5, cursor: "pointer", lineHeight: 1.4 }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => <Message key={i} m={m} />)
              )}
            </div>

            {/* Composer */}
            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--glass-line)" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 12, padding: "8px 10px" }}>
                <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Ask Finance Buddy…" aria-label="Ask Finance Buddy"
                  style={{ flex: 1, resize: "none", maxHeight: 120, background: "transparent", border: "none", outline: "none", color: "var(--ink)", fontSize: 13.5, lineHeight: 1.5, fontFamily: "inherit" }} />
                <button onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send"
                  style={{ flex: "none", width: 34, height: 34, borderRadius: 9, border: "none", cursor: busy || !input.trim() ? "default" : "pointer",
                    background: busy || !input.trim() ? "var(--line)" : "var(--accent)", color: "var(--accent-ink)", fontSize: 16, fontWeight: 700 }}>
                  {busy ? "…" : "↑"}
                </button>
              </div>
              <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 6, textAlign: "center" }}>
                Governed interpretation, not advice. Board / investor material is always a draft for human sign-off.
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
