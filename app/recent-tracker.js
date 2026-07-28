"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { navLabelForPath } from "../lib/nav-registry";
import { pushRecent } from "../lib/recent-rules";

/* Records each page visit into localStorage ("fos-recent") so My Finance Home and
   the sidebar can show "recently viewed". Personal convenience only — never
   leaves the browser. Hubs, planned pages and login are skipped. Renders nothing. */
export default function RecentTracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path === "/login" || path.startsWith("/module/") || path.startsWith("/section/")) return;
    try {
      const cur = JSON.parse(localStorage.getItem("fos-recent") || "[]");
      const next = pushRecent(cur, { href: path, label: navLabelForPath(path) });
      localStorage.setItem("fos-recent", JSON.stringify(next));
      window.dispatchEvent(new Event("fos:recent"));
    } catch {}
  }, [path]);
  return null;
}
