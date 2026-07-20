import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getBenefits } from "../../../lib/actions";
import { SubNav, Panel, Table, money } from "../../finance-os/ui";
import { GOVERN_NAV } from "../actions/nav";
import { SOURCE_LABEL, ValidateBenefitControl } from "../actions/action-ui";

export const dynamic = "force-dynamic";

export default async function BenefitsTracker() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canValidate = hasRole(session, "ADMIN", "FINANCE", "EXEC");
  const { opportunities, summary } = await getBenefits();
  const tot = (k) => summary.AI[k] + summary.HUMAN[k];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Govern</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Benefits tracker</div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 6, maxWidth: 640 }}>
          Expected value vs realised vs finance-validated, split by whether the opportunity was AI-raised or human-raised.
        </p>
      </header>
      <SubNav items={GOVERN_NAV} active="/govern/benefits" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 20 }}>
        {[["Expected", tot("expected")], ["Realised", tot("realised")], ["Validated", tot("validated")]].map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>{l} benefit</div>
            <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{money(v, { compact: true })}</div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 5 }}>
              AI {money(summary.AI[l.toLowerCase()], { compact: true })} · Human {money(summary.HUMAN[l.toLowerCase()], { compact: true })}
            </div>
          </div>
        ))}
      </div>

      <Panel title={`Benefit opportunities (${opportunities.length})`} note="realised feeds from action realised-value; validation is a finance sign-off">
        <Table columns={[
          { label: "Opportunity", render: (o) => o.title },
          { label: "Source", render: (o) => SOURCE_LABEL[o.source_type] || o.source_type },
          { label: "Status", render: (o) => o.status },
          { label: "Expected", align: "right", render: (o) => money(o.expected_value_gbp) },
          { label: "Realised", align: "right", render: (o) => (o.latest_measured != null ? money(o.latest_measured) : "—") },
          { label: "Validated", align: "right", tone: (o) => (o.validation_decision === "VALIDATED" ? "green" : o.validation_decision === "DISPUTED" ? "red" : "muted"),
            render: (o) => (o.validation_decision ? `${money(o.validated_value)} (${o.validation_decision})` : "—") },
          { label: "Validate", render: (o) => (canValidate && o.status !== "VALIDATED" && o.status !== "REJECTED"
            ? <ValidateBenefitControl opportunityId={o.opportunity_id} suggested={o.latest_measured ?? o.expected_value_gbp} /> : "—") },
        ]} rows={opportunities} empty="No benefit opportunities yet — they appear when a value-bearing action is raised." />
      </Panel>
    </div>
  );
}
