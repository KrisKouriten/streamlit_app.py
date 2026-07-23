"use client";

import { useEffect } from "react";

// Registers the service worker so the app is installable to the desktop.
// Renders nothing.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
