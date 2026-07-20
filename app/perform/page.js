import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Perform() {
  return <PillarHub pillar="PERFORM" title="Perform"
    intro="Performance management — how the business is doing against plan, and the finance work that keeps the numbers trustworthy."
    extras={[
      { title: "Month-end close", href: "/", purpose: "Shared close tracker across every entity with who/when stamps and history.", meta: "Live · team-entered" },
      { title: "My Finance Week", href: "/perform/my-week", purpose: "Your tasks for the week — take, work, submit for review.", meta: "Live" },
      { title: "Finance Team Schedule", href: "/perform/schedule", purpose: "Whole-team view: workload, allocation and week completion.", meta: "Live · managers can generate the week" },
      { title: "Task review queue", href: "/perform/review", purpose: "Approve or return submitted tasks — approval is separate from completion.", meta: "Live" },
      { title: "Task library", href: "/perform/library", purpose: "The recurring templates the week is generated from.", meta: "Live" },
    ]} />;
}
