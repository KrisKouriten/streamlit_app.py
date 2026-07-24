"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../ui";

/* Client UI for the three-statement model: P&L / Balance Sheet / Cash Flow
   tabs, a month selector, and — on the cash flow — the reconciliation line that
   ties the derived movement back to the actual change in cash. */

const TABS = [["pnl", "Profit & Loss"], ["bs", "Balance Sheet"], ["cf", "Cash Flow"]];

function Awaiting({ children }) {
  return <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)", lineHeight: 1.6 }}>{children}</div>;
}

function Row({ label, value, bold, indent, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0",
      borderTop: "1px solid var(--line)", fontSize: 13, fontWeight: bold ? 700 : 450,
      color: tone === "muted" ? "var(--muted)" : "var(--ink)" }}>
      <span style={{ paddingLeft: indent ? 14 : 0 }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(value)}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="fos-card" style={{ padding: "12px 18px", marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function PnlTab({ pnl, ym }) {
  if (!pnl.loaded) return <Awaiting>No consolidated P&L is loaded yet — run the Joiin refresh to populate it.</Awaiting>;
  const col = (mm) => Number(mm?.[ym] || 0);
  return (
    <div>
      {pnl.sections.map((s) => (
        <Section key={s.name} title={s.name}>
          {s.rows.filter((r) => col(r.months)).map((r) => <Row key={r.account} label={r.account} value={col(r.months)} indent />)}
          <Row label={`Total ${s.name}`} value={col(s.total.months)} bold />
        </Section>
      ))}
      <Section title="Result">
        <Row label="Gross profit" value={col(pnl.computed.grossProfit.months)} />
        <Row label="Operating profit" value={col(pnl.computed.operatingProfit.months)} />
        <Row label="Net profit" value={col(pnl.computed.netProfit.months)} bold />
      </Section>
    </div>
  );
}

function BsTab({ bs }) {
  if (!bs.loaded) {
    return (
      <Awaiting>
        <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 6 }}>Balance sheet not loaded yet</div>
        The balance sheet comes straight from Joiin (the connector now supports it). Run migration{" "}
        <span style={{ fontFamily: "var(--mono)" }}>036_joiin_balance_sheet.sql</span> and a Joiin refresh, and the
        as-at balances — and the derived cash flow — appear here.
      </Awaiting>
    );
  }
  const c = bs.check;
  return (
    <div>
      <div className="fos-card" style={{ padding: "10px 16px", marginBottom: 12, fontSize: 12.5,
        color: c.balances ? "var(--green)" : "var(--amber)" }}>
        {c.balances
          ? `Balances: assets ${money(c.assets)} = liabilities + equity ${money(c.liabilities + c.equity)}`
          : `Does not balance by ${money(c.diff)} — assets ${money(c.assets)} vs liabilities + equity ${money(c.liabilities + c.equity)}`}
      </div>
      {bs.sections.map((s) => (
        <Section key={s.name} title={s.name}>
          {s.rows.map((r) => <Row key={r.account} label={r.account} value={r.value} indent />)}
          <Row label={`Total ${s.name}`} value={s.total} bold />
        </Section>
      ))}
    </div>
  );
}

function CfTab({ cf, bsReady }) {
  if (!cf) {
    return (
      <Awaiting>
        The indirect cash flow is derived from the movement between two consecutive month-end balance sheets.
        {bsReady
          ? " Only one month of balance sheet is loaded so far — once a second consecutive month lands, the cash flow appears here."
          : " Load the Joiin balance-sheet feed (migration 036 + refresh) and the cash flow derives automatically."}
      </Awaiting>
    );
  }
  return (
    <div>
      {!cf.hasPnl && (
        <div className="fos-card" style={{ padding: "10px 16px", marginBottom: 12, fontSize: 12.5, color: "var(--amber)" }}>
          No P&L net result found for {cf.period}; operating cash flow excludes it. Load the consolidated P&L for a complete statement.
        </div>
      )}
      <Section title={`Operating activities`}>
        <Row label="Net profit for the period" value={cf.operating.netProfit} />
        {cf.operating.workingCapital.filter((l) => l.cashImpact).map((l) => (
          <Row key={`${l.section}|${l.account}`} label={`Δ ${l.account}`} value={l.cashImpact} indent tone="muted" />
        ))}
        <Row label="Net cash from operating activities" value={cf.operating.total} bold />
      </Section>
      <Section title="Investing activities">
        {cf.investing.lines.filter((l) => l.cashImpact).map((l) => (
          <Row key={`${l.section}|${l.account}`} label={`Δ ${l.account}`} value={l.cashImpact} indent tone="muted" />
        ))}
        <Row label="Net cash from investing activities" value={cf.investing.total} bold />
      </Section>
      <Section title="Financing activities">
        {cf.financing.liabilities.filter((l) => l.cashImpact).map((l) => (
          <Row key={`${l.section}|${l.account}`} label={`Δ ${l.account}`} value={l.cashImpact} indent tone="muted" />
        ))}
        {cf.financing.otherEquityMovement !== 0 && <Row label="Share issues / dividends & other equity" value={cf.financing.otherEquityMovement} indent tone="muted" />}
        <Row label="Net cash from financing activities" value={cf.financing.total} bold />
      </Section>
      <Section title="Reconciliation">
        <Row label="Net movement in cash (derived)" value={cf.netMovement} bold />
        <Row label={`Opening cash (${cf.openingPeriod})`} value={cf.openingCash} tone="muted" />
        <Row label={`Closing cash (${cf.period})`} value={cf.closingCash} tone="muted" />
        <Row label="Actual movement in cash" value={cf.actualMovement} />
        <div style={{ marginTop: 8, fontSize: 12.5, color: cf.reconciles ? "var(--green)" : "var(--amber)" }}>
          {cf.reconciles
            ? "✓ Derived cash flow reconciles to the movement in cash."
            : `Unexplained residual of ${money(cf.residual)} — the balance sheet may not balance, or a line needs re-classifying.`}
        </div>
      </Section>
    </div>
  );
}

export default function ThreeStatementUI({ model }) {
  const router = useRouter();
  const [tab, setTab] = useState("pnl");
  const months = model.months.length ? model.months : (model.pnl.months || []).slice().reverse();

  function changeMonth(e) { router.push(`/finance-os/three-statement?month=${e.target.value}`); }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 4, background: "var(--raise)", borderRadius: 10, padding: 3 }}>
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 8,
                background: tab === key ? "var(--surface)" : "transparent", color: tab === key ? "var(--ink)" : "var(--muted)" }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {model.ym && months.length > 0 && (
          <select value={model.ym} onChange={changeMonth} className="fos-input" style={{ fontSize: 13, fontWeight: 600, padding: "3px 8px", width: "auto" }} aria-label="Month">
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
      </div>

      {tab === "pnl" && <PnlTab pnl={model.pnl} ym={model.ym} />}
      {tab === "bs" && <BsTab bs={model.bs} />}
      {tab === "cf" && <CfTab cf={model.cf} bsReady={model.bsReady} />}

      <div style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.6, marginTop: 8 }}>
        P&L and Balance Sheet are the Joiin consolidation (intercompany eliminated). The Cash Flow is the balance-sheet
        movement re-expressed as an indirect statement and reconciled to the actual change in cash — figures are never invented.
      </div>
    </div>
  );
}
