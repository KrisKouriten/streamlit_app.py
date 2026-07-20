import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getHubData } from "../../../lib/hub";
import { money, pct, num, dateLabel } from "../ui";

export const dynamic = "force-dynamic";

/* HOME pillar — the Executive Intelligence Hub. Exception-led: it opens with the
   position, then the single ranked list of what needs a person's attention, then
   the health of the three operating engines (actions, schedule, agents). Every
   figure is tagged real (store feed) or illustrative (awaiting the Xero feed). */

const SOURCE = {
  STORE: { fg: "var(--green)", bg: "var(--green-bg)", label: "Store feed" },
  ILLUSTRATIVE: { fg: "var(--faint)", bg: "var(--line)", label: "Illustrative" },
};

const RED = "#a32d2d", RED_BG = "#f7e6e3";
const SEV = {
  CRITICAL: { fg: RED, bg: RED_BG, label: "Critical" },
  RED: { fg: RED, bg: RED_BG, label: "Action" },
  HIGH: { fg: RED, bg: RED_BG, label: "High" },
  AMBER: { fg: "var(--amber)", bg: "var(--amber-bg)", label: "Watch" },
  MEDIUM: { fg: "var(--amber)", bg: "var(--amber-bg)", label: "Medium" },
  LOW: { fg: "var(--muted)", bg: "var(--line)", label: "Low" },
  INFO: { fg: "var(--muted)", bg: "var(--line)", label: "Info" },
};
const TONE = { green: "var(--green)", amber: "var(--amber)", red: RED };

function heroValue(t) {
  if (t.value === null || t.value === undefined) return "—";
  if (t.unit === "PCT") return pct(t.value);
  if (t.unit === "GBP") return money(t.value, { compact: true });
  return num(t.value);
}

function HeroTile({ t }) {
  const src = SOURCE[t.source];
  return (
    <Link href={t.href} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{t.label}</span>
          <span style={{ fontSize: 9.5, fontWeight: 600, color: src.fg, background: src.bg, padding: "2px 6px", borderRadius: 5, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: ".03em" }}>{src.label}</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: t.tone ? TONE[t.tone] : "var(--ink)" }}>{heroValue(t)}</div>
        <div style={{ fontSize: 11.5, marginTop: 6, color: t.subTone ? TONE[t.subTone] : "var(--faint)" }}>{t.sub}</div>
      </div>
    </Link>
  );
}

function HealthPanel({ title, href, cta, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <Link href={href} style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>{cta} →</Link>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>{children}</div>
    </div>
  );
}

function Line({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tone ? TONE[tone] : "var(--ink)" }}>{value}</span>
    </div>
  );
}

export default async function ExecutiveHub() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { tradingAsAt, financeAsAt, hero, forward, ragCounts, attention, health } = await getHubData();
  const { actions, operations, agents } = health;
  const opsOutstanding = operations.total - operations.complete;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
            <Link href="/finance-os" style={{ textDecoration: "none", color: "var(--faint)" }}>Finance OS</Link> · Home
          </div>
          <div style={{ fontSize: 19, fontWeight: 600 }}>Executive Intelligence Hub</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right", lineHeight: 1.5 }}>
          <div>Trading as at <strong style={{ color: "var(--ink)" }}>{dateLabel(tradingAsAt)}</strong></div>
          <div>Group finance as at {dateLabel(financeAsAt)}</div>
        </div>
      </header>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 22, lineHeight: 1.5 }}>
        Revenue and gross margin are live from the store sales feed. EBITDA, cash, facility headroom and inventory
        are illustrative demo figures pending the Xero and treasury feeds (Phase&nbsp;6).
      </div>

      {/* Hero band */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(158px,1fr))", gap: 10, marginBottom: 24 }}>
        {hero.map((t) => <HeroTile key={t.key} t={t} />)}
      </div>

      {/* Forward view */}
      {forward && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Year to date vs full-year plan</span>
            <Link href="/finance-os/store-sales" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>Store sales →</Link>
          </div>
          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 14 }}>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 3 }}>Net sales YTD</div><div style={{ fontSize: 20, fontWeight: 600 }}>{money(forward.ytdNet, { compact: true })}</div></div>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 3 }}>vs forecast</div><div style={{ fontSize: 20, fontWeight: 600, color: forward.vsForecast >= 0 ? "var(--green)" : RED }}>{forward.vsForecast != null ? `${forward.vsForecast >= 0 ? "+" : ""}${(forward.vsForecast * 100).toFixed(1)}%` : "—"}</div></div>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 3 }}>FY plan</div><div style={{ fontSize: 20, fontWeight: 600 }}>{money(forward.plan, { compact: true })}</div></div>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 3 }}>Projected FY <span style={{ color: "var(--faint)" }}>(run-rate)</span></div><div style={{ fontSize: 20, fontWeight: 600 }}>{money(forward.projectedFy, { compact: true })}</div></div>
          </div>
          {forward.pctOfPlan != null && (
            <div>
              <div style={{ height: 8, background: "var(--line)", borderRadius: 5, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, forward.pctOfPlan * 100).toFixed(1)}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 5 }}>{(forward.pctOfPlan * 100).toFixed(1)}% of full-year plan delivered · projection is a linear run-rate and does not weight H2 seasonality</div>
            </div>
          )}
        </div>
      )}

      {/* Needs attention */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Needs attention</span>
        <span style={{ fontSize: 12.5, color: "var(--faint)" }}>
          {attention.length} item{attention.length === 1 ? "" : "s"} · KPIs {ragCounts.GREEN} on track / {ragCounts.AMBER} watch / {ragCounts.RED} action
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 12 }}>Ranked by severity. Nothing here is auto-actioned — each item is a link to where a person decides.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 30 }}>
        {attention.length === 0 && (
          <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
            Nothing needs attention right now. KPIs are within tolerance, no agent outputs are awaiting sign-off and no actions are overdue.
          </div>
        )}
        {attention.map((a, i) => {
          const s = SEV[a.severity] || SEV.INFO;
          return (
            <Link key={i} href={a.href} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--surface)", border: "1px solid var(--line)", borderLeft: `3px solid ${s.fg}`, borderRadius: "var(--radius)", padding: "11px 14px" }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: s.fg, background: s.bg, padding: "3px 7px", borderRadius: 5, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: ".03em", marginTop: 1, minWidth: 58, textAlign: "center" }}>{s.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{a.headline}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{a.detail}</div>
                </div>
                <span style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap", marginTop: 2 }}>{a.tag}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Operating health */}
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Operating health</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
        <HealthPanel title="Actions & benefits" href="/govern/actions" cta="Action Centre">
          <Line label="Open actions" value={num(actions.open)} tone={actions.open > 0 ? "amber" : "green"} />
          <Line label="Overdue" value={num(actions.overdue)} tone={actions.overdue > 0 ? "red" : "green"} />
          <Line label="Awaiting closure" value={num(actions.awaitingClosure)} tone={actions.awaitingClosure > 0 ? "amber" : undefined} />
          <Line label="Open value" value={money(actions.openValue, { compact: true })} />
        </HealthPanel>

        <HealthPanel title="This week's schedule" href="/perform/schedule" cta="Schedule">
          <Line label="Tasks this week" value={num(operations.total)} />
          <Line label="Complete" value={num(operations.complete)} tone={operations.complete === operations.total && operations.total > 0 ? "green" : undefined} />
          <Line label="Outstanding" value={num(opsOutstanding)} tone={opsOutstanding > 0 ? "amber" : "green"} />
          <Line label="Overdue / blocked" value={num(operations.overdue + operations.blocked)} tone={operations.overdue + operations.blocked > 0 ? "red" : "green"} />
        </HealthPanel>

        <HealthPanel title="AI agents" href="/ai" cta="Control Tower">
          <Line label="Outputs awaiting review" value={num(agents.pendingReviews)} tone={agents.pendingReviews > 0 ? "amber" : "green"} />
          <Line label="Material (need sign-off)" value={num(agents.pendingMaterial)} tone={agents.pendingMaterial > 0 ? "amber" : undefined} />
          <Line label="Open exceptions" value={num(agents.openExceptions)} tone={agents.openExceptions > 0 ? "red" : "green"} />
        </HealthPanel>
      </div>
    </div>
  );
}
