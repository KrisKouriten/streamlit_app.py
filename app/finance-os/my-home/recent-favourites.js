"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toggleFavourite, isFavourite } from "../../../lib/recent-rules";

/* Recently viewed + Favourites for My Finance Home. Reads the personal
   localStorage lists the RecentTracker maintains, and lets you ⭐ a page to pin it
   (favourites also surface at the top of the sidebar). Purely local — no server
   state, no governed data. */

function readList(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

export default function RecentFavourites() {
  const [recent, setRecent] = useState([]);
  const [favs, setFavs] = useState([]);

  useEffect(() => {
    const load = () => { setRecent(readList("fos-recent")); setFavs(readList("fos-favourites")); };
    load();
    window.addEventListener("fos:recent", load);
    window.addEventListener("fos:favourites", load);
    window.addEventListener("storage", load);
    return () => { window.removeEventListener("fos:recent", load); window.removeEventListener("fos:favourites", load); window.removeEventListener("storage", load); };
  }, []);

  function star(entry) {
    const next = toggleFavourite(favs, entry);
    try { localStorage.setItem("fos-favourites", JSON.stringify(next)); } catch {}
    setFavs(next);
    window.dispatchEvent(new Event("fos:favourites"));
  }

  const chip = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", textDecoration: "none", color: "var(--muted)" };
  const starBtn = (on) => ({ border: "none", background: "none", cursor: "pointer", fontSize: 12, lineHeight: 1, color: on ? "var(--amber)" : "var(--faint)", padding: 0 });

  if (!recent.length && !favs.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
      {favs.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", flex: "none" }}>Favourites</span>
          {favs.map((e) => (
            <span key={e.href} style={chip}>
              <Link href={e.href} style={{ textDecoration: "none", color: "var(--ink)" }}>{e.label}</Link>
              <button title="Unpin" onClick={() => star(e)} style={starBtn(true)}>★</button>
            </span>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", flex: "none" }}>Recently viewed</span>
          {recent.map((e) => (
            <span key={e.href} style={chip}>
              <Link href={e.href} style={{ textDecoration: "none", color: "var(--muted)" }}>{e.label}</Link>
              <button title={isFavourite(favs, e.href) ? "Unpin" : "Pin to favourites"} onClick={() => star(e)} style={starBtn(isFavourite(favs, e.href))}>{isFavourite(favs, e.href) ? "★" : "☆"}</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
