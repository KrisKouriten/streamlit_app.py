import PillarHub from "../pillar-hub";
export const dynamic = "force-dynamic";
export default function Workflow() {
  // Pillar key "WORKFLOW": no dashboard registers here, so this hub shows only
  // the team-cadence screens regardless of registry state (the old PERFORM key
  // still carries Management Accounts until migration 010 runs in production).
  return <PillarHub pillar="WORKFLOW" title="Workflow"
    intro="The finance team's working cadence — the tasks that keep the numbers trustworthy: who does what this week, review and sign-off, and the templates the week is built from."
    extras={[
      { title: "My Finance Week", href: "/perform/my-week", purpose: "Your tasks for the week — take, work, submit for review.", meta: "Live" },
      { title: "Finance Team Schedule", href: "/perform/schedule", purpose: "Whole-team view: workload, allocation and week completion.", meta: "Live · managers can generate the week" },
      { title: "Task review queue", href: "/perform/review", purpose: "Approve or return submitted tasks — approval is separate from completion.", meta: "Live" },
      { title: "Task library", href: "/perform/library", purpose: "The recurring templates the week is generated from.", meta: "Live" },
    ]} />;
}
