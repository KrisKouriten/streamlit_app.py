import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Plan() {
  return <PillarHub pillar="PLAN" title="Plan"
    intro="Strategic planning — budgets, forecasts and the long-term financial direction of the business."
    extras={[{ title: "Scenario planning", purpose: "Upside / base / downside planning views.", disabled: true }]} />;
}
