"use client";

import { useEffect, useRef } from "react";

/* The connected sphere — the whole concept as one live object. A slowly rotating
   wireframe globe carries the pillars and data feeds as glowing nodes; streams
   cross the surface between them and are drawn inward to the centre. Pure canvas,
   deterministic layout, additive glow. Reads the app's --accent so it stays
   on-palette; single static frame under prefers-reduced-motion; pauses when the
   tab is hidden. Decorative (aria-hidden); the parent must be position:relative.

   Props:
     labels        show node names (default true)
     glow          draw the warm convergent core glow (default true — the opening page)
     centerValue   a number to set at the centre instead of the glow (the hub's
                   attention count); when set, the glow is suppressed
     centerCaption small caption under centerValue (e.g. "items need attention")
     pillarTones   { PLAN: "green"|"amber"|"red"|"accent"|"faint", … } — live status
                   colour per pillar; omit for all-gold pillars */

function hexToRgb(hex, fallback) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
  if (!m) return fallback;
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

export default function ConnectedSphere({ labels = true, glow = true, centerValue = null, centerCaption = "", pillarTones = null }) {
  const ref = useRef(null);
  const propsRef = useRef({});
  propsRef.current = { labels, glow, centerValue, centerCaption, pillarTones };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The concept-preview palette — a bright, warm gold rendered on a dark stage.
    // (Not the app's muted --accent, which reads dull/grey for the glowing nodes.)
    const GOLD = "231,212,146";
    const GOLD_B = "244,230,172";
    const AMBER = "207,143,74";
    const TONE = { green: "126,200,120", amber: "224,180,80", red: "220,110,90", accent: GOLD_B, faint: "120,116,104" };
    const ADD = "lighter"; // the sphere always sits on a dark stage, so additive glow

    let W = 0, H = 0, cx = 0, cy = 0, R = 0, DPR = 1, raf = 0;
    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H * 0.5; R = Math.min(W, H) * 0.34;
    }
    resize();

    const NODES = [
      { l: "PLAN", t: 0.4, p: 0.9, pillar: true },
      { l: "PERFORM", t: 1.4, p: 1.5, pillar: true },
      { l: "OPERATE", t: 2.5, p: 1.0, pillar: true },
      { l: "GOVERN", t: 3.5, p: 1.95, pillar: true },
      { l: "AI", t: 4.5, p: 1.2, pillar: true },
      { l: "COMMERCIAL", t: 5.6, p: 1.7, pillar: true },
      { l: "STORES", t: 0.9, p: 2.25 },
      { l: "JOIIN", t: 2.0, p: 0.5 },
      { l: "PRICING", t: 3.0, p: 2.4 },
      { l: "OTB", t: 4.0, p: 0.6 },
      { l: "CAPEX", t: 5.0, p: 2.3 },
      { l: "TREASURY", t: 5.9, p: 0.75 },
      { l: "CASHFLOW", t: 1.9, p: 2.65 },
      { l: "FORECAST", t: 3.9, p: 1.35 },
    ];
    const N = NODES.length;
    NODES.forEach((n) => { n.v = [Math.sin(n.p) * Math.cos(n.t), Math.cos(n.p), Math.sin(n.p) * Math.sin(n.t)]; });
    function nodeColor(n) {
      const pt = propsRef.current.pillarTones;
      if (n.pillar && pt && pt[n.l] && TONE[pt[n.l]]) return TONE[pt[n.l]];
      return n.pillar ? GOLD_B : GOLD;
    }

    function slerp(a, b, u) {
      let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      dot = Math.max(-1, Math.min(1, dot));
      const om = Math.acos(dot), so = Math.sin(om);
      if (so < 1e-4) return a.slice();
      const k0 = Math.sin((1 - u) * om) / so, k1 = Math.sin(u * om) / so;
      return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
    }
    let sd = 987654321;
    const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };

    const ARCS = [];
    const seen = new Set();
    for (let i = 0; i < N; i++) {
      for (const off of [3, 6, 8]) {
        const j = (i + off) % N;
        if (i === j) continue;
        const key = i < j ? i + "-" + j : j + "-" + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = NODES[i].v, b = NODES[j].v, pts = [];
        for (let k = 0; k <= 34; k++) pts.push(slerp(a, b, k / 34));
        ARCS.push({ pts, phase: rnd(), speed: 0.10 + rnd() * 0.12, two: rnd() > 0.5 });
      }
    }

    const STARS = [];
    for (let i = 0; i < 360; i++) {
      const r = rnd();
      const col = r < 0.6 ? "247,249,255" : r < 0.82 ? "205,218,255" : r < 0.93 ? GOLD_B : "224,168,214";
      STARS.push({ x: rnd(), y: rnd(), r: 0.5 + rnd() * 1.6, a: 0.5 + rnd() * 0.5, tw: rnd() * 6.283, glow: rnd() > 0.86, col });
    }
    // A stylised edge-on galaxy — the galactic plane seen side-on, a luminous band
    // of stars across the sky with a warm central bulge and a dark dust lane, so the
    // sphere floats above the galaxy's horizon. Stars are held in band-local
    // coordinates (u along the plane, v across it) and concentrated toward the
    // centre; a few are cool and blue. Static — a horizon, not a spinning disc.
    // A Milky-Way region in the style of a long exposure, dialled well back so the
    // sphere stays the hero: a dense fine starfield (mostly white and pale blue,
    // warm near the centre), broad mottled clouds of violet/purple/magenta gas with
    // a warm galactic-centre glow, and irregular dark dust. Stars are held in
    // band-local coordinates (u along the plane, v across it).
    const WHITE = "245,247,255", PALEBLUE = "200,214,255",
          WARM_S = "255,244,224", MAGENTA_S = "224,168,214";
    function bandColor(core) {
      const r = rnd();
      if (core > 0.6 && r < 0.42) return WARM_S;               // warm stars near the centre
      if (r < 0.50) return WHITE;
      if (r < 0.74) return PALEBLUE;
      if (r < 0.86) return GOLD_B;
      if (r < 0.94) return "236,168,96";
      return MAGENTA_S;
    }
    const BAND = [];
    for (let i = 0; i < 1050; i++) {
      const u = rnd() * 2 - 1;                                 // along the plane, -1..1
      const v = (rnd() + rnd() + rnd() - 1.5) * 0.42;          // gaussian across the plane
      const core = Math.exp(-(u * u) * 1.4);                   // brighter toward the centre
      BAND.push({ u, v, b: (0.30 + rnd() * 0.5) * (0.45 + core * 0.7),
        sz: 0.35 + rnd() * (Math.abs(v) < 0.3 ? 1.25 : 0.75), col: bandColor(core) });
    }
    const GAL_ANGLE = -0.13;

    const WIRE = [];
    for (let li = 1; li < 6; li++) {
      const p = (li / 6) * Math.PI, ring = [];
      for (let k = 0; k <= 60; k++) { const t = (k / 60) * Math.PI * 2; ring.push([Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)]); }
      WIRE.push(ring);
    }
    for (let mi = 0; mi < 6; mi++) {
      const t = (mi / 6) * Math.PI * 2, ring = [];
      for (let k = 0; k <= 60; k++) { const p = (k / 60) * Math.PI; ring.push([Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)]); }
      WIRE.push(ring);
    }

    const TILT = -0.42, cosT = Math.cos(TILT), sinT = Math.sin(TILT);
    function project(v, ay) {
      const ca = Math.cos(ay), sa = Math.sin(ay);
      const x = v[0] * ca + v[2] * sa;
      const z = -v[0] * sa + v[2] * ca;
      const y = v[1];
      const y2 = y * cosT - z * sinT;
      const z2 = y * sinT + z * cosT;
      const persp = 1 / (1 - z2 * 0.32);
      return { x: cx + x * R * persp, y: cy - y2 * R * persp, z: z2, s: persp };
    }
    const dA = (z) => 0.12 + (z + 1) * 0.5 * 0.88;

    let start = null;
    function draw(now) {
      const P = propsRef.current;
      if (start == null) start = now;
      const time = (now - start) / 1000;
      const ay = reduce ? 0.6 : time * 0.16;

      ctx.clearRect(0, 0, W, H);

      // Milky-Way backdrop — mottled nebula gas, a warm galactic-centre glow, a
      // dense starfield and irregular dark dust; the sphere sits in front.
      const gca = Math.cos(GAL_ANGLE), gsa = Math.sin(GAL_ANGLE);
      const bx = 0.5 * W, by = 0.46 * H, halfLen = 0.9 * W, thick = 0.30 * H;
      const toScreen = (u, v) => {
        const lx = u * halfLen, ly = v * thick;
        return [bx + lx * gca - ly * gsa, by + lx * gsa + ly * gca];
      };
      ctx.globalCompositeOperation = ADD;
      // Warm galactic-centre glow.
      const [cxg, cyg] = toScreen(0, 0.05);
      const coreGas = ctx.createRadialGradient(cxg, cyg, 0, cxg, cyg, W * 0.4);
      coreGas.addColorStop(0, "rgba(255,246,226,0.56)");
      coreGas.addColorStop(0.28, "rgba(" + GOLD_B + ",0.30)");
      coreGas.addColorStop(1, "rgba(" + AMBER + ",0)");
      ctx.fillStyle = coreGas; ctx.beginPath(); ctx.arc(cxg, cyg, W * 0.4, 0, 6.283); ctx.fill();
      // Dense starfield strung along the plane.
      for (const p of BAND) {
        const [px, py] = toScreen(p.u, p.v);
        ctx.fillStyle = "rgba(" + p.col + "," + (p.b * 1.25) + ")";
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Stars — a gentle twinkle; a few "newborn" ones carry a soft halo.
      for (const st of STARS) {
        const tw = reduce ? 1 : (0.7 + 0.3 * Math.sin(time * 0.8 + st.tw));
        const a = st.a * tw, sx = st.x * W, sy = st.y * H;
        if (st.glow) {
          ctx.globalCompositeOperation = ADD;
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, st.r * 7);
          g.addColorStop(0, "rgba(" + st.col + "," + (a * 0.5) + ")");
          g.addColorStop(1, "rgba(" + st.col + ",0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, st.r * 7, 0, 6.283); ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.beginPath(); ctx.arc(sx, sy, st.r, 0, 6.283);
        ctx.fillStyle = "rgba(" + st.col + "," + a + ")"; ctx.fill();
      }

      ctx.lineWidth = 1;
      for (const ring of WIRE) {
        ctx.beginPath();
        let started = false;
        for (const v of ring) { const q = project(v, ay); if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y); }
        ctx.strokeStyle = "rgba(" + GOLD + ",0.05)"; ctx.stroke();
      }

      ctx.globalCompositeOperation = ADD;
      for (let i = 0; i < N; i++) {
        const q = project(NODES[i].v, ay);
        const g = ctx.createLinearGradient(q.x, q.y, cx, cy);
        g.addColorStop(0, "rgba(" + GOLD + ",0)");
        g.addColorStop(1, "rgba(" + GOLD + "," + (0.09 * dA(q.z)) + ")");
        ctx.strokeStyle = g; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(cx, cy); ctx.stroke();
      }

      for (const arc of ARCS) {
        const proj = arc.pts.map((v) => project(v, ay));
        let za = 0; for (const p of proj) za += p.z; za /= proj.length;
        const al = dA(za);
        ctx.beginPath(); ctx.moveTo(proj[0].x, proj[0].y);
        for (let k = 1; k < proj.length; k++) ctx.lineTo(proj[k].x, proj[k].y);
        ctx.strokeStyle = "rgba(" + GOLD + "," + (0.16 * al) + ")"; ctx.lineWidth = 1; ctx.stroke();
      }

      for (const arc of ARCS) {
        const heads = arc.two ? [0, 0.5] : [0];
        for (const h of heads) {
          const u = (time * arc.speed + arc.phase + h) % 1;
          const idx = u * (arc.pts.length - 1);
          const i0 = Math.floor(idx), f = idx - i0;
          const a = arc.pts[i0], b = arc.pts[Math.min(i0 + 1, arc.pts.length - 1)];
          const v = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
          const q = project(v, ay), al = dA(q.z), rad = 1.7 * q.s;
          const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 5);
          g.addColorStop(0, "rgba(" + AMBER + "," + (0.9 * al) + ")");
          g.addColorStop(1, "rgba(" + AMBER + ",0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, rad * 5, 0, 6.283); ctx.fill();
          ctx.fillStyle = "rgba(" + GOLD_B + "," + al + ")";
          ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, 6.283); ctx.fill();
        }
      }

      for (let i = 0; i < N; i++) {
        const cyc = (time * 0.32 + i * 0.137) % 1;
        const u = 1 - cyc, n = NODES[i];
        const q = project([n.v[0] * u, n.v[1] * u, n.v[2] * u], ay);
        const fade = Math.sin(cyc * Math.PI);
        ctx.fillStyle = "rgba(" + GOLD_B + "," + (0.85 * fade) + ")";
        ctx.beginPath(); ctx.arc(q.x, q.y, 1.5 * q.s * (0.4 + u), 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      const order = NODES.map((n, i) => ({ i, q: project(n.v, ay) })).sort((a, b) => a.q.z - b.q.z);
      for (const o of order) {
        const n = NODES[o.i], q = o.q, al = dA(q.z), c = nodeColor(n);
        const rr = (n.pillar ? 4.3 : 2.6) * q.s;
        ctx.globalCompositeOperation = ADD;
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr * 6);
        g.addColorStop(0, "rgba(" + c + "," + (0.55 * al) + ")");
        g.addColorStop(1, "rgba(" + c + ",0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, rr * 6, 0, 6.283); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(" + c + "," + Math.min(1, al + 0.1) + ")";
        ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, 6.283); ctx.fill();
        if (P.labels && q.z > -0.15) {
          const la = Math.max(0, Math.min(1, (q.z + 0.15) / 0.7));
          ctx.font = (n.pillar ? "600 12px" : "500 10.5px") + " ui-monospace, Menlo, monospace";
          ctx.fillStyle = "rgba(" + (n.pillar ? c : GOLD) + "," + (la * (n.pillar ? 0.95 : 0.62)) + ")";
          ctx.textBaseline = "middle";
          ctx.fillText(n.l, q.x + rr + 5, q.y);
        }
      }

      const pulse = reduce ? 0.5 : (0.5 + 0.5 * Math.sin(time * 1.6));
      if (P.glow && P.centerValue == null) {
        ctx.globalCompositeOperation = ADD;
        const coreR = R * (0.17 + 0.02 * pulse);
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.4);
        cg.addColorStop(0, "rgba(" + GOLD_B + ",0.85)");
        cg.addColorStop(0.22, "rgba(" + GOLD + "," + (0.40 + 0.18 * pulse) + ")");
        cg.addColorStop(0.6, "rgba(" + AMBER + ",0.10)");
        cg.addColorStop(1, "rgba(" + AMBER + ",0)");
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, coreR * 3.4, 0, 6.283); ctx.fill();
        const hotR = coreR * (0.95 + 0.06 * pulse);
        const hot = ctx.createRadialGradient(cx, cy, 0, cx, cy, hotR);
        hot.addColorStop(0, "rgba(255,251,238," + (0.85 + 0.12 * pulse) + ")");
        hot.addColorStop(0.4, "rgba(" + GOLD_B + ",0.7)");
        hot.addColorStop(1, "rgba(" + GOLD + ",0)");
        ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(cx, cy, hotR, 0, 6.283); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      if (P.centerValue != null) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(245,225,150,0.98)";
        ctx.font = "700 " + Math.round(R * 0.30) + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(String(P.centerValue), cx, cy + R * 0.07);
        if (P.centerCaption) {
          ctx.fillStyle = "rgba(200,178,120,0.92)";
          ctx.font = "600 10.5px ui-monospace, Menlo, monospace";
          ctx.fillText(String(P.centerCaption).toUpperCase(), cx, cy + R * 0.19);
        }
        ctx.textAlign = "left";
      }

      if (!reduce) raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    function onVis() {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!reduce && !raf) { start = null; raf = requestAnimationFrame(draw); }
    }
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />;
}
