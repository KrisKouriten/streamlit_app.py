/* A deterministic starfield backdrop. Positions are seeded (a small mulberry32
   PRNG) so the server and client render exactly the same stars — no hydration
   mismatch and no Math.random at runtime. Purely decorative (aria-hidden); the
   twinkle is subtle and respects prefers-reduced-motion. Stars are drawn in
   var(--ink) so they adapt to the light/dark theme; a few "bright" ones carry a
   soft accent glow to echo the connected-sphere motif. Works in both server and
   client components (no hooks). */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function Starfield({ count = 120, seed = 20260803, twinkle = true, style }) {
  const rand = mulberry32(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() * 100).toFixed(3);
    const y = (rand() * 100).toFixed(3);
    const size = (0.5 + rand() * 1.9).toFixed(2);
    const op = (0.18 + rand() * 0.62).toFixed(2);
    const delay = (rand() * 6).toFixed(2);
    const dur = (2.6 + rand() * 4.6).toFixed(2);
    const bright = rand() > 0.9;
    stars.push({ x, y, size, op, delay, dur, bright, i });
  }
  const css = `
    @keyframes sf-tw { 0%,100%{opacity:var(--sf-o)} 50%{opacity:calc(var(--sf-o) * 0.28)} }
    @media (prefers-reduced-motion: reduce){ .sf-star{animation:none !important} }
  `;
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", ...style }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {stars.map((s) => (
        <span
          key={s.i}
          className="sf-star"
          style={{
            position: "absolute", left: `${s.x}%`, top: `${s.y}%`,
            width: `${s.size}px`, height: `${s.size}px`, borderRadius: "50%",
            background: "var(--ink)", opacity: Number(s.op),
            boxShadow: s.bright ? "0 0 5px 1px color-mix(in srgb, var(--accent) 65%, transparent)" : "none",
            "--sf-o": s.op,
            animation: twinkle ? `sf-tw ${s.dur}s ease-in-out ${s.delay}s infinite` : "none",
          }}
        />
      ))}
    </div>
  );
}
