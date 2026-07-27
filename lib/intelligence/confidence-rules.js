/*
 * Pure confidence & data-freshness assessment for AI responses (CR §8). The
 * caller passes source metadata + a few flags; this decides the confidence level
 * and the honest caveats. It never labels a working forecast "approved", and it
 * never hides a missing or stale source.
 */

export const CONFIDENCE = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

// Matches the Data Quality agent's tolerance so freshness is judged consistently.
export const DEFAULT_STALE_DAYS = 9;

// Whole days between now (ms) and an ISO timestamp; null-safe.
export function ageDays(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

/*
 * sources: [{ label, dataThrough, approved, missing }]
 * opts:    { nowMs, staleDays, hasUnapprovedForecast, incompletePeriod }
 * → { level, reasons[], staleSources[], missingSources[] }
 */
export function assessConfidence(sources = [], opts = {}) {
  const nowMs = opts.nowMs ?? 0;
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const reasons = [];

  const missingSources = sources.filter((s) => s && s.missing).map((s) => s.label);
  const staleSources = sources
    .filter((s) => s && !s.missing)
    .filter((s) => {
      const age = ageDays(s.dataThrough, nowMs);
      return age != null && age > staleDays;
    })
    .map((s) => s.label);

  let level = CONFIDENCE.HIGH;
  if (missingSources.length) {
    level = CONFIDENCE.LOW;
    reasons.push(`Missing source data: ${missingSources.join(", ")}.`);
  } else if (opts.incompletePeriod) {
    level = CONFIDENCE.LOW;
    reasons.push("The reporting period is incomplete, so this is not a closed result.");
  } else if (opts.hasUnapprovedForecast || staleSources.length) {
    level = CONFIDENCE.MEDIUM;
    if (opts.hasUnapprovedForecast) reasons.push("Uses a working (unapproved) forecast.");
    if (staleSources.length) reasons.push(`Some sources are stale (older than ${staleDays} days): ${staleSources.join(", ")}.`);
  }
  if (level === CONFIDENCE.HIGH) reasons.push("Based on approved, reconciled sources for a complete period.");

  return { level, reasons, staleSources, missingSources };
}
