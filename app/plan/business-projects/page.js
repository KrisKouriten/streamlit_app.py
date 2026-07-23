import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getBusinessProjects } from "../../../lib/business-projects";
import { summarise } from "../../../lib/business-projects-rules";
import { PageHeader } from "../../finance-os/ui";
import BusinessProjectsUI from "./business-projects-ui";

export const dynamic = "force-dynamic";

// Plan — HO · Business Projects: a register of cross-functional change projects.
export default async function BusinessProjects() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { ready, projects } = await getBusinessProjects();
  const summary = summarise(projects);
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Plan · Head Office" title="Business Projects"
        right={ready ? `${summary.total} projects · ${summary.active} active` : "Awaiting migration"} />
      {!ready ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          Run migration <span style={{ fontFamily: "var(--mono)" }}>026</span> to enable the Business Projects register.
        </div>
      ) : (
        <BusinessProjectsUI projects={projects} summary={summary} />
      )}
    </div>
  );
}
