import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Operate() {
  return <PillarHub pillar="OPERATE" title="Operate"
    intro="Operational controls — the month-end close and intercompany, at working grain. Specialist analytical views now live under Dashboards."
    extras={[
      { title: "Month-end close", href: "/operate/month-end", purpose: "Per-entity close checklist — status and sign-off across every entity, by period.", meta: "Live · team-entered" },
      { title: "Intercompany", href: "/operate/intercompany", purpose: "Intercompany transactions — bank cash, inventory & recharges, disbursements — with reconciliation status.", meta: "Live · CSV or manual" },
    ]} />;
}
