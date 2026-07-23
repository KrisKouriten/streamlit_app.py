"use client";

import { usePathname } from "next/navigation";

/* Re-keys the page wrapper on navigation so every screen enters with the same
   calm rise. Pure CSS animation (see .fos-page); reduced-motion turns it off. */
export default function PageTransition({ children }) {
  const path = usePathname();
  return <div key={path} className="fos-page">{children}</div>;
}
