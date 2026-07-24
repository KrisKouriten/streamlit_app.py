import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { listForUser } from "../../lib/notifications";
import InboxUI from "./inbox-ui";

export const dynamic = "force-dynamic";

// Notifications inbox — "everything that needs you, as it happens". Reads the
// signed-in user's own feed; all interaction (mark read, open) is client-side.
export default async function Inbox() {
  const session = await getSession();
  if (!session) redirect("/login");
  const notifications = await listForUser(session.id);

  return (
    <div className="fos-shell-narrow">
      <div style={{ marginBottom: 18 }}>
        <div className="fos-eyebrow" style={{ margin: 0 }}>Home</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "2px 0 4px" }}>Notifications</h1>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Everything that needs you, as it happens.</div>
      </div>
      <InboxUI initial={notifications} />
    </div>
  );
}
