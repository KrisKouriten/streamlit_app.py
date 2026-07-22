import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getMfaStatus } from "../../../lib/mfa";
import { PageHeader } from "../../finance-os/ui";
import SecurityUI from "./security-ui";

export const dynamic = "force-dynamic";

// Account → Security: self-service two-step verification for the signed-in user.
export default async function SecurityPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const status = await getMfaStatus(session.id);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Account" title="Security" right={status.enrolled ? "Two-step on" : "Two-step off"} />
      {!status.ready ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          Run migration <span style={{ fontFamily: "var(--mono)" }}>029</span> to enable two-step verification.
        </div>
      ) : (
        <SecurityUI status={status} name={session.name} email={session.email} />
      )}
    </div>
  );
}
