export const metadata = {
  title: "Miniso UK Finance OS",
  description: "Miniso UK Finance Operating System",
};

const css = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#faf9f7; --surface:#ffffff; --line:#e7e4dd; --line-strong:#d8d4ca;
  --ink:#1d1c1a; --muted:#6b6a64; --faint:#9a988f;
  --accent:#1f5fa5; --accent-bg:#e8f0f9;
  --green:#3b6d11; --green-bg:#eef4e3; --amber:#b07208; --amber-bg:#fbf0d9;
  --radius:10px;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#1a1917; --surface:#242220; --line:#36332e; --line-strong:#454139;
    --ink:#f2f0ea; --muted:#a8a59c; --faint:#76746c;
    --accent:#6aa6e8; --accent-bg:#15314e;
    --green:#9fc266; --green-bg:#1f2e10; --amber:#e0a437; --amber-bg:#332608;
  }
}
html,body{background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.5}
button{font-family:inherit;cursor:pointer}
input{font-family:inherit}
a{color:var(--accent)}
`;

import { getSession } from "../lib/auth";
import TopNav from "./topnav";

export default async function RootLayout({ children }) {
  const session = await getSession();
  return (
    <html lang="en">
      <head><style dangerouslySetInnerHTML={{ __html: css }} /></head>
      <body>
        {session && <TopNav userName={session.name} />}
        {children}
      </body>
    </html>
  );
}
