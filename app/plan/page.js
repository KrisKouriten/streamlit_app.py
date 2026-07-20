import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Plan() {
  return <PillarHub pillar="PLAN" title="Plan"
    intro="Strategic planning — budgets, forecasts and the long-term financial direction of the business. The plan runs on the Operate forecast inputs; scenario planning flexes them."
    extras={[
      { title: "Scenario planning", href: "/plan/scenarios", purpose: "Upside / base / downside — flex forecast sales, variable rates and fixed costs over the Operate inputs and save shared scenarios.", meta: "Live · on Operate forecast inputs" },
      { title: "Forecast inputs", href: "/operate/forecast", purpose: "The workings the plan is built on — store sales forecasts, variable rates, fixed schedules, head office & franchise.", meta: "Live · maintained under Operate" },
    ]} />;
}
