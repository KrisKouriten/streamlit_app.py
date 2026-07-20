"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/* The connected sphere. The control-tower core sits at the centre; the pillars
   orbit it on connective lines. Signals on each node are live from the hub.
   Wide screens get the orbit; narrow screens get an accessible list. A one-time
   reveal draws it in; nothing loops. Nodes are real links, keyboard-navigable. */

const TONE = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", accent: "var(--accent)" };
// six nodes on a hexagon, starting at the top and going clockwise
const ANGLES = [-90, -30, 30, 90, 150, 210];
const R = 40; // orbit radius as % of the square

export default function Orbit({ core, nodes }) {
  const [narrow, setNarrow] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener("change", on);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setShown(true), reduce ? 0 : 60);
    return () => { mq.removeEventListener("change", on); clearTimeout(t); };
  }, []);

  const css = `
    .orb-node{transition:opacity .5s ease,transform .5s ease}
    .orb-node.pre{opacity:0;transform:translate(-50%,-50%) scale(.9)}
    .orb-line{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .9s ease}
    .orb-line.pre{stroke-dashoffset:1}
    @media (prefers-reduced-motion:reduce){.orb-node,.orb-line{transition:none}}
    .orb-pulse{animation:orbpulse 3.4s ease-in-out infinite}
    @keyframes orbpulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.15;transform:scale(1.28)}}
    @media (prefers-reduced-motion:reduce){.orb-pulse{animation:none}}
    .orb-hit .orb-chip{transition:border-color .2s var(--ease),transform .2s var(--ease),box-shadow .3s var(--ease)}
    .orb-hit:hover .orb-chip{border-color:var(--accent);color:var(--ink);transform:translateY(-2px);box-shadow:var(--shadow-2)}
    .orb-hit:hover .orb-dot{transform:scale(1.2)}
  `;

  const CoreInner = (
    <>
      <div className="fos-eyebrow" style={{ borderColor: "var(--accent-deep)" }}>Control tower</div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, marginTop: 9, letterSpacing: "-.03em" }}>{core.attention}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{core.attention === 1 ? "item needs" : "items need"} attention</div>
    </>
  );

  if (narrow) {
    return (
      <div style={{ marginBottom: 30 }}>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <a href="#attention" style={{ display: "block", textDecoration: "none", color: "inherit", background: "var(--surface)", border: "1px solid var(--accent-deep)", borderRadius: "var(--radius)", padding: "16px 18px", marginBottom: 10, textAlign: "center" }}>{CoreInner}</a>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {nodes.map((n) => <NodeCard key={n.key} n={n} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div style={{ position: "relative", width: "min(560px, 92vw)", aspectRatio: "1 / 1", maxHeight: 560 }}>
        {/* connective lines */}
        <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          {ANGLES.map((a, i) => {
            const x = 50 + R * Math.cos((a * Math.PI) / 180);
            const y = 50 + R * Math.sin((a * Math.PI) / 180);
            return <line key={i} className={`orb-line ${shown ? "" : "pre"}`} x1="50" y1="50" x2={x} y2={y}
              stroke="var(--accent-deep)" strokeWidth="0.35" pathLength="1" style={{ transitionDelay: `${i * 70}ms` }} />;
          })}
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--line)" strokeWidth="0.25" strokeDasharray="0.6 1.4" opacity={shown ? 1 : 0} style={{ transition: "opacity .8s ease .3s" }} />
        </svg>

        {/* core */}
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "36%", aspectRatio: "1/1", borderRadius: "50%",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
          background: "radial-gradient(circle at 50% 32%, var(--raise), var(--bg) 78%)", border: "1px solid var(--accent-deep)",
          boxShadow: "0 0 60px color-mix(in srgb, var(--accent) 14%, transparent), var(--shadow-2), inset 0 1px 0 rgba(255,255,255,.06)", zIndex: 3, padding: 8 }}>
          <span className="orb-pulse" style={{ position: "absolute", inset: -1, borderRadius: "50%", border: "1px solid var(--accent)", pointerEvents: "none" }} />
          <a href="#attention" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center" }}>{CoreInner}</a>
        </div>

        {/* orbiting pillar nodes */}
        {nodes.map((n, i) => {
          const a = ANGLES[i % ANGLES.length];
          const left = 50 + R * Math.cos((a * Math.PI) / 180);
          const top = 50 + R * Math.sin((a * Math.PI) / 180);
          return (
            <div key={n.key} className={`orb-node ${shown ? "" : "pre"}`} style={{ position: "absolute", left: `${left}%`, top: `${top}%`, transform: "translate(-50%,-50%)", zIndex: 4, width: 132, transitionDelay: `${120 + i * 70}ms` }}>
              <NodeCard n={n} centered />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NodeCard({ n, centered }) {
  const tone = n.tone ? TONE[n.tone] : "var(--faint)";
  const body = (
    <div className="orb-chip fos-glass" style={{ borderRadius: 11, padding: "10px 12px", textAlign: centered ? "center" : "left", boxShadow: "var(--shadow-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: centered ? "center" : "flex-start" }}>
        <span className="orb-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: n.planned ? "var(--faint)" : tone, flex: "none", transition: "transform .2s" }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--ink)" }}>{n.label}</span>
      </div>
      <div style={{ fontSize: 11, color: n.planned ? "var(--faint)" : "var(--muted)", marginTop: 4 }}>{n.signal}</div>
    </div>
  );
  if (n.planned || !n.href) return <div className="orb-hit" title="Planned — 2027" style={{ opacity: .62 }}>{body}</div>;
  return <Link href={n.href} className="orb-hit" style={{ textDecoration: "none", color: "inherit", display: "block" }}>{body}</Link>;
}
