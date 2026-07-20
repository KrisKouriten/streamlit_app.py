import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Govern() {
  return <PillarHub pillar="GOVERN" title="Govern"
    intro="Control of the platform itself — people, definitions, audit trail and data quality."
    extras={[
      { title: "Users & roles", href: "/govern/users", purpose: "Create users, assign roles, reset passwords, deactivate accounts.", meta: "Admin only", roles: ["ADMIN"] },
      { title: "KPI dictionary", purpose: "Governed definitions for every KPI, with sign-off history.", disabled: true },
      { title: "Audit trail", purpose: "Who did what, when — every state-changing action.", disabled: true },
      { title: "SOPs & controls", purpose: "Standard operating procedures and control executions.", disabled: true },
    ]} />;
}
