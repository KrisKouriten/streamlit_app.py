import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { getProjectDetail } from "../../../../lib/business-projects";
import { PageHeader, EmptyState } from "../../../finance-os/ui";
import ProjectDetailUI from "./detail-ui";

export const dynamic = "force-dynamic";

// Plan — HO · Business Project drill-down: per-department PLANNED costs vs ACTUAL
// P.O spend tagged to the project. Any signed-in user (same as the register).
export default async function BusinessProjectDetail({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const { project, costs, actuals } = await getProjectDetail(id);

  if (!project) {
    return (
      <div className="fos-shell">
        <PageHeader crumb="Plan — HO · Business Projects" title="Project not found" />
        <EmptyState title="Project not found" action={<Link href="/plan/business-projects" className="fos-btn">← Back to Business Projects</Link>}>
          We couldn&rsquo;t find that project. It may have been removed.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan — HO · Business Projects" title={project.name}
        right={<Link href="/plan/business-projects" style={{ fontSize: 12.5, color: "var(--muted)", textDecoration: "none" }}>← All projects</Link>} />
      <ProjectDetailUI project={project} costs={costs} actuals={actuals} />
    </div>
  );
}
