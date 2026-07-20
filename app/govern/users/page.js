import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, isAdmin } from "../../../lib/auth";
import UsersAdmin from "./users-admin";

export const dynamic = "force-dynamic";

export default async function GovernUsers() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdmin(session)) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.25rem" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Admin access required</div>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>
          Users & roles is limited to administrators. If your role has changed recently, sign out and back in.
        </p>
        <p style={{ marginTop: 12 }}><Link href="/govern" style={{ fontSize: 13.5 }}>Back to Govern</Link></p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/govern" style={{ textDecoration: "none", color: "var(--faint)" }}>Govern</Link> · Users & roles
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Users & roles</div>
      </header>
      <UsersAdmin me={{ id: session.id }} />
    </div>
  );
}
