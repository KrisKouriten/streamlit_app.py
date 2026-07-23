import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Govern() {
  return <PillarHub pillar="GOVERN" title="Govern"
    intro="Control of the platform itself — people, definitions, audit trail and data quality."
    extras={[
      { title: "Users & roles", href: "/govern/users", purpose: "Create users, assign roles, reset passwords, deactivate accounts.", meta: "Admin only", roles: ["ADMIN"] },
      { title: "Entities", href: "/govern/entities", purpose: "The legal entities Miniso UK consolidates — add, amend, and see Xero connection status.", meta: "Live · ADMIN/FINANCE" },
      { title: "Action Centre", href: "/govern/actions", purpose: "Every action from every source, with closure approval and evidence.", meta: "Live" },
      { title: "Benefits tracker", href: "/govern/benefits", purpose: "Expected vs realised vs validated value, AI vs human-raised.", meta: "Live" },
      { title: "Handbook (SOP)", href: "/handbook", purpose: "The Finance OS operating manual — roles, the weekly/monthly rhythm, module procedures and controls.", meta: "Live" },
      { title: "KPI dictionary", purpose: "Governed definitions for every KPI, with sign-off history.", disabled: true },
      { title: "Audit trail", purpose: "Who did what, when — every state-changing action.", disabled: true },
    ]} />;
}
