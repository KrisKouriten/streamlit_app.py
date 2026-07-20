import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function AiControlTower() {
  return <PillarHub pillar="AI" title="AI Control Tower"
    intro="Governed finance AI — every agent registered, every run recorded, every material output reviewed by a person before it counts."
    extras={[
      { title: "Agent Registry", purpose: "Purpose, owner, reviewer, thresholds, permissions and version for every agent.", disabled: true },
      { title: "Run history & review queue", purpose: "Full run records and the human approval workflow for material outputs.", disabled: true },
      { title: "AI benefits tracker", purpose: "Expected vs realised value from agent-originated actions.", disabled: true },
    ]} />;
}
