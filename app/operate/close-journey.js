import Link from "next/link";
import { getCloseBoard } from "../../lib/close";

/*
 * The month-end close journey — one strip across the three steps (Month-End Close →
 * Management Accounts Close → Close Cockpit) with live status, so the process reads
 * and navigates as one operation. Server component; degrades to nothing before the
 * feeds are loaded. `active` highlights the current step: "month-end" | "management" | "cockpit".
 */
const TONE = {
  green: { fg: "var(--green)", bg: "var(--green-bg)" },
  amber: { fg: "var(--amber)", bg: "var(--amber-bg)" },
  red: { fg: "var(--red)", bg: "var(--red-bg)" },
  accent: { fg: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  muted: { fg: "var(--faint)", bg: "var(--raise)" },
};

export default async function CloseJourney({ active }) {
  const board = await getCloseBoard(null).catch(() => null);
  if (!board?.ready) return null;
  const s = board.signals || {};
  const plan = board.plan || { blockers: [], locked: false, ready: false };
  const t = s.tasks || {};
  const pc = s.preclose || {};

  const step1 = t.total
    ? (t.open === 0 ? { label: "Complete", tone: "green" } : { label: `${t.done}/${t.total} done`, tone: "amber" })
    : { label: "No tasks", tone: "muted" };
  const step2 = !pc.ready
    ? { label: "Not run", tone: "muted" }
    : (pc.unresolved === 0 ? { label: "Cleared", tone: "green" }
      : { label: `${pc.unresolved} open${pc.unresolvedHigh ? ` · ${pc.unresolvedHigh} high` : ""}`, tone: pc.unresolvedHigh ? "red" : "amber" });
  const step3 = plan.locked
    ? { label: "Locked", tone: "green" }
    : (plan.ready ? { label: "Ready to lock", tone: "accent" } : { label: `${plan.blockers.length} outstanding`, tone: "amber" });

  const steps = [
    { key: "month-end", n: 1, label: "Month-End Close", href: "/operate/month-end", st: step1 },
    { key: "management", n: 2, label: "Management Accounts Close", href: "/operate/management-close", st: step2 },
    { key: "cockpit", n: 3, label: "Close Cockpit", href: "/operate/close", st: step3 },
  ];

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginBottom: 18,
      background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" }}>
        Close · {board.period}
      </div>
      {steps.map((step, i) => {
        const on = step.key === active;
        const tone = TONE[step.st.tone] || TONE.muted;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 200px" }}>
            <Link href={step.href} style={{ textDecoration: "none", flex: 1, display: "block",
              border: `1px solid ${on ? "var(--line-strong)" : "var(--line)"}`, borderRadius: 10,
              background: on ? "var(--raise)" : "transparent", padding: "9px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{step.n}</span>
                <span style={{ fontSize: 12.5, fontWeight: on ? 650 : 550, color: on ? "var(--ink)" : "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{step.label}</span>
              </div>
              <div style={{ fontSize: 11, color: tone.fg, marginTop: 4, paddingLeft: 28 }}>{step.st.label}</div>
            </Link>
            {i < steps.length - 1 && <span style={{ color: "var(--faint)", fontSize: 16, flex: "none" }}>→</span>}
          </div>
        );
      })}
    </div>
  );
}
