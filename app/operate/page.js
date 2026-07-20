import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
// Fixed-content hub (pillar=null): no registry cards, so the analytical
// dashboards can never reappear here — they live under DASHBOARDS.
// Month-end close moved to WORKFLOW (the team's cadence).
export default function Operate() {
  return <PillarHub pillar={null} title="Operate"
    intro="Operational controls at working grain. The specialist analytical views live under Dashboards; the month-end close runs on the Workflow tab."
    extras={[
      { title: "Intercompany", href: "/operate/intercompany", purpose: "Intercompany transactions — bank cash, inventory & recharges, disbursements — with reconciliation status.", meta: "Live · CSV or manual" },
    ]} />;
}
