"use client";

import { ErrorState } from "./finance-os/ui";

// Route-level error boundary — no raw stack traces, always a way forward.
// "Try again" reloads the page rather than re-rendering in place: a tab opened
// before a release keeps running the old code, so re-rendering repeats the old
// fault, while a reload fetches the fixed version (and fresh data).
export default function Error({ error }) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.25rem" }}>
      <ErrorState
        title="This screen hit a problem"
        detail={error?.message?.includes("42P01") || /does not exist/i.test(error?.message || "")
          ? "A database migration for this module has not been run yet — see the migrations list in the handbook, then refresh."
          : "The error has been logged. Try again — if it persists, check the handbook's troubleshooting runbook."}
        action={<button className="fos-btn-ghost" onClick={() => window.location.reload()}>Try again</button>}
      />
    </div>
  );
}
