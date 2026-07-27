import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getIntelligenceBenefits } from "../../../lib/intelligence/benefit";
import { PageHeader, money } from "../ui";
import { CaptureForm, RecordMeasurement } from "./benefit-controls";

export const dynamic = "force-dynamic";

const ORIGIN_LABEL = { BRIEFING: "Briefing", PERSPECTIVE: "Perspective", BUDDY: "Buddy", COMMENTARY: "Commentary" };
const STATUS = {
  PROPOSED: ["Proposed", "var(--muted)", "var(--chip)"], IN_DELIVERY: ["In delivery", "var(--amber)", "var(--amber-bg)"],
  REALISED: ["Realised", "var(--blue, #2b6cb0)", "var(--blue-bg, rgba(43,108,176,.12))"], VALIDATED: ["Validated", "var(--green)", "var(--green-bg)"], REJECTED: ["Rejected", "var(--red)", "var(--red-bg)"],
};

function Pill({ k }) {
  const [label, fg, bg] = STATUS[k] || [k, "var(--muted)", "var(--chip)"];
  return <span style={{ fontSize: 10.5, fontWeight: 600, color: fg, background: bg, padding: "2px 8px", borderRadius: 6 }}>{label}</span>;
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export default async function BenefitRealisation({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const sp = (await searchParams) || {};
  const { opportunities, summary } = await getIntelligenceBenefits();
  const pct = (x) => `${Math.round(x * 100)}%`;

  return (
    <div className="fos-shell">
      <PageHeader crumb="Home · Finance Intelligence" title="Benefit realisation"
        right={summary.count ? `${summary.count} tracked` : "None yet"} />
      <div style={{ fontSize: 12.5, color: "var(--faint)", marginBottom: 16, maxWidth: 720, lineHeight: 1.5 }}>
        Expected vs realised vs validated £ on AI-recommended actions — does the intelligence layer pay off? Expected values are human-set; realised feeds the existing benefit tracker; validation is a finance sign-off on Govern › Benefits.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 20 }}>
        <StatCard label="Expected" value={money(summary.expectedTotal, { compact: true })} sub={`${summary.count} opportunities`} />
        <StatCard label="Realised" value={money(summary.realisedTotal, { compact: true })} sub={`${pct(summary.realisationRate)} of expected`} />
        <StatCard label="Validated" value={money(summary.validatedTotal, { compact: true })} sub={`${pct(summary.validationRate)} of expected`} />
        <StatCard label="Funnel" value={`${summary.funnel.VALIDATED}✓`} sub={`${summary.funnel.PROPOSED} proposed · ${summary.funnel.IN_DELIVERY} in delivery · ${summary.funnel.REALISED} realised`} />
      </div>

      {canManage && <CaptureForm prefill={{ title: sp.title || "", run: sp.run || null, origin: sp.origin || null }} />}

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {!opportunities.length ? (
          <div style={{ padding: "18px", fontSize: 13.5, color: "var(--faint)" }}>
            No AI-originated benefit opportunities yet. {canManage ? "Capture one above, or from a briefing’s recommendations." : "A finance user can capture them."}
            <div style={{ marginTop: 8, fontSize: 12 }}>If capture fails, confirm migration <span style={{ fontFamily: "var(--mono)" }}>043</span> has been run.</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--faint)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ padding: "10px 14px" }}>Opportunity</th>
                <th style={{ padding: "10px 14px" }}>Source</th>
                <th style={{ padding: "10px 14px" }}>Status</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Expected</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Realised</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Validated</th>
                {canManage && <th style={{ padding: "10px 14px" }} />}
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={o.opportunity_id} style={{ borderTop: "1px solid var(--hairline)" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 550 }}>{o.title}</div>
                    {o.category && <div style={{ fontSize: 11, color: "var(--faint)" }}>{o.category}</div>}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>
                    {o.origin_surface ? ORIGIN_LABEL[o.origin_surface] || o.origin_surface : o.source_type === "AI_AGENT" ? "Agent" : "AI"}
                    {o.ai_run_id ? <span style={{ color: "var(--faint)" }}> · run #{o.ai_run_id}</span> : null}
                  </td>
                  <td style={{ padding: "10px 14px" }}><Pill k={o.status} /></td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>{o.expected_value_gbp != null ? money(o.expected_value_gbp) : "—"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>{o.latest_measured != null ? money(o.latest_measured) : "—"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: o.validation_decision === "VALIDATED" ? "var(--green)" : "var(--muted)" }}>
                    {o.validation_decision ? `${money(o.validated_value)}` : "—"}
                  </td>
                  {canManage && (
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      {o.status !== "VALIDATED" && o.status !== "REJECTED"
                        ? <RecordMeasurement opportunityId={o.opportunity_id} suggested={o.latest_measured ?? o.expected_value_gbp} />
                        : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
