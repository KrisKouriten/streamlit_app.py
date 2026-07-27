import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../../../lib/auth";
import { listTemplates, getTemplate } from "../../../../../lib/reporting/templates";
import { PageHeader, EmptyState } from "../../../ui";
import Wizard from "./wizard";

export const dynamic = "force-dynamic";

export default async function NewReport({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return <div style={{ padding: "1rem 0" }}><PageHeader crumb="New report" title="New report" /><EmptyState title="Access required">Creating reports needs finance or admin access.</EmptyState></div>;
  }
  const sp = await searchParams;
  const { templates } = await listTemplates();
  const selected = sp?.template || templates[0]?.template_key || null;
  const tpl = selected ? await getTemplate(selected) : null;

  return (
    <div style={{ padding: "1rem 0" }}>
      <PageHeader crumb="New report" title="Create a report" right="Step 1 — report details" />
      <Wizard
        templates={templates.map((t) => ({ key: t.template_key, name: t.name, confidentiality: t.default_confidentiality, audience: t.audience }))}
        selected={selected}
        defaults={tpl ? { name: tpl.name, audience: tpl.audience, confidentiality: tpl.default_confidentiality } : null}
        owner={session.email || session.name}
      />
    </div>
  );
}
