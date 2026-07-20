import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Perform() {
  return <PillarHub pillar="PERFORM" title="Perform"
    intro="Performance management — how the business is doing against plan, and the finance work that keeps the numbers trustworthy."
    extras={[
      { title: "Month-end close", href: "/", purpose: "Shared close tracker across every entity with who/when stamps and history.", meta: "Live · team-entered" },
      { title: "Weekly Finance Schedule", purpose: "My Finance Week, team schedule, task reviews and completion tracking.", disabled: true },
    ]} />;
}
