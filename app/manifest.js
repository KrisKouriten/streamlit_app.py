// Web app manifest — lets staff install the Finance OS as a desktop app
// (own window, taskbar/dock icon, no browser chrome). Served at
// /manifest.webmanifest and linked automatically by Next.
export default function manifest() {
  return {
    name: "Miniso UK Finance OS",
    short_name: "Finance OS",
    description: "The Connected Finance Function — Miniso UK",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0c0a",
    theme_color: "#0d0c0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
