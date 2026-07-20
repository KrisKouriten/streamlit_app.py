export const metadata = {
  title: "Miniso UK Finance OS",
  description: "Miniso UK — The Connected Finance Function",
};

/* Design system — "The Connected Finance Function".
   Dark by default (the brand world), with a retained light theme via
   :root[data-theme="light"]. One olive-gold accent (#5d5d23 family) carried from
   the strategy deck; a neo-grotesque type voice; warm near-black grounds. */
const css = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  /* dark — default */
  --bg:#121110; --surface:#1b1a17; --raise:#232019; --line:#302d27; --line-strong:#433f36;
  --ink:#f3f1ea; --muted:#a7a298; --faint:#726d63;
  --accent:#c8bd6b; --accent-deep:#5d5d23; --accent-bg:#292711;
  --green:#a4c56a; --green-bg:#202a12; --amber:#e0a437; --amber-bg:#33270a;
  --red:#e28d80; --red-bg:#3a201c;
  --radius:12px;
  --sans:"Helvetica Neue",Helvetica,"Arial Nova",Arial,system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
:root[data-theme="light"]{
  --bg:#f7f5ef; --surface:#ffffff; --raise:#f1eee3; --line:#e6e2d5; --line-strong:#d6d1c1;
  --ink:#1c1b17; --muted:#5f5c53; --faint:#928d80;
  --accent:#6a6a1e; --accent-deep:#5d5d23; --accent-bg:#edeac9;
  --green:#3b6d11; --green-bg:#eef4e3; --amber:#98620a; --amber-bg:#fbf0d9;
  --red:#a32d2d; --red-bg:#f7e6e3;
}
html,body{background:var(--bg);color:var(--ink);font-family:var(--sans);
  -webkit-font-smoothing:antialiased;line-height:1.5;letter-spacing:-0.006em}
body{min-height:100vh}
button{font-family:inherit;cursor:pointer}
input,select,textarea{font-family:inherit}
a{color:var(--accent)}
::selection{background:var(--accent-deep);color:#fff}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* shared brand device: the uppercase olive-gold eyebrow */
.fos-eyebrow{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.12em;
  text-transform:uppercase;color:var(--accent);background:var(--accent-bg);
  border:1px solid var(--accent-deep);padding:4px 9px;border-radius:6px;display:inline-block}
`;

// Applied before paint so a stored light preference doesn't flash dark. Default is dark.
const themeScript = `(function(){try{var t=localStorage.getItem('fos-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

import { getSession } from "../lib/auth";
import TopNav from "./topnav";

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
        {children}
      </body>
    </html>
  );
}
