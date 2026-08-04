"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { money, Badge } from "../../finance-os/ui";

/* Run-rate accrual review — the month-end check on the uploaded provisional
   store P&Ls. Each store × nominal is compared to its trailing same-year
   run-rate; cost lines below run-rate surface as accrual candidates, split by
   type (nothing posted / reversal / under-posted). Read-only + CSV download;
   the month and materiality drive off the URL so the server recomputes. */

const TYPE_LABEL = { COMPLETENESS: "Nothing posted", REVERSAL: "Reversal", DRIFT: "Under-posted" };
const TYPE_TONE = { COMPLETENESS: "red", REVERSAL: "amber", DRIFT: "amber" };
const MATERIALITY_OPTS = [250, 500, 1000];

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AccrualReviewUI({ review, targetMonth, materiality }) {
  const router = useRouter();

  const csvHref = useMemo(() => {
    if (!review?.lines?.length) return null;
    const head = ["Store", "Nominal", "Type", "Run-rate", "Posted", "Accrual", "Months used"];
    const body = review.lines.map((l) => [l.store, l.nominal, TYPE_LABEL[l.type] || l.type, l.runRate, l.posted, l.accrual, l.monthsUsed]);
    const csv = [head, ...body].map((r) => r.map(csvEscape).join(",")).join("\n");
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [review]);

  function nav(next) {
    const p = new URLSearchParams();
    if (next.month || targetMonth) p.set("accrualMonth", next.month ?? targetMonth);
    p.set("materiality", next.materiality ?? materiality);
    router.push(`/operate/management-close?${p.toString()}`);
  }

  if (review?.ready === false) {
    return (
      <Section>
        <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)" }}>
          The store P&L actuals table isn’t loaded yet — run the actuals migration and the review appears here.
        </div>
      </Section>
    );
  }
  if (!review?.loaded) {
    return (
      <Section>
        <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)" }}>
          No provisional store P&Ls loaded yet. Upload them on{" "}
          <span style={{ color: "var(--muted)" }}>Finance data → Data uploads → Management accounts</span>, then the
          run-rate accrual review runs here — one target month against each line’s trailing run-rate.
        </div>
      </Section>
    );
  }

  const t = review.totals;
  const rev = review.revenueMissing;

  return (
    <Section>
      {/* controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
          <span style={ctlLabel}>Target month</span>
          <select value={review.target || ""} onChange={(e) => nav({ month: e.target.value })}
            className="fos-input" style={{ height: 34, fontSize: 13.5, padding: "0 8px", minWidth: 130 }}>
            {review.months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
          <span style={ctlLabel}>Materiality</span>
          <select value={materiality} onChange={(e) => nav({ materiality: e.target.value })}
            className="fos-input" style={{ height: 34, fontSize: 13.5, padding: "0 8px", minWidth: 110 }}>
            {MATERIALITY_OPTS.map((m) => <option key={m} value={m}>{money(m)}</option>)}
          </select>
        </label>
        <div style={{ flex: 1 }} />
        {csvHref && (
          <a className="fos-btn-ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", alignSelf: "flex-end" }}
            href={csvHref} download={`accrual-review-${review.target}.csv`}>Download review (CSV)</a>
        )}
      </div>

      {/* headline tiles */}
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 }}>
        <Tile label="Estimated accrual" value={money(t.totalAccrual, { compact: true })} tone="var(--amber)" sub={`${t.flagged} cost line${t.flagged === 1 ? "" : "s"} flagged`} />
        <Tile label="Run-rate cost" value={money(t.runRateCost, { compact: true })} sub={`vs ${money(t.targetCost, { compact: true })} posted`} />
        <Tile label="Posted this month" value={money(t.targetCost, { compact: true })} sub={review.target} />
        <Tile label="Revenue not posted" value={rev.count} tone={rev.count ? "var(--red)" : "var(--green)"} sub={rev.count ? `${money(rev.runRate, { compact: true })} run-rate — data gap` : "all store sales posted"} />
      </div>

      {/* type split */}
      {review.byType.length > 0 && (
        <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 18 }}>
          {review.byType.map((ty) => (
            <div key={ty.code} className="fos-card" style={{ padding: "13px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Badge tone={ty.tone}>{ty.label}</Badge>
                <span className="fos-num" style={{ fontSize: 11.5, color: "var(--faint)" }}>{ty.n} line{ty.n === 1 ? "" : "s"}</span>
              </div>
              <div className="fos-num" style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-.02em" }}>{money(ty.gap)}</div>
            </div>
          ))}
        </div>
      )}

      {/* top nominals + top stores */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, marginBottom: 18 }}>
        <RankCard title="By nominal" rows={review.byNominal.slice(0, 8)} labelKey="key" />
        <RankCard title="By store" rows={review.byStore.slice(0, 8)} labelKey="key" />
      </div>

      {/* full lines */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 650 }}>Accrual candidates</span>
        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {review.target} vs run-rate of {review.priorMonths.length} prior month{review.priorMonths.length === 1 ? "" : "s"} · gap ≥ {money(review.materiality)}</span>
      </div>
      {review.lines.length === 0 ? (
        <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--green)" }}>
          Every cost line is at or above its run-rate — no accrual needed at this materiality.
        </div>
      ) : (
        <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead><tr>
              {["Store", "Nominal", "Type", "Run-rate", "Posted", "Accrual", "Months"].map((h, i) => (
                <th key={i} style={{ textAlign: i >= 3 ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {review.lines.map((l, i) => {
                const last = i === review.lines.length - 1;
                const bb = last ? "none" : "1px solid var(--hairline)";
                return (
                  <tr key={`${l.store}|${l.nominal}`}>
                    <td style={{ padding: "9px 14px", borderBottom: bb, whiteSpace: "nowrap", fontWeight: 550 }}>{l.store}</td>
                    <td style={{ padding: "9px 14px", borderBottom: bb }}>{l.nominal}</td>
                    <td style={{ padding: "9px 14px", borderBottom: bb, whiteSpace: "nowrap" }}><Badge tone={TYPE_TONE[l.type]}>{TYPE_LABEL[l.type] || l.type}</Badge></td>
                    <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: bb, color: "var(--muted)" }}>{money(l.runRate)}</td>
                    <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: bb, color: "var(--muted)" }}>{money(l.posted)}</td>
                    <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: bb, fontWeight: 600, color: "var(--amber)" }}>{money(l.accrual)}</td>
                    <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: bb, color: "var(--faint)" }}>{l.monthsUsed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

const ctlLabel = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)" };

function Section({ children }) {
  return (
    <section style={{ marginTop: 34 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 13 }}>
        <span style={{ fontSize: 15, fontWeight: 650 }}>Accrual review — store P&L run-rate</span>
        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· provisional store accounts vs trailing run-rate — where to accrue at month-end</span>
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 27, fontWeight: 650, lineHeight: 1, letterSpacing: "-.025em", color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

function RankCard({ title, rows }) {
  const max = rows.reduce((m, r) => Math.max(m, r.gap), 0) || 1;
  return (
    <div className="fos-card" style={{ padding: "15px 17px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 12 }}>{title}</div>
      {rows.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--faint)" }}>—</div> : rows.map((r) => (
        <div key={r.key} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ fontWeight: 540, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "68%" }}>{r.key}</span>
            <span className="fos-num" style={{ color: "var(--muted)" }}>{money(r.gap)} <span style={{ color: "var(--faint)" }}>· {r.n}</span></span>
          </div>
          <div style={{ height: 4, borderRadius: 3, background: "var(--hairline)", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(3, (r.gap / max) * 100)}%`, height: "100%", background: "var(--amber)", borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
