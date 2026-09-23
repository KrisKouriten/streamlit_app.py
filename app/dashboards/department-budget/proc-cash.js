"use client";
import { useMemo, useState } from "react";
import { money, Table, Badge } from "../../finance-os/ui";
import { SOURCES, monthsWithActivity } from "../../../lib/procurement-rules";

/*
 * Merchandising's cash budget vs committed spend — the Procurement Requests
 * summaries, on the department's own dashboard.
 *
 * The budget holder was reading the month's position on one screen and the
 * department's position on another. Both are shown here, consolidated first:
 * Miniso and Local added together, which is every OTB merch request too, since
 * a request is stored under the source its channel belongs to and so is already
 * counted inside one of them.
 *
 * The arithmetic is not repeated here. Every figure comes from summarise() and
 * consolidateSummary() in lib/procurement-rules.js — the same functions the
 * Procurement Requests page reads — so the two screens cannot disagree. This
 * component only chooses which months to show.
 */

const monthLabel = (ym) => {
  const [y, m] = String(ym || "").split("-");
  const d = new Date(Date.UTC(+y, +m - 1, 1));
  return isNaN(d) ? ym : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};
const dash = <span style={{ color: "var(--faint)" }}>—</span>;
const orDash = (v) => (v ? money(v) : dash);

// What each source put into one figure of a consolidated month, e.g.
// "Miniso purchases £12k · Local purchases £6k". Sources with nothing in that
// figure are left out, so a line never lists a source only to say £0.
function sourceSplit(m, field) {
  const parts = Object.entries(m.bySource || {}).filter(([, v]) => v[field]);
  if (!parts.length) return null;
  return (
    <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3, whiteSpace: "normal", lineHeight: 1.4 }}>
      {parts.map(([k, v]) => `${SOURCES[k] || k} ${money(v[field], { compact: true })}`).join(" · ")}
    </div>
  );
}

// A month row's columns. `split` adds the per-source make-up under the
// consolidated committed and spent figures, so a total can be taken apart in
// place.
function monthColumns({ split = false } = {}) {
  return [
    { label: "Cash-out month", render: (m) => monthLabel(m.ym) },
    {
      label: "Committed", align: "right", render: (m) => (
        <div>
          <div>{money(m.committed)}</div>
          {split && sourceSplit(m, "committed")}
        </div>
      ),
    },
    {
      label: "Spent", align: "right", render: (m) => (
        <div>
          <div>{orDash(m.spent)}</div>
          {split && m.spent ? sourceSplit(m, "spent") : null}
        </div>
      ),
    },
    { label: "Budget", align: "right", render: (m) => (m.budget == null ? dash : money(m.budget)) },
    // The commitment is held at the costing rate and the cash goes out at spot.
    // That gap is valuation, not budget performance, so it is shown on its own
    // and added back into variance rather than read as over-spend.
    { label: "FX", align: "right", render: (m) => (m.fx ? money(m.fx) : dash) },
    {
      label: "Variance", align: "right",
      tone: (m) => (m.variance == null ? undefined : m.variance < 0 ? "red" : "green"),
      render: (m) => (m.variance == null ? "—" : money(m.variance)),
    },
    {
      label: "Status",
      render: (m) => (m.budget == null
        ? <span style={{ fontSize: 12, color: "var(--faint)" }}>no budget</span>
        : <Badge tone={m.overBudget ? "red" : "green"}>{m.overBudget ? "Over" : "Within"}</Badge>),
    },
  ];
}

function Tiles({ s }) {
  const over = (s.months || []).filter((m) => m.overBudget).length;
  return (
    <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 }}>
      {[
        ["Committed spend", money(s.totalCommitted || 0, { compact: true }), "all months", undefined],
        ["Spent", money(s.totalSpent || 0, { compact: true }), "trade + cash settled", undefined],
        ["Cash budget", money(s.totalBudget || 0, { compact: true }), "sum of monthly budgets", undefined],
        ["Over-budget months", String(over), "cash-out basis", over ? "var(--red)" : "var(--green)"],
        ["Suppliers", String((s.suppliers || []).length), "with orders", undefined],
      ].map(([label, value, sub, tone]) => (
        <div key={label} className="fos-card" style={{ padding: "13px 15px 12px" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>{label}</div>
          <div className="fos-num" style={{ fontSize: 23, fontWeight: 650, lineHeight: 1, letterSpacing: "-.025em", color: tone || "var(--ink)" }}>{value}</div>
          <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6 }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// One titled block: heading, note, and the month table under the shared filter.
function MonthBlock({ title, note, s, allMonths, split = false }) {
  const months = useMemo(() => (allMonths ? (s.months || []) : monthsWithActivity(s.months)), [s, allMonths]);
  const total = (s.months || []).length;
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 650, letterSpacing: "-.015em" }}>{title}</div>
        {note && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {note}</span>}
      </div>
      {!allMonths && total > months.length && (
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 9 }}>
          Showing {months.length} of {total} months — the rest carry a budget but no committed orders or spend yet.
        </div>
      )}
      <Table columns={monthColumns({ split })} rows={months} empty="No purchases or budgets for this source yet." />
    </section>
  );
}

export default function ProcCash({ procCash }) {
  const con = procCash?.consolidated;
  const bySource = procCash?.bySource || {};
  // The filter opens on the months that have something in them, the same way
  // Procurement Requests does — a budget horizon is mostly rows of dashes.
  const [allMonths, setAllMonths] = useState(false);
  const totalMonths = con?.months?.length || 0;
  const liveMonths = useMemo(() => monthsWithActivity(con?.months).length, [con]);
  if (!con) return null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "8px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Cash budget vs committed</div>
        {(totalMonths > liveMonths || allMonths) && (
          <button className="fos-btn-ghost" type="button" onClick={() => setAllMonths((x) => !x)}>
            {allMonths ? "Months with activity" : `All months (${totalMonths})`}
          </button>
        )}
      </div>

      <Tiles s={con} />

      <MonthBlock
        title="All procurement — consolidated"
        note="Miniso + Local, which includes every OTB merch request · budget is the sum of the source budgets"
        s={con} allMonths={allMonths} split
      />

      {con.sources.map((key) => (
        <MonthBlock key={key} title={SOURCES[key] || key}
          note="payment-date basis: committed lands in the month the payment terms make it fall due"
          s={bySource[key]} allMonths={allMonths} />
      ))}

      <div style={{ fontSize: 11.5, color: "var(--faint)", margin: "-8px 0 26px", lineHeight: 1.55 }}>
        Everything here is on a <strong>payment-date basis</strong> — committed lands in the month the entered
        payment terms make it fall due, spend in the month it settled. <strong>Variance</strong> is budget −
        committed − spend + FX, where FX is the difference between holding a commitment at the costing rate and
        settling it at spot. The consolidated row is the sum of the source rows, and its budget the sum of the
        source budgets; <strong>Over</strong> is re-struck from those totals, so a month over in one source and
        under in another reads as it stands overall. Raise, amend and settle on{" "}
        <a href="/operate/procurement" style={{ color: "var(--accent)" }}>Procurement Requests</a>.
      </div>
    </>
  );
}
