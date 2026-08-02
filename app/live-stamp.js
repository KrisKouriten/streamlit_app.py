"use client";

import { useEffect, useState } from "react";

/*
 * Live "as of now" stamp — the current date & time in the viewer's locale,
 * refreshed each minute. This is deliberately distinct from the data-currency
 * stamps ("Store data to …", "Group finance to …"), which report how fresh the
 * underlying feed is, not the wall clock. Keeping the two separate means a
 * board/deck view can carry a live "generated at" time without ever implying
 * the figures themselves are current to that moment.
 *
 * Renders a placeholder on the server / first paint (the clock only exists in
 * the browser) and fills in on mount, so there is no hydration mismatch.
 */
export default function LiveStamp({ prefix = "As at", withTime = true, style = null }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 30000); // re-render each 30s so the minute never lags
    return () => clearInterval(id);
  }, []);

  const opts = withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" };
  const text = now ? now.toLocaleString("en-GB", opts) : "—";

  return (
    <span suppressHydrationWarning style={style}>
      {prefix ? `${prefix} ` : ""}{text}
    </span>
  );
}
