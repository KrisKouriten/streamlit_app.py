"use client";

import { useEffect, useRef } from "react";

/* A generated Milky Way for the HOME sphere's dark stage. Procedural — a few KB,
   not a photo — and recoloured to the Finance OS gold rather than photographic
   blue: dense stars clustered along a diagonal galactic band with a warm core to
   one side, over the hero box's existing glow (the canvas paints transparently,
   so that gradient shows through). Fills its positioned parent; respects
   prefers-reduced-motion (one static frame); nothing here reads data. */

// weighted star palette — mostly warm white, some gold/amber, a few cool anchors
const COLORS = [
  [244, 242, 235], [244, 242, 235], [244, 242, 235],
  [210, 199, 117], [226, 166, 59], [201, 180, 150], [150, 176, 214],
];
const ANGLE = -16 * Math.PI / 180;

export default function Starfield({ intensity = 0.8 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, DPR = 1, stars = [], band = [], raf = 0, t0 = performance.now();

    const bandDist = (x, y) => {
      const dx = x - W / 2, dy = y - H * 0.5;
      return Math.abs(-Math.sin(ANGLE) * dx + Math.cos(ANGLE) * dy);
    };

    function build() {
      const r = canvas.parentElement.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width * DPR));
      H = Math.max(1, Math.round(r.height * DPR));
      canvas.width = W; canvas.height = H;
      const N = Math.min(760, Math.floor((r.width * r.height) / 1600));
      stars = [];
      for (let i = 0; i < N; i++) {
        let x, y, keep = false, tries = 0;
        do {
          x = Math.random() * W; y = Math.random() * H;
          const d = bandDist(x, y);
          const near = Math.exp(-(d * d) / (2 * (H * 0.26) * (H * 0.26)));
          keep = Math.random() < (0.4 + 0.6 * near); tries++;
        } while (!keep && tries < 3);
        const b = Math.random();
        stars.push({
          x, y,
          r: (b > 0.985 ? 1.9 : b > 0.9 ? 1.2 : 0.55 + Math.random() * 0.5) * DPR,
          base: 0.16 + Math.random() * 0.72, tw: Math.random() * 0.5, ph: Math.random() * 6.28,
          c: COLORS[(Math.random() * COLORS.length) | 0],
        });
      }
      band = [];
      const cx = W / 2, cy = H * 0.5;
      for (let s = -1.1; s <= 1.2; s += 0.16) {
        const bx = cx + Math.cos(ANGLE) * s * W * 0.62;
        const by = cy + Math.sin(ANGLE) * s * W * 0.62;
        const core = Math.max(0, (s + 0.15)) / 1.35;
        band.push({ x: bx, y: by, r: (H * 0.55) * (0.7 + 0.5 * core), a: 0.04 + 0.13 * core, warm: core });
      }
    }

    function frame(now) {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (const b of band) {
        const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        const wr = (180 + b.warm * 60) | 0, wg = (150 + b.warm * 20) | 0, wb = Math.max(70, 110 - b.warm * 40) | 0;
        grd.addColorStop(0, `rgba(${wr},${wg},${wb},${(b.a * intensity).toFixed(3)})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r * 1.5, b.r * 0.55, ANGLE, 0, 6.2832); ctx.fill();
      }
      for (const st of stars) {
        const tw = reduce ? 1 : (1 - st.tw + st.tw * Math.sin(t * 1.3 + st.ph) * 0.5 + st.tw * 0.5);
        const a = Math.min(1, st.base * tw * intensity);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${st.c[0]},${st.c[1]},${st.c[2]},${a.toFixed(3)})`;
        ctx.arc(st.x, st.y, st.r, 0, 6.2832); ctx.fill();
        if (st.r > 1.5 * DPR) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(${st.c[0]},${st.c[1]},${st.c[2]},${(a * 0.26).toFixed(3)})`;
          ctx.arc(st.x, st.y, st.r * 3, 0, 6.2832); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    build();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { build(); if (reduce) frame(performance.now()); });
    ro.observe(canvas.parentElement);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [intensity]);

  return (
    <canvas ref={ref} aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }} />
  );
}
