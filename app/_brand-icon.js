import { ImageResponse } from "next/og";

// The Finance OS app icon — the olive-gold orbital dot on the brand-dark field,
// rendered to PNG at whatever size the manifest / install flow asks for. Shared
// by the /icon-192.png and /icon-512.png routes. Underscore prefix = not a route.
export function brandIcon(size) {
  const ring = Math.round(size * 0.62);
  const dot = Math.round(size * 0.34);
  const border = Math.max(2, Math.round(size * 0.035));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0c0a",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: ring,
            height: ring,
            borderRadius: "50%",
            border: `${border}px solid #5d5d23`,
          }}
        >
          <div
            style={{
              width: dot,
              height: dot,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #d2c775, #5d5d23)",
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
