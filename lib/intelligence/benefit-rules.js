/*
 * Pure helpers for AI benefit realisation (no I/O), so the accuracy maths is
 * unit-testable and shared between the service and the screen.
 */

const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);

/*
 * Summarise a set of AI-originated benefit opportunities into the realisation
 * picture: totals, a status funnel, and the realisation/validation rates that
 * say whether the intelligence layer's recommendations actually pay off.
 *
 * Each row: { status, expected_value_gbp, latest_measured, validated_value,
 *             validation_decision }
 */
export function summariseRealisation(rows = []) {
  const s = {
    count: rows.length,
    funnel: { PROPOSED: 0, IN_DELIVERY: 0, REALISED: 0, VALIDATED: 0, REJECTED: 0 },
    expectedTotal: 0,
    realisedTotal: 0,
    validatedTotal: 0,
  };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(s.funnel, r.status)) s.funnel[r.status] += 1;
    s.expectedTotal += num(r.expected_value_gbp);
    s.realisedTotal += num(r.latest_measured);
    if (r.validation_decision === "VALIDATED") s.validatedTotal += num(r.validated_value);
  }
  // Realisation rate: measured £ against expected £ (0 when nothing expected).
  s.realisationRate = s.expectedTotal > 0 ? s.realisedTotal / s.expectedTotal : 0;
  s.validationRate = s.expectedTotal > 0 ? s.validatedTotal / s.expectedTotal : 0;
  return s;
}
