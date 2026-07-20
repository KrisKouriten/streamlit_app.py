export const metadata = {
  title: "Miniso UK Finance OS",
  description: "Miniso UK — The Connected Finance Function",
};

/* Design system v2 — "The Connected Finance Function", executive grade.
   Dark by default (the brand world) with a retained light theme via
   :root[data-theme="light"]. One olive-gold accent (#5d5d23 family) carried
   from the strategy deck; Inter Variable (self-hosted) as the product voice;
   layered elevation, a top key-light, film-grain texture, glass surfaces and
   a calm motion system. Micro-labels are uppercase mono; figures are tabular. */
const css = `
@font-face{font-family:"InterVariable";font-style:normal;font-weight:100 900;font-display:swap;
  src:url(/fonts/InterVariable-latin.woff2) format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}
:root{
  /* dark — default */
  --bg:#0d0c0a; --surface:#151412; --raise:#1c1a16; --overlay:rgba(21,20,18,.72);
  --line:#282520; --line-strong:#3b372e; --hairline:rgba(255,255,255,.055);
  --ink:#f4f2eb; --muted:#a8a398; --faint:#716c60;
  --accent:#d2c775; --accent-deep:#5d5d23; --accent-bg:#27250f; --accent-ink:#16150a;
  --green:#a7c96e; --green-bg:#1e2a10; --amber:#e2a63b; --amber-bg:#32260a;
  --red:#e28d80; --red-bg:#392019;
  --key-light:radial-gradient(1200px 500px at 50% -12%, rgba(210,199,117,.075), transparent 62%);
  --card-top:inset 0 1px 0 rgba(255,255,255,.045);
  --shadow-1:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -18px rgba(0,0,0,.7);
  --shadow-2:0 2px 6px rgba(0,0,0,.4), 0 20px 44px -20px rgba(0,0,0,.75);
  --shadow-pop:0 24px 70px -18px rgba(0,0,0,.8), 0 2px 8px rgba(0,0,0,.5);
  --glass:rgba(23,22,19,.6); --glass-line:rgba(255,255,255,.08);
  --grain-opacity:.028;
  --radius:12px; --radius-lg:16px;
  --ease:cubic-bezier(.22,1,.36,1); --t-fast:.15s; --t-med:.3s; --t-slow:.55s;
  --sans:"InterVariable","Helvetica Neue",Helvetica,"Arial Nova",Arial,system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
:root[data-theme="light"]{
  --bg:#f6f4ee; --surface:#fffefb; --raise:#f2efe6; --overlay:rgba(255,254,251,.78);
  --line:#e6e2d5; --line-strong:#d4cfbf; --hairline:rgba(28,27,23,.07);
  --ink:#1c1b17; --muted:#5e5b52; --faint:#938e81;
  --accent:#6a6a1e; --accent-deep:#5d5d23; --accent-bg:#edeac9; --accent-ink:#fdfcf5;
  --green:#3b6d11; --green-bg:#eef4e3; --amber:#98620a; --amber-bg:#fbf0d9;
  --red:#a32d2d; --red-bg:#f7e6e3;
  --key-light:radial-gradient(1200px 500px at 50% -12%, rgba(106,106,30,.06), transparent 62%);
  --card-top:inset 0 1px 0 rgba(255,255,255,.85);
  --shadow-1:0 1px 2px rgba(60,55,40,.08), 0 10px 28px -20px rgba(60,55,40,.24);
  --shadow-2:0 2px 6px rgba(60,55,40,.09), 0 22px 48px -22px rgba(60,55,40,.3);
  --shadow-pop:0 26px 70px -18px rgba(50,46,34,.35), 0 2px 8px rgba(50,46,34,.12);
  --glass:rgba(255,254,250,.66); --glass-line:rgba(28,27,23,.09);
  --grain-opacity:.02;
}
html{scrollbar-gutter:stable}
html,body{background:var(--bg);color:var(--ink);font-family:var(--sans);
  -webkit-font-smoothing:antialiased;line-height:1.5;letter-spacing:-0.008em}
body{min-height:100vh;background-image:var(--key-light);background-repeat:no-repeat}
body::after{content:"";position:fixed;inset:0;z-index:80;pointer-events:none;opacity:var(--grain-opacity);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
button{font-family:inherit;cursor:pointer}
input,select,textarea{font-family:inherit}
a{color:var(--accent)}
::selection{background:var(--accent-deep);color:#fff}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:8px;border:2px solid var(--bg)}
::-webkit-scrollbar-track{background:transparent}

/* brand device: the uppercase olive-gold eyebrow */
.fos-eyebrow{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent);background:var(--accent-bg);
  border:1px solid var(--accent-deep);padding:4px 9px;border-radius:6px;display:inline-block}

/* layered card — the base unit of every screen */
.fos-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow-1), var(--card-top);
  transition:transform var(--t-fast) var(--ease),box-shadow var(--t-med) var(--ease),border-color var(--t-med) var(--ease)}
a.fos-card{display:block;text-decoration:none;color:inherit}
.fos-card.hover:hover{transform:translateY(-2px);box-shadow:var(--shadow-2), var(--card-top);border-color:var(--line-strong)}
.fos-card.hover:active{transform:translateY(0) scale(.995)}

/* glass surface */
.fos-glass{background:var(--glass);-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);
  border:1px solid var(--glass-line)}

/* controls */
.fos-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 18px;
  border-radius:9px;border:none;font-size:14px;font-weight:600;letter-spacing:-.008em;
  background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 82%,#000 18%));color:var(--accent-ink);
  box-shadow:0 1px 2px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.22);
  transition:filter var(--t-fast) var(--ease),transform var(--t-fast) var(--ease),box-shadow var(--t-med) var(--ease)}
.fos-btn:hover{filter:brightness(1.06)}
.fos-btn:active{transform:scale(.985)}
.fos-btn:disabled{opacity:.55;cursor:default}
.fos-btn-ghost{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:8px;
  background:transparent;border:1px solid var(--line-strong);color:var(--muted);font-size:12.5px;font-weight:500;
  transition:color var(--t-fast) var(--ease),border-color var(--t-fast) var(--ease),background var(--t-fast) var(--ease)}
.fos-btn-ghost:hover{color:var(--ink);border-color:var(--accent-deep);background:var(--accent-bg)}
.fos-input{width:100%;height:42px;padding:0 13px;border:1px solid var(--line-strong);border-radius:9px;
  background:var(--bg);color:var(--ink);font-size:14.5px;
  transition:border-color var(--t-fast) var(--ease),box-shadow var(--t-fast) var(--ease)}
.fos-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.fos-kbd{font-family:var(--mono);font-size:10.5px;color:var(--faint);border:1px solid var(--line-strong);
  border-bottom-width:2px;border-radius:5px;padding:1.5px 5.5px;background:var(--raise)}

/* numerics */
.fos-num{font-variant-numeric:tabular-nums}

/* table hover */
.fos-tbl tbody tr{transition:background var(--t-fast) var(--ease)}
.fos-tbl tbody tr:hover{background:color-mix(in srgb,var(--raise) 55%,transparent)}

/* motion: one-time page rise + staggered children */
@keyframes fosRise{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.fos-page{animation:fosRise var(--t-slow) var(--ease) both}
.fos-stagger>*{animation:fosRise var(--t-slow) var(--ease) both}
.fos-stagger>*:nth-child(1){animation-delay:.02s}.fos-stagger>*:nth-child(2){animation-delay:.06s}
.fos-stagger>*:nth-child(3){animation-delay:.1s}.fos-stagger>*:nth-child(4){animation-delay:.14s}
.fos-stagger>*:nth-child(5){animation-delay:.18s}.fos-stagger>*:nth-child(6){animation-delay:.22s}
.fos-stagger>*:nth-child(7){animation-delay:.26s}.fos-stagger>*:nth-child(n+8){animation-delay:.3s}
@media (prefers-reduced-motion:reduce){
  .fos-page,.fos-stagger>*{animation:none}
  .fos-card,.fos-card.hover:hover{transition:none;transform:none}
}
`;

// Applied before paint so a stored light preference doesn't flash dark. Default is dark.
const themeScript = `(function(){try{var t=localStorage.getItem('fos-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

import { getSession } from "../lib/auth";
import TopNav from "./topnav";
import PageTransition from "./page-transition";
import CommandPalette from "./command-palette";

export default async function RootLayout({ children }) {
  const session = await getSession();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        {session && <TopNav userName={session.name} />}
        {session && <CommandPalette />}
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
