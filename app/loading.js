import { LoadingSkeleton } from "./finance-os/ui";

// Route-level loading state — shimmer skeleton while server components fetch.
export default function Loading() {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2.2rem 1.25rem" }}>
      <div aria-hidden="true" style={{ height: 12, width: 180, borderRadius: 6, background: "var(--raise)", marginBottom: 12 }} />
      <div aria-hidden="true" style={{ height: 22, width: 300, borderRadius: 7, background: "var(--raise)", marginBottom: 26 }} />
      <LoadingSkeleton rows={6} />
    </div>
  );
}
