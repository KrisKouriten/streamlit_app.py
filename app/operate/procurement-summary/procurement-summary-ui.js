"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  displayStatus, PROC_CHALLENGE_REASONS, challengeReasonLabels, PROC_PAYMENT_STATUSES,
  CHALLENGE_REASON_NEEDS_NOTE, challengeNoteError,
  PROC_PAYMENT_METHODS, paymentMethodOf,
  paymentStatusOf, committedAmount, lineValue, procRef, isMerchRequest, financeActionError,
  settlesByLc, lcStatus, lcActionError, LC_BANK_DEFAULT,
  isForeignRow, fxToPL, inventoryCostFx, reportBasis, dcDrawdown, lcDrawdownGbp, lcBalanceGbp, outstandingCommitment, settledCommitment,
} from "../../../lib/procurement-close-rules";
import { requestsVsBudget, BUDGET_CSV_TEMPLATE, shiftBudgetPlan, budgetShiftError, cashOutFor, phasingCheck } from "../../../lib/procurement-rules";
import { grossOf, vatLabel } from "../../../lib/vat-rules";
import { money, StatRow, Stat, Badge } from "../../finance-os/ui";
import MoneyInput from "../../money-input";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
// Original foreign-currency amount, e.g. "$12,700 USD".
const CCY_SYMBOL = { USD: "$", GBP: "£", EUR: "€", CNY: "¥" };
const ccyAmt = (v, ccy) => `${CCY_SYMBOL[ccy] || ""}${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy || ""}`.trim();
// Render any date value safely — never a raw Date object (React can't render one).
// Accepts a 'YYYY-MM-DD' string or a Date; shows UK-style DD/MM/YYYY.
const fmtDate = (v) => {
  if (!v) return "—";
  const s = typeof v === "string" ? v : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
// LCs against a Miniso order are denominated in that order's currency (USD), so
// the LC amounts and the logged-vs-order comparison stay in the order currency
// rather than being mislabelled/compared as GBP.
const curSym = (r) => CCY_SYMBOL[(r && r.currency) || "GBP"] || "£";
const curMoney = (v, r) => {
  const c = (r && r.currency) || "GBP";
  return c !== "GBP" ? `${CCY_SYMBOL[c] || ""}${Math.round(Number(v) || 0).toLocaleString("en-GB")}` : money(v);
};
// The order's own-currency total the LCs should sum to (USD amount for a foreign
// order, else the GBP value).
const orderCurTotal = (r) => (isForeignRow(r) && r.amount_ccy != null ? Number(r.amount_ccy) : Number(r.amount_gbp));
const inputSt = { fontSize: 13, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
// 'YYYY-MM' → "Sep 2026". Falls back to the raw value rather than rendering an
// Invalid Date if a month ever arrives in another shape.
const ymLabel = (ym) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return ym || "—";
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};
const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 650, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const TONE_FG = { muted: "var(--muted)", red: "var(--red)", amber: "var(--amber)", green: "var(--green)", accent: "var(--accent)" };

// The desk splits by what is being bought, so Finance work one book at a time:
// the two cash-tracker sources, the OTB-linked merch requests, and the budgets
// those all measure against. The status filters below apply within the open tab.
const TABS = [
  { key: "MINISO", label: "Miniso purchases", test: (r) => r.source === "MINISO" && !isMerchRequest(r) },
  { key: "LOCAL", label: "Local purchases", test: (r) => r.source === "LOCAL" && !isMerchRequest(r) },
  { key: "MERCH", label: "Merchandising requests", test: (r) => isMerchRequest(r) },
  { key: "BUDGETS", label: "Budgets", test: () => false },
];

const FILTERS = [
  { key: "ATTENTION", label: "Needs Finance", test: (r) => r.finance_status !== "CLOSED" },
  { key: "PENDING", label: "Pending", test: (r) => r.finance_status === "PENDING" },
  { key: "APPROVED", label: "Approved", test: (r) => r.finance_status === "APPROVED" },
  { key: "CHALLENGED", label: "Challenged", test: (r) => r.finance_status === "CHALLENGED" },
  { key: "CLOSED", label: "Closed", test: (r) => r.finance_status === "CLOSED" },
  { key: "ALL", label: "All", test: () => true },
];

const channelCategory = (r) => (r.channel_code ? `${r.channel_code}${r.sku_or_range ? " · " + r.sku_or_range : ""}` : (r.category || "—"));
// LC facility stage: Import loan while goods are in transit, Trade loan once
// they arrive in Miniso UK's possession.
const LOAN_META = { IMPORT: { label: "Import loan", tone: "amber" }, TRADE: { label: "Trade loan", tone: "green" } };

// Month arithmetic on "YYYY-MM" strings (they sort lexically, so comparisons work).
const thisYm = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const ymAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const ymRange = (start, end) => { const out = []; let c = start; for (let i = 0; c <= end && i < 600; i++) { out.push(c); c = ymAdd(c, 1); } return out; };

// Finance-only procurement budgets — the monthly cash budget for Miniso and Local
// purchases, extendable as far ahead as needed. The single source of truth for
// every budget figure on the Procurement Requests tables and the control views.
// It lives on this desk because only Finance reach this page at all.
function BudgetsPanel({ months = {}, onSaved }) {
  const [extraMonths, setExtraMonths] = useState(0);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(null);

  const budgetMap = (src) => {
    const map = {};
    for (const m of months[src] || []) if (m.budget != null) map[m.ym] = m.budget;
    return map;
  };
  const miniso = budgetMap("MINISO");
  const local = budgetMap("LOCAL");
  // Cover every month that already carries a budget or an order, and at least two
  // years out from now, so there is always somewhere to type ahead.
  const dataMonths = [...(months.MINISO || []), ...(months.LOCAL || [])].map((m) => m.ym);
  const now = thisYm();
  const start = [now, ...dataMonths].sort()[0];
  const end = [ymAdd(now, 23 + extraMonths), ...dataMonths].sort().slice(-1)[0];
  const monthList = ymRange(start, end);

  async function save(source, ym, value) {
    setErr(""); setSaving(`${source}:${ym}`);
    try {
      const res = await fetch("/api/procurement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "budget", source, ym, budget: Number(value) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || "Could not save that budget"); return; }
      onSaved?.();
    } catch (e) { setErr(e.message); }
    finally { setSaving(null); }
  }

  const inp = { width: 120, textAlign: "right", height: 28, fontSize: 12.5, padding: "0 7px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" };
  const th = { ...labelSt, textAlign: "left", padding: "0 12px 7px" };
  const thR = { ...th, textAlign: "right" };
  const td = { padding: "7px 12px", borderBottom: "1px solid var(--line)", fontSize: 13 };
  const tdR = { ...td, textAlign: "right" };
  const total = (map) => monthList.reduce((t, ym) => t + (Number(map[ym]) || 0), 0);

  return (
    <>
      <StatRow>
        <Stat label="Miniso budget" value={money(total(miniso), { compact: true })} />
        <Stat label="Local budget" value={money(total(local), { compact: true })} />
        <Stat label="Months shown" value={monthList.length} />
      </StatRow>

      {err && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 3 }}>Procurement budgets</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14, lineHeight: 1.5 }}>
          The monthly cash budget for Miniso and Local purchases, on the same payment-date basis as the committed and spent figures. Type a figure and click away to save. Extend as far ahead as you need.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Month</th><th style={thR}>Miniso budget</th><th style={thR}>Local budget</th>
            </tr></thead>
            <tbody>
              {monthList.map((ym) => (
                <tr key={ym}>
                  <td style={td}>{ymLabel(ym)}</td>
                  {["MINISO", "LOCAL"].map((src) => {
                    const val = (src === "MINISO" ? miniso : local)[ym];
                    return (
                      <td key={src} style={tdR}>
                        <input type="number" defaultValue={val ?? ""} placeholder="—" className="fos-num"
                          disabled={saving === `${src}:${ym}`} style={inp}
                          onBlur={(e) => { if (e.target.value !== String(val ?? "")) save(src, ym, e.target.value || 0); }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setExtraMonths((x) => x + 12)} style={ghost}>+ Add 12 more months</button>
          <BudgetImport onErr={setErr} onDone={onSaved} />
        </div>
      </div>

      <BudgetRephase months={months} onErr={setErr} onDone={onSaved} />
    </>
  );
}

// Slide a whole forecast along the calendar. Built because a forecast whose
// shape is right but whose phasing is out took a hand-written SQL script to
// correct, which nobody could preview and only one person could run.
//
// The preview is the point. It puts the budget as it stands, the budget as the
// shift would leave it, and what each month actually carries side by side, and
// names the months the shift would strand — real commitment or settled spend
// with no budget left to measure it against. Those months read as over on every
// screen, so seeing them before applying is the difference between re-phasing a
// forecast and quietly breaking it.
function BudgetRephase({ months = {}, onErr, onDone }) {
  const [source, setSource] = useState("MINISO");
  const [shift, setShift] = useState(6);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const n = Number(shift);
  const invalid = budgetShiftError(n);
  const plan = useMemo(() => shiftBudgetPlan(months[source] || [], n || 0), [months, source, n]);
  // Measured, not inferred. plan.suggested compares the first budgeted month
  // with the first month anything happens, which one stray early order moves by
  // the whole gap. This scores every shift and reports how much of the mismatch
  // the best one actually removes — which is what says whether re-phasing is
  // even the right tool.
  const phase = useMemo(() => phasingCheck(months[source] || []), [months, source]);
  const rows = plan.rows.filter((r) => r.budgetNow != null || r.budgetAfter != null || r.activity > 0);

  async function apply() {
    if (invalid) return;
    const dir = n > 0 ? "later" : "earlier";
    const warn = plan.stranded.length
      ? `\n\nWARNING: ${plan.stranded.length} month${plan.stranded.length === 1 ? "" : "s"} with activity would be left with no budget (${plan.stranded.map((r) => ymLabel(r.ym)).join(", ")}).`
      : "";
    if (!window.confirm(`Move all ${plan.moved} ${SRC_LABEL[source]} budget months ${Math.abs(n)} month${Math.abs(n) === 1 ? "" : "s"} ${dir}?${warn}\n\nThis can be undone by shifting back the other way.`)) return;
    onErr?.(""); setDone(""); setBusy(true);
    try {
      const res = await fetch("/api/procurement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "budget-shift", source, shift: n }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onErr?.(j.error || "Could not move the budget"); return; }
      setDone(`Moved ${j.months} months — now ${ymLabel(j.now?.from)} to ${ymLabel(j.now?.to)}. Shift by ${-n} to undo.`);
      onDone?.();
    } catch (e) { onErr?.(e.message); }
    finally { setBusy(false); }
  }

  const th = { ...labelSt, textAlign: "left", padding: "0 12px 7px" };
  const thR = { ...th, textAlign: "right" };
  const td = { padding: "7px 12px", borderBottom: "1px solid var(--line)", fontSize: 13 };
  const tdR = { ...td, textAlign: "right", fontFamily: "var(--mono)" };

  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 3 }}>Re-phase a forecast</div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14, lineHeight: 1.5 }}>
        Move every budget month for one source along the calendar, keeping the figures as they are. Nothing is written until you apply, and shifting back by the same number undoes it.
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <Field label="Source">
          <select value={source} onChange={(e) => { setSource(e.target.value); setDone(""); }} style={inputSt}>
            {["MINISO", "LOCAL"].map((s) => <option key={s} value={s}>{SRC_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Shift (months)">
          <input type="number" value={shift} step={1} onChange={(e) => { setShift(e.target.value); setDone(""); }}
            className="fos-num" style={{ ...inputSt, width: 90, textAlign: "right" }} />
        </Field>
        <button onClick={apply} disabled={busy || !!invalid || !plan.moved} style={{ ...btn("var(--accent)"), opacity: busy || invalid || !plan.moved ? 0.5 : 1 }}>
          {busy ? "Moving…" : "Apply shift"}
        </button>
        {phase.ready && phase.best != null && phase.best !== 0 && phase.best !== n && (
          <button onClick={() => { setShift(phase.best); setDone(""); }} style={ghost}>
            Best fit: {phase.best > 0 ? "+" : ""}{phase.best}
          </button>
        )}
      </div>

      {phase.ready && <PhasingVerdict phase={phase} source={source} />}

      {invalid && <div style={{ color: "var(--amber)", fontSize: 12.5, marginBottom: 12 }}>{invalid}</div>}
      {done && <div style={{ color: "var(--green)", fontSize: 12.5, marginBottom: 12 }}>{done}</div>}

      {!plan.moved ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No {SRC_LABEL[source]} budget is set, so there is nothing to move.</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.55 }}>
            {plan.moved} months, {money(plan.total)} in total, moving from {ymLabel(plan.from)}–{ymLabel(plan.to)} to <strong style={{ color: "var(--ink)" }}>{ymLabel(plan.shiftedFrom)}–{ymLabel(plan.shiftedTo)}</strong>.
            {plan.firstActivity && <> Activity starts {ymLabel(plan.firstActivity)}.</>}
          </div>

          {plan.stranded.length > 0 && (
            <div style={{ border: "1px solid var(--amber)", borderRadius: 9, padding: "10px 12px", marginBottom: 12, fontSize: 12.5, lineHeight: 1.55 }}>
              <strong style={{ color: "var(--amber)" }}>This shift goes too far.</strong>{" "}
              {plan.stranded.length} month{plan.stranded.length === 1 ? "" : "s"} carrying {money(plan.strandedActivity)} of commitment and spend would be left with no budget, so {plan.stranded.length === 1 ? "it" : "they"} would read as over.
              {plan.suggested != null && <> A shift of {plan.suggested > 0 ? "+" : ""}{plan.suggested} lands the budget on the first month anything happens.</>}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Month</th>
                <th style={thR}>Budget now</th>
                <th style={thR}>After shift</th>
                <th style={thR}>Committed + spent</th>
                <th style={th}> </th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ym} style={r.stranded ? { background: "color-mix(in srgb, var(--amber) 8%, transparent)" } : undefined}>
                    <td style={td}>{ymLabel(r.ym)}</td>
                    <td style={{ ...tdR, color: "var(--muted)" }}>{r.budgetNow == null ? "—" : money(r.budgetNow)}</td>
                    <td style={{ ...tdR, fontWeight: r.changed ? 650 : 400 }}>{r.budgetAfter == null ? "—" : money(r.budgetAfter)}</td>
                    <td style={tdR}>{r.activity ? money(r.activity) : "—"}</td>
                    <td style={{ ...td, fontSize: 11.5 }}>
                      {r.stranded ? <Badge tone="amber">No budget</Badge> : r.idle ? <span style={{ color: "var(--faint)" }}>no activity</span> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


// Load a whole budget forecast from the spreadsheet Finance already keep, rather
// than keying 50-odd cells by hand. Months across the top, a row per source.
// Upserts, so a file covering part of the horizon tops it up and leaves the rest
// of the forecast alone.
function BudgetImport({ onErr, onDone }) {
  const fileRef = useRef(null);
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    onErr?.(""); setState("Loading\u2026");
    try {
      const csv = await f.text();
      const res = await fetch("/api/procurement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "budget-import", csv }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setState(""); onErr?.(j.error || "Could not read that file"); return; }
      // Say exactly what landed and what didn't — a silent partial load is how a
      // forecast quietly ends up with holes in it.
      setState(`Loaded ${j.loaded} budget${j.loaded === 1 ? "" : "s"}${j.from ? ` (${j.from} to ${j.to})` : ""}${j.errors?.length ? ` \u00b7 ${j.errors.length} skipped` : ""}.`);
      if (j.errors?.length) onErr?.(`Skipped: ${j.errors.slice(0, 4).map((x) => (x.row ? `row ${x.row}: ` : "") + x.reason).join("; ")}${j.errors.length > 4 ? "\u2026" : ""}`);
      onDone?.();
    } catch (x) { setState(""); onErr?.(x.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return (
    <>
      <button style={ghost} onClick={() => fileRef.current?.click()}>Upload forecast (CSV)</button>
      <a style={{ ...ghost, textDecoration: "none" }} href={`data:text/csv;charset=utf-8,${encodeURIComponent(BUDGET_CSV_TEMPLATE)}`} download="procurement-budget-template.csv">Template</a>
      <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Months across the top, a row for Miniso and a row for Local.</span>
      {state && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{state}</span>}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
    </>
  );
}

// Finance control: what the purchases still awaiting a decision would do to the
// budget of the month each falls due in. Here "awaiting" is the finance
// lifecycle — pending or challenged, i.e. not yet approved or closed — which is
// exactly this desk's queue. Shown per source, and only for months that actually
// have something pending.
const AWAITING_FINANCE = (r) => r.finance_status === "PENDING" || r.finance_status === "CHALLENGED";
const SRC_LABEL = { MINISO: "Miniso purchases", LOCAL: "Local purchases" };
function AwaitingVsBudget({ rows = [], budgetMonths = {}, costingRate = null, tab = "MINISO" }) {
  const [all, setAll] = useState(false);
  // A cancelled order commits nothing, so it must not weigh on a budget month.
  // (approval_status is absent on a database before migration 082 — an undefined
  // status simply isn't CANCELLED, so the row still counts, as it did before.)
  // Each row then carries the SAME committed value the budget tables use: the LC
  // balance, not the whole order. The drawn part is reported as spend by
  // Treasury, and this panel was still counting it as committed as well — so the
  // close desk went on showing every Miniso month over after the budget tables
  // had been corrected. Two rollups, one basis.
  const live = rows
    .filter((r) => r.approval_status !== "CANCELLED")
    .map((r) => {
      // A paid Local order is spend on the facility (or gone in cash), not a
      // commitment. Same rule the budget tables use — without it every paid
      // order counted in Committed here and again in Spent.
      const bal = settlesByLc(r) ? lcBalanceGbp(r, costingRate) : settledCommitment(r);
      return bal == null ? r : { ...r, committed_gbp: bal };
    });
  /*
   * The panel follows the open tab: Miniso under Miniso, Local under Local,
   * Merch under Merch. It used to print both sources on every tab, so the table
   * below showed one book while the budget above it showed two.
   *
   * Miniso and Local are scoped by SOURCE, deliberately including any merch
   * requests on that source. They draw on the same budget, and Spent comes from
   * the facility feed by source and cannot be split — so committed and spent
   * stay on one population rather than one merch-only figure sitting beside a
   * source-wide one.
   *
   * The Merch tab is the merch requests themselves. There are none today; when
   * there are, their cash also shows under Miniso or Local, because that is the
   * budget it consumes.
   */
  const forTab = tab === "MERCH" ? live.filter(isMerchRequest) : live;
  const wanted = tab === "MINISO" ? ["MINISO"] : tab === "LOCAL" ? ["LOCAL"] : ["MINISO", "LOCAL"];
  const sections = wanted.map((src) => ({
    src,
    pipeline: requestsVsBudget(forTab.filter((r) => r.source === src), budgetMonths[src] || [], AWAITING_FINANCE, { all }),
  })).filter((s) => s.pipeline.length);
  if (!sections.length) return null;
  const th = { ...labelSt, textAlign: "left", padding: "0 12px 7px" };
  const thR = { ...th, textAlign: "right" };
  const td = { padding: "9px 12px", borderBottom: "1px solid var(--line)", fontSize: 13 };
  const tdR = { ...td, textAlign: "right", fontFamily: "var(--mono)" };
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 3 }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>Awaiting your decision vs budget</div>
        <button style={{ ...ghost, marginLeft: "auto" }} onClick={() => setAll((x) => !x)}>
          {all ? "Show exceptions only" : "Show all months"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14, lineHeight: 1.5 }}>
        What the purchases still pending or challenged would commit against each month&rsquo;s procurement budget, if they were all approved.{" "}
        {all
          ? <>Showing every month with a budget or activity.</>
          : <>Showing months with something awaiting a decision, plus any month already over on what is committed or spent.</>}{" "}
        Budgets are set on the <strong>Budgets</strong> tab above.
        <div style={{ marginTop: 6 }}>
          Every purchase is counted once: <strong>Awaiting</strong> is still to be decided, <strong>Committed</strong> has been approved or closed, and <strong>Would commit</strong> is the two added together — what the month becomes if the whole queue is approved. <strong>Open to buy</strong> is what the month has left to spend — budget &minus; committed &minus; spent + FX — and <strong>If approved</strong> takes the awaiting value off as well. FX is there because a commitment is held at the rate stock is costed at while the cash goes out at spot; that difference is a valuation movement, not budget over-spend, so it does not count against the month.
        </div>
      </div>
      {sections.map(({ src, pipeline }) => (
        <div key={src} style={{ marginBottom: 14 }}>
          {sections.length > 1 && <div style={{ ...labelSt, marginBottom: 7 }}>{SRC_LABEL[src]}</div>}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Cash-out month</th><th style={thR}>Awaiting</th><th style={thR}>Value</th>
              <th style={thR}>Committed</th><th style={thR}>Spent</th>
              <th style={thR}>Would commit</th><th style={thR}>Budget</th><th style={thR}>FX</th>
              <th style={thR}>Open to buy</th><th style={thR}>If approved</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
            </tr></thead>
            <tbody>
              {pipeline.map((m) => (
                <tr key={m.ym}>
                  <td style={td}>{ymLabel(m.ym)}</td>
                  <td style={tdR}>{m.awaitingCount || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                  <td style={tdR}>{m.awaiting ? money(m.awaiting) : <span style={{ color: "var(--faint)" }}>—</span>}</td>
                  <td style={tdR}>{m.committed ? money(m.committed) : <span style={{ color: "var(--faint)" }}>—</span>}</td>
                  <td style={tdR}>
                    {m.spent ? money(m.spent) : <span style={{ color: "var(--faint)" }}>—</span>}
                    {/* What the figure is made of. Miniso stock settles two ways —
                        a loan against a letter of credit, or the same stock on
                        TradePay — so "spent" is two instruments added together,
                        which one number cannot show. */}
                    {m.spent > 0 && Object.keys(m.spentByDriver || {}).length > 1 && (
                      <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4, fontFamily: "var(--sans)", whiteSpace: "normal", lineHeight: 1.4 }}>
                        {Object.entries(m.spentByDriver)
                          .sort((a, b) => b[1] - a[1])
                          .map(([k, v]) => `${k} ${money(v, { compact: true })}`)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td style={tdR}>{money(m.wouldCommit)}</td>
                  <td style={tdR}>{m.noBudget ? <span style={{ color: "var(--faint)" }}>—</span> : money(m.budget)}</td>
                  {/* The valuation difference inside Committed — stock costed at
                      one rate, cash settled at another. Named here because Open
                      to buy adds it back, and a figure that moves the headroom
                      should be visible rather than described in the note. */}
                  <td style={{ ...tdR, color: m.fx ? "var(--muted)" : undefined }}>
                    {m.fx ? money(m.fx) : <span style={{ color: "var(--faint)" }}>—</span>}
                  </td>
                  <td style={{ ...tdR, color: m.noBudget ? undefined : m.over ? "var(--red)" : "var(--green)" }}>
                    {m.noBudget ? "—" : `${m.headroom < 0 ? "−" : ""}${money(Math.abs(m.headroom))}`}
                  </td>
                  <td style={{ ...tdR, color: m.noBudget ? undefined : m.headroomIfApproved < 0 ? "var(--red)" : "var(--green)" }}>
                    {m.noBudget ? "—" : `${m.headroomIfApproved < 0 ? "−" : ""}${money(Math.abs(m.headroomIfApproved))}`}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {m.noBudget
                      ? <span style={{ color: "var(--faint)", fontSize: 12 }}>no budget</span>
                      : <Badge tone={m.over ? "red" : m.wouldGoOver ? "amber" : "green"}>
                          {m.over ? "Over" : m.wouldGoOver ? "Would go over" : "Within"}
                        </Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function ProcurementSummaryUI({ initialRows = [], costingRate = null, budgetMonths = {} }) {
  const router = useRouter();
  const [tab, setTab] = useState("MINISO");
  const [filter, setFilter] = useState("ATTENTION");
  const [inv, setInv] = useState(() => {
    const m = {};
    for (const r of initialRows) m[r.purchase_id] = { number: r.invoice_number || "", amount: r.invoice_amount != null ? String(r.invoice_amount) : "" };
    return m;
  });
  const [challengeFor, setChallengeFor] = useState(null);
  const [chReasons, setChReasons] = useState(() => new Set());
  const [chNote, setChNote] = useState("");
  const [lcFor, setLcFor] = useState(null);
  const [reconLc, setReconLc] = useState(null); // { lc_id, lc_settled_date, lc_settled_amount }
  const [editLc, setEditLc] = useState(null);   // { lc_id, ...editable LC fields }
  const [lcForm, setLcForm] = useState(() => {
    const m = {};
    // The "Add LC" form starts blank; the bank defaults to the request's bank.
    for (const r of initialRows) m[r.purchase_id] = {
      dc_reference: "", lc_reference: "", lc_amount: "", lc_bank: r.lc_bank || LC_BANK_DEFAULT, lc_confirmed_date: "", lc_payment_date: "",
    };
    return m;
  });
  const [dcForm, setDcForm] = useState({});   // per-purchase "add DC" form { dc_reference, dc_value }
  const [editDc, setEditDc] = useState(null); // { dc_id, dc_reference, dc_value }
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(null);

  // Everything in the open tab, before the status filter — the basis for both the
  // rows shown and the filter counts, so the counts describe this book only.
  const inTab = useMemo(() => {
    const t = TABS.find((x) => x.key === tab);
    return t ? initialRows.filter(t.test) : [];
  }, [initialRows, tab]);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[FILTERS.length - 1];
    return inTab.filter((r) => f.test(r));
  }, [inTab, filter]);

  const counts = useMemo(() => {
    const c = {};
    for (const f of FILTERS) c[f.key] = inTab.filter(f.test).length;
    return c;
  }, [inTab]);

  // Tab badges count what still needs Finance, which is what the desk is for.
  const tabCounts = useMemo(() => {
    const c = {};
    for (const t of TABS) c[t.key] = initialRows.filter((r) => t.test(r) && r.finance_status !== "CLOSED").length;
    return c;
  }, [initialRows]);

  const stats = useMemo(() => {
    let pending = 0, approved = 0, challenged = 0, closed = 0, committed = 0;
    for (const r of initialRows) {
      if (r.finance_status === "PENDING") pending++;
      else if (r.finance_status === "APPROVED") approved++;
      else if (r.finance_status === "CHALLENGED") challenged++;
      else if (r.finance_status === "CLOSED") { closed++; committed += committedAmount(r); }
    }
    return { pending, approved, challenged, closed, committed };
  }, [initialRows]);

  // "Other" is the catch-all reason, so it carries no meaning without the note.
  const chNeedsNote = chReasons.has(CHALLENGE_REASON_NEEDS_NOTE);
  const chNoteErr = challengeNoteError([...chReasons], chNote);

  const setInvField = (id, k, v) => setInv((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  async function op(id, body, successMsg) {
    setBusy(id); setError(null); setMessage(null);
    try {
      const res = await fetch("/api/procurement/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Action failed"); return; }
      setMessage(successMsg);
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const saveInvoice = (r) => op(r.purchase_id, { op: "set-invoice", invoice_number: inv[r.purchase_id]?.number || null, invoice_amount: inv[r.purchase_id]?.amount || null }, "Invoice saved.");
  const setPayment = (r, payment_status) => op(r.purchase_id, { op: "set-payment-status", payment_status }, `Marked ${paymentStatusOf({ payment_status }).label.toLowerCase()}.`);
  // How a paid purchase settled — Cash or Trade pay. Trade pay is reported as
  // spend from the facility upload; cash is reported on top of it.
  const setPaymentMethod = (r, payment_method) => op(
    r.purchase_id,
    // The drawing reference rides with the method: switching to cash clears it,
    // because a stale reference would reconcile against a drawing that paid for
    // something else.
    { op: "set-payment-status", payment_status: r.payment_status, payment_method, trade_pay_ref: payment_method === "TRADE_PAY" ? r.trade_pay_ref : null },
    payment_method ? `Paid via ${(paymentMethodOf({ payment_method })?.label || payment_method).toLowerCase()}.` : "Payment method cleared.",
  );
  // Which drawing a trade-pay row settled on — the bank's own reference, WC… on
  // TradePay. Saved as typed and matched loosely against the facility: not found
  // is flagged, never refused, because the extract is uploaded periodically.
  const setTradePayRef = (r, trade_pay_ref) => op(
    r.purchase_id,
    { op: "set-payment-status", payment_status: r.payment_status, payment_method: r.payment_method, trade_pay_ref },
    trade_pay_ref ? `Trade-pay reference saved.` : "Trade-pay reference cleared.",
  );
  const closeRow = (r) => {
    if (!window.confirm(`Close ${procRef(r)}? It will be reported as committed procurement spend.`)) return;
    op(r.purchase_id, { op: "close", invoice_number: inv[r.purchase_id]?.number || null, invoice_amount: inv[r.purchase_id]?.amount || null }, "Closed — now committed spend.");
  };
  const approve = (r) => op(r.purchase_id, { op: "approve" }, "Approved.");
  const reopen = (r) => op(r.purchase_id, { op: "reopen-finance" }, "Re-opened.");
  const setReportBasis = (r, basis) => op(r.purchase_id, { op: "set-report-basis", basis }, `Reporting on ${basis === "HEDGED" ? "hedged" : "spot"} rate.`);

  function openChallenge(r) {
    setChallengeFor(r.purchase_id);
    const existing = challengeReasonLabels(r.challenge_reasons);
    const codes = PROC_CHALLENGE_REASONS.filter((x) => existing.includes(x.label)).map((x) => x.code);
    setChReasons(new Set(codes));
    setChNote(r.challenge_note || "");
  }
  function toggleReason(code, on) {
    setChReasons((cur) => { const n = new Set(cur); if (on) n.add(code); else n.delete(code); return n; });
  }
  async function submitChallenge(r) {
    await op(r.purchase_id, { op: "challenge", reasons: [...chReasons], note: chNote || null }, "Challenge raised.");
    setChallengeFor(null); setChReasons(new Set()); setChNote("");
  }

  const setLcField = (id, k, v) => setLcForm((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  function openLc(r) { setLcFor((cur) => (cur === r.purchase_id ? null : r.purchase_id)); }
  // Add one LC to the request — multiple are allowed against a Miniso request.
  async function addLcRow(r) {
    const f = lcForm[r.purchase_id] || {};
    await op(r.purchase_id, {
      op: "add-lc", dc_reference: f.dc_reference || null, lc_reference: f.lc_reference || null, lc_amount: f.lc_amount || null,
      lc_bank: f.lc_bank || LC_BANK_DEFAULT, lc_confirmed_date: f.lc_confirmed_date || null, lc_payment_date: f.lc_payment_date || null,
    }, "LC logged.");
    // clear the add form for the next one
    setLcForm((s) => ({ ...s, [r.purchase_id]: { ...s[r.purchase_id], dc_reference: "", lc_reference: "", lc_amount: "", lc_confirmed_date: "", lc_payment_date: "" } }));
  }
  async function reconcileEntry(r) {
    if (!reconLc) return;
    await op(r.purchase_id, { op: "reconcile-lc-entry", lc_id: reconLc.lc_id, lc_settled_date: reconLc.lc_settled_date || null, lc_settled_amount: reconLc.lc_settled_amount || null }, "LC reconciled — settled.");
    setReconLc(null);
  }
  async function deleteLcRow(r, lc) {
    if (!window.confirm(`Delete LC ${lc.lc_reference}? This cannot be undone.`)) return;
    await op(r.purchase_id, { op: "delete-lc", lc_id: lc.lc_id }, "LC removed.");
  }
  function openEditLc(lc) {
    setReconLc(null);
    setEditLc(editLc?.lc_id === lc.lc_id ? null : {
      lc_id: lc.lc_id, dc_reference: lc.dc_reference || "", lc_reference: lc.lc_reference || "", lc_amount: lc.lc_amount != null ? String(lc.lc_amount) : "",
      lc_bank: lc.lc_bank || LC_BANK_DEFAULT, lc_confirmed_date: lc.lc_confirmed_date || "", lc_payment_date: lc.lc_payment_date || "",
      actual_payment_date: lc.actual_payment_date || "", loan_type: lc.loan_type || "IMPORT", goods_arrived_date: lc.goods_arrived_date || "",
    });
  }
  const editField = (k, v) => setEditLc((s) => ({ ...s, [k]: v }));
  async function saveEditLc(r) {
    const f = editLc;
    await op(r.purchase_id, {
      op: "update-lc", lc_id: f.lc_id, dc_reference: f.dc_reference, lc_reference: f.lc_reference, lc_amount: f.lc_amount || null,
      lc_bank: f.lc_bank, lc_confirmed_date: f.lc_confirmed_date || null, lc_payment_date: f.lc_payment_date || null,
      actual_payment_date: f.actual_payment_date || null, loan_type: f.loan_type, goods_arrived_date: f.goods_arrived_date || null,
    }, "LC updated.");
    setEditLc(null);
  }

  // ---- Documentary Credits (the DC value each request's LCs draw against) ----
  const setDcField = (id, k, v) => setDcForm((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  async function addDcRow(r) {
    const f = dcForm[r.purchase_id] || {};
    if (!(f.dc_reference || "").trim()) return;
    await op(r.purchase_id, { op: "add-dc", dc_reference: f.dc_reference, dc_value: f.dc_value || null, expected_payment_date: f.expected_payment_date || null }, "DC added.");
    setDcForm((s) => ({ ...s, [r.purchase_id]: { dc_reference: "", dc_value: "", expected_payment_date: "" } }));
  }
  function openEditDc(dc) {
    setEditDc(editDc?.dc_id === dc.dc_id ? null : { dc_id: dc.dc_id, dc_reference: dc.dc_reference || "", dc_value: dc.dc_value != null ? String(dc.dc_value) : "", expected_payment_date: (dc.expected_payment_date || "").slice(0, 7) });
  }
  const editDcField = (k, v) => setEditDc((s) => ({ ...s, [k]: v }));
  async function saveEditDc(r) {
    const f = editDc;
    await op(r.purchase_id, { op: "update-dc", dc_id: f.dc_id, dc_reference: f.dc_reference, dc_value: f.dc_value || null, expected_payment_date: f.expected_payment_date || null }, "DC updated.");
    setEditDc(null);
  }
  async function deleteDcRow(r, dc) {
    if (!window.confirm(`Delete DC ${dc.dc_reference}? Its LCs stay logged but become ungrouped until re-assigned.`)) return;
    await op(r.purchase_id, { op: "delete-dc", dc_id: dc.dc_id }, "DC removed.");
  }

  function download() {
    // The export keeps Invoice no / net — they are still the record of what
    // Finance keyed, even though the screen now shows them only where they are
    // entered. Payment month rides alongside, on the cash-out basis.
    const head = ["Reference", "Source", "Supplier", "Channel / Category", "Net value", "Gross value", "VAT basis", "Currency", "Amount (ccy)", "Cost rate", "Report basis", "Reported £", "Inventory (£ cost FX)", "Stock rate", "FX to P&L", "Payment month", "Finance status", "Payment status", "Invoice no", "Invoice net"];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const r of rows) {
      const sv = inventoryCostFx(r, costingRate), v = fxToPL(r);
      lines.push([
        procRef(r), r.source, r.supplier, channelCategory(r), lineValue(r), grossOf(r, r.invoice_amount != null ? "invoice_amount" : "amount_gbp"), vatLabel(r),
        r.currency || "GBP", isForeignRow(r) && r.amount_ccy != null ? r.amount_ccy : "", r.cost_rate_type || "",
        reportBasis(r), r.report_gbp != null ? r.report_gbp : "",
        sv != null ? sv : "", r.stock_rate_type || "", v != null ? v : "",
        cashOutFor(r) || "",
        r.finance_status, r.payment_status, r.invoice_number || "", r.invoice_amount != null ? r.invoice_amount : "",
      ].map(esc).join(","));
    }
    const csv = lines.join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `procurement-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const isBudgets = tab === "BUDGETS";

  return (
    <div>
      {/* ---- Book tabs: which purchases (or the budgets they measure against) ---- */}
      <div style={{ display: "inline-flex", gap: 3, marginBottom: 20, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "6px 14px", borderRadius: 7, cursor: "pointer",
              background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
              boxShadow: on ? "var(--shadow-1)" : "none", color: on ? "var(--ink)" : "var(--muted)",
            }}>
              {t.label}
              {t.key !== "BUDGETS" && tabCounts[t.key] > 0 && (
                <span style={{ color: "var(--faint)", fontWeight: 500 }}> {tabCounts[t.key]}</span>
              )}
            </button>
          );
        })}
      </div>

      {isBudgets ? (
        <BudgetsPanel months={budgetMonths} onSaved={() => router.refresh()} />
      ) : (
      <>
      {/* ---- Stats ---- */}
      <StatRow>
        <Stat label="Pending approval" value={stats.pending} />
        <Stat label="Approved / open" value={stats.approved} />
        <Stat label="Under challenge" value={stats.challenged} tone={stats.challenged > 0 ? "red" : undefined} />
        <Stat label="Closed" value={stats.closed} />
        <Stat label="Committed £" value={money(stats.committed, { compact: true })} />
      </StatRow>

      {/* ---- Budget pressure from the queue below ---- */}
      <AwaitingVsBudget rows={initialRows} budgetMonths={budgetMonths} costingRate={costingRate} tab={tab} />

      {/* ---- Messages ---- */}
      {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: "var(--green)", fontSize: 12.5, marginBottom: 12 }}>{message}</div>}

      {/* ---- Controls ---- */}
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{
                fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
                color: on ? "var(--ink)" : "var(--muted)",
              }}>{f.label} <span style={{ color: "var(--faint)", fontWeight: 500 }}>{counts[f.key]}</span></button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{rows.length} row{rows.length === 1 ? "" : "s"}</span>
          <button style={ghost} disabled={rows.length === 0} onClick={download}>Download (CSV)</button>
        </div>
      </div>

      {/* ---- Table ---- */}
      <div style={card}>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No procurement purchases in this view.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1080 }}>
              <thead><tr>
                {["Reference", "Source", "Type", "Supplier", "Channel / Category", "Net", "Gross", "Inventory (£ cost FX)", "Payment month", "Status", "Payment", "Drawn / settled", "Still committed", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const id = r.purchase_id;
                  const st = displayStatus(r);
                  const pay = paymentStatusOf(r);
                  const isBusy = busy === id;
                  const fs = r.finance_status;
                  return (
                    <FragmentRow key={id}>
                      <tr>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>{procRef(r)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{r.source}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{isMerchRequest(r) ? "Merch request" : "Cash purchase"}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{r.supplier}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{channelCategory(r)}</td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {money(lineValue(r))}
                          {isForeignRow(r) && r.amount_ccy != null && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>{ccyAmt(r.amount_ccy, r.currency)}{r.cost_rate_type ? ` @ ${r.cost_rate_type.toLowerCase()}` : ""}</div>}
                          {fs === "CLOSED" && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>Committed {money(committedAmount(r))}</div>}
                        </td>
                        {/* Net is what Merch entered; GROSS is what leaves the
                            bank and what the budget is charged. Both are shown
                            because a request read as £1,000 hitting a budget as
                            £1,200 has to say why here, not in a variance. */}
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {money(grossOf(r, r.invoice_amount != null ? "invoice_amount" : "amount_gbp"))}
                          <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>{vatLabel(r)}</div>
                        </td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {(() => {
                            const inv = inventoryCostFx(r, costingRate);
                            if (inv == null) return <span style={{ color: "var(--faint)" }}>—</span>;
                            const v = fxToPL(r);
                            return (
                              <>
                                {money(inv)}
                                {isForeignRow(r) && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>{r.amount_ccy != null ? `${ccyAmt(r.amount_ccy, r.currency)} ` : ""}at costing FX</div>}
                                {v != null && <div style={{ fontSize: 10.5, marginTop: 2, color: v >= 0 ? "var(--green)" : "var(--red)" }}>FX to P&amp;L {v >= 0 ? "+" : ""}{money(v)}</div>}
                              </>
                            );
                          })()}
                        </td>
                        {/* The month the cash actually leaves — the same basis the
                            budgets and the facility due dates run on, so a line here
                            can be traced to the month it lands in above. Miniso runs
                            180 days from pickup, Local 180 on the facility, everything
                            else order month-end + terms. */}
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          {(() => {
                            const ym = cashOutFor(r);
                            if (!ym) return <span style={{ color: "var(--faint)" }}>—</span>;
                            return (
                              <>
                                {ymLabel(ym)}
                                <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
                                  {r.source === "MINISO"
                                    ? (r.pickup_date ? `pickup ${fmtDate(r.pickup_date)} + 180d` : "no pickup date yet")
                                    : r.source === "LOCAL" ? "facility 180d"
                                    : `${Number(r.terms_days) || 0}d terms`}
                                </div>
                              </>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {fs === "CHALLENGED" && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4, maxWidth: 190, whiteSpace: "normal", lineHeight: 1.4 }}>{challengeReasonLabels(r.challenge_reasons).join(" · ")}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          {settlesByLc(r) ? (() => { const lc = lcStatus(r); return <Badge tone={lc.tone}>{lc.label}</Badge>; })() : <Badge tone={pay.tone}>{pay.label}</Badge>}
                        </td>
                        {/* What has been drawn as an LC, and what is therefore still
                            committed. The drawn part is reported as spent by Treasury
                            from the facility upload, so leaving it in committed too
                            counted the same money twice. Struck at the costing rate,
                            the same basis as the Inventory column. */}
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {(() => {
                            const oc = outstandingCommitment(r, costingRate);
                            if (settlesByLc(r) && oc.drawn == null) return <span style={{ color: "var(--amber)", fontSize: 11.5 }}>no costing rate</span>;
                            if (!oc.drawn) return <span style={{ color: "var(--faint)" }}>—</span>;
                            const lcs = (r.lcs || []).length;
                            return (
                              <>
                                {money(oc.drawn)}
                                <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
                                  {settlesByLc(r)
                                    ? `${lcs} LC${lcs === 1 ? "" : "s"} · spent via Treasury`
                                    : r.payment_method === "CASH" ? "cash"
                                    : r.payment_method === "TRADE_PAY" ? (r.trade_pay?.ref || "trade pay")
                                    : "paid"}
                                </div>
                              </>
                            );
                          })()}
                        </td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {(() => {
                            // A settled row commits nothing — cash has gone, and a
                            // trade-pay drawing is already reported as spend from
                            // the facility, so committing it again would charge the
                            // month twice for the same money.
                            const oc = outstandingCommitment(r, costingRate);
                            if (oc.balance == null) return <span style={{ color: "var(--faint)" }}>—</span>;
                            const TONE = { red: "var(--red)", green: "var(--green)", amber: "var(--amber)" };
                            return (
                              <>
                                <span style={{ color: TONE[oc.tone], fontWeight: 600 }}>{money(oc.balance)}</span>
                                {oc.note && <div style={{ fontSize: 10.5, color: TONE[oc.tone] || "var(--faint)", marginTop: 4 }}>{oc.note}</div>}
                              </>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {fs === "PENDING" && financeActionError("approve", r) === null && (
                              <button style={btn("var(--green)")} disabled={isBusy} onClick={() => approve(r)}>Approve</button>
                            )}
                            {fs === "APPROVED" && settlesByLc(r) && (
                              <button style={btn("var(--accent)")} disabled={isBusy} onClick={() => openLc(r)}>{r.lc_reference ? "Manage LC" : "Log LC"}</button>
                            )}
                            {fs === "APPROVED" && !settlesByLc(r) && (
                              <>
                                <input style={{ ...inputSt, width: 110 }} placeholder="Invoice no" value={inv[id]?.number || ""} onChange={(e) => setInvField(id, "number", e.target.value)} />
                                <MoneyInput style={{ ...inputSt, width: 100, textAlign: "right" }} placeholder="Invoice net" value={inv[id]?.amount || ""} onChange={(e) => setInvField(id, "amount", e.target.value)} />
                                {financeActionError("invoice", r) === null && <button style={ghost} disabled={isBusy} onClick={() => saveInvoice(r)}>Save invoice</button>}
                                {financeActionError("payment", r) === null && (
                                  <>
                                    <select style={{ ...inputSt, width: 110, color: TONE_FG[pay.tone] }} value={pay.code} disabled={isBusy} onChange={(e) => setPayment(r, e.target.value)}>
                                      {PROC_PAYMENT_STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                                    </select>
                                    {r.payment_status === "PAID" && (
                                      <select style={{ ...inputSt, width: 118 }} value={r.payment_method || ""} disabled={isBusy}
                                        title="How this was paid — trade pay is reported as spend from the facility upload; cash is reported on top of it"
                                        onChange={(e) => setPaymentMethod(r, e.target.value)}>
                                        <option value="">Paid via…</option>
                                        {PROC_PAYMENT_METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                                      </select>
                                    )}
                                    {/* Which drawing it settled on. Only on trade pay —
                                        cash has no drawing to reconcile to. */}
                                    {r.payment_status === "PAID" && r.payment_method === "TRADE_PAY" && (
                                      <TradePayRef row={r} busy={isBusy} onSave={(v) => setTradePayRef(r, v)} />
                                    )}
                                  </>
                                )}
                              </>
                            )}
                            {fs === "CHALLENGED" && settlesByLc(r) && (
                              <button style={btn("var(--accent)")} disabled={isBusy} onClick={() => openLc(r)}>{r.lc_reference ? "Manage LC" : "Log LC"}</button>
                            )}
                            {(fs === "CHALLENGED") && financeActionError("reopen", r) === null && <button style={ghost} disabled={isBusy} onClick={() => reopen(r)}>Re-open</button>}
                            {financeActionError("close", r) === null && <button style={btn("var(--green)")} disabled={isBusy} onClick={() => closeRow(r)}>Close</button>}
                            {financeActionError("challenge", r) === null && <button style={btn("var(--red)")} disabled={isBusy} onClick={() => openChallenge(r)}>Challenge</button>}
                            {fs === "CLOSED" && financeActionError("reopen", r) === null && (
                              <button style={ghost} disabled={isBusy} onClick={() => reopen(r)}>Re-open</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {lcFor === id && settlesByLc(r) && (
                        <tr>
                          <td colSpan={12} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            {(() => {
                              const lcs = r.lcs || [];
                              const totalLogged = lcs.reduce((s, l) => s + (Number(l.lc_amount) || 0), 0);
                              return (
                              <>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 650 }}>Letters of Credit — {procRef(r)}</span>
                              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {lcs.length} LC{lcs.length === 1 ? "" : "s"} · {curMoney(totalLogged, r)} logged of {curMoney(orderCurTotal(r), r)}{totalLogged > orderCurTotal(r) + 0.5 ? " — over order net" : ""}{isForeignRow(r) ? ` ${r.currency}` : ""}</span>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 12, lineHeight: 1.5 }}>
                              Miniso HQ inventory settles by {r.lc_bank || LC_BANK_DEFAULT} LC — one request can be split across several LC applications. Log each LC, then reconcile it once it settles. The request is marked paid once every LC has settled.
                            </div>

                            {/* Reporting basis — which FX rate the reported GBP uses on the Procurement / Merchandising views. */}
                            {isForeignRow(r) && (() => {
                              const basis = reportBasis(r);
                              return (
                                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 9 }}>
                                  <span style={labelSt}>Reporting basis</span>
                                  <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 9 }}>
                                    {["SPOT", "HEDGED"].map((b) => {
                                      const on = basis === b;
                                      return (
                                        <button key={b} disabled={isBusy || on} onClick={() => setReportBasis(r, b)} style={{
                                          fontSize: 12, fontWeight: on ? 650 : 500, padding: "5px 14px", borderRadius: 7, cursor: on ? "default" : "pointer",
                                          background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
                                          color: on ? "var(--ink)" : "var(--muted)",
                                        }}>{b === "SPOT" ? "Spot rate" : "Hedged rate"}</button>
                                      );
                                    })}
                                  </div>
                                  <span style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.5, flex: "1 1 240px", minWidth: 200 }}>
                                    {r.amount_ccy != null ? `${ccyAmt(r.amount_ccy, r.currency)} reported as ` : "Reported as "}
                                    <strong style={{ color: "var(--ink)" }}>{r.report_gbp != null ? money(r.report_gbp) : "—"}</strong>
                                    {" "}at the {basis === "HEDGED" ? "hedged" : "spot"} rate on the Procurement request &amp; Merchandising dashboards. This does not change the recorded cash cost or the costing-FX stock valuation.
                                  </span>
                                </div>
                              );
                            })()}

                            {/* Documentary Credits — value drawn vs balance remaining */}
                            {(() => {
                              const groups = dcDrawdown(r.dcs || [], lcs);
                              const dcRow = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", marginBottom: 6 };
                              return (
                                <div style={{ marginBottom: 14 }}>
                                  <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 8 }}>Documentary Credits <span style={{ color: "var(--faint)", fontWeight: 500 }}>· group each LC under its DC</span></div>
                                  {!(r.dcs || []).length && <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 8, lineHeight: 1.5 }}>No DC recorded yet. Add a DC (its reference + value) below, then group each LC under it.</div>}
                                  {groups.map((g) => {
                                    if (g.ungrouped) return (
                                      <div key="ungrouped" style={{ ...dcRow, borderStyle: "dashed" }}>
                                        <span style={{ fontWeight: 600, fontSize: 12.5 }}>Ungrouped LCs</span>
                                        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{g.count} LC{g.count === 1 ? "" : "s"} · {curMoney(g.used, r)} not assigned to a DC</span>
                                      </div>
                                    );
                                    const editing = editDc?.dc_id === g.dc_id;
                                    return (
                                      <div key={g.dc_id} style={{ marginBottom: 6 }}>
                                        <div style={dcRow}>
                                          <span style={{ fontWeight: 650, fontSize: 12.5, minWidth: 130 }}>{g.dc_reference}</span>
                                          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{g.count} LC{g.count === 1 ? "" : "s"}</span>
                                          <span style={{ fontSize: 12 }}><span style={labelSt}>DC value </span>{g.dc_value != null ? curMoney(g.dc_value, r) : "—"}</span>
                                          <span style={{ fontSize: 12 }}><span style={labelSt}>Logged </span>{curMoney(g.used, r)}</span>
                                          {g.dc_value != null && (
                                            <span style={{ fontSize: 12, color: g.over ? "var(--red)" : "var(--muted)" }}>
                                              <span style={labelSt}>{g.over ? "Over by " : "Remaining "}</span>{curMoney(Math.abs(g.remaining), r)}
                                            </span>
                                          )}
                                          {/* The open balance is credit agreed but not yet drawn as an LC — a firm
                                              commitment with no LC, and so no date, of its own. Its expected month is
                                              what places it against a budget. */}
                                          {!!g.openBalance && (
                                            <span style={{ fontSize: 12, color: g.openNeedsMonth ? "var(--amber)" : "var(--muted)" }}>
                                              <span style={labelSt}>Open, expected </span>
                                              {g.openMonth ? ymLabel(g.openMonth) : "month not set"}
                                            </span>
                                          )}
                                          <span style={{ flex: 1 }} />
                                          {r.finance_status !== "CLOSED" && <button style={ghost} disabled={isBusy} onClick={() => openEditDc(g)}>Edit</button>}
                                          {r.finance_status !== "CLOSED" && <button style={ghost} disabled={isBusy} onClick={() => deleteDcRow(r, g)}>Delete</button>}
                                        </div>
                                        {editing && (
                                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", padding: "8px 12px", background: "var(--raise)", borderRadius: 8, marginBottom: 8 }}>
                                            <Field label="DC reference"><input style={{ ...inputSt, width: 180 }} value={editDc.dc_reference} onChange={(e) => editDcField("dc_reference", e.target.value)} /></Field>
                                            <Field label={`DC value (${curSym(r)})`}><MoneyInput style={{ ...inputSt, width: 140, textAlign: "right" }} value={editDc.dc_value} onChange={(e) => editDcField("dc_value", e.target.value)} /></Field>
                                            <Field label="Expected payment month"><input type="month" style={{ ...inputSt, width: 150 }} value={editDc.expected_payment_date || ""} onChange={(e) => editDcField("expected_payment_date", e.target.value)} /></Field>
                                            <button style={btn("var(--accent)")} disabled={isBusy || !(editDc.dc_reference || "").trim()} onClick={() => saveEditDc(r)}>Save</button>
                                            <button style={ghost} onClick={() => setEditDc(null)}>Cancel</button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {r.finance_status !== "CLOSED" && (
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
                                      <Field label="Add DC reference"><input style={{ ...inputSt, width: 180 }} placeholder="e.g. DC UK1233788" value={dcForm[id]?.dc_reference || ""} onChange={(e) => setDcField(id, "dc_reference", e.target.value)} /></Field>
                                      <Field label={`DC value (${curSym(r)})`}><MoneyInput style={{ ...inputSt, width: 140, textAlign: "right" }} placeholder="0.00" value={dcForm[id]?.dc_value || ""} onChange={(e) => setDcField(id, "dc_value", e.target.value)} /></Field>
                                      <Field label="Expected payment month"><input type="month" style={{ ...inputSt, width: 150 }} value={dcForm[id]?.expected_payment_date || ""} onChange={(e) => setDcField(id, "expected_payment_date", e.target.value)} /></Field>
                                      <button style={btn("var(--accent)")} disabled={isBusy || !(dcForm[id]?.dc_reference || "").trim()} onClick={() => addDcRow(r)}>Add DC</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Logged LCs */}
                            {lcs.length > 0 && (
                              <div className="fos-tbl" style={{ overflowX: "auto", marginBottom: 14 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
                                  <thead><tr>{["DC reference", "LC reference", "Amount", "Bank", "Loan", "Expected", "Actual paid", "Status", ""].map((h, i) => (
                                    <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "6px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
                                  <tbody>
                                    {lcs.map((l) => {
                                      const loan = LOAN_META[l.loan_type] || LOAN_META.IMPORT;
                                      return (
                                      <Fragment key={l.lc_id}>
                                        <tr>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", color: "var(--muted)" }}>{l.dc_reference || "—"}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", fontWeight: 550 }}>{l.lc_reference}</td>
                                          <td className="fos-num" style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", whiteSpace: "nowrap" }}>
                                            {l.lc_amount != null ? curMoney(l.lc_amount, r) : "—"}
                                          </td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", color: "var(--muted)" }}>{l.lc_bank || "—"}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}><Badge tone={loan.tone}>{loan.label}</Badge></td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>{fmtDate(l.lc_payment_date)}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap", color: l.actual_payment_date ? "var(--ink)" : "var(--faint)" }}>{fmtDate(l.actual_payment_date)}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                                            {l.lc_settled ? <Badge tone="green">Settled {l.lc_settled_date ? fmtDate(l.lc_settled_date) : ""}</Badge> : <Badge tone="amber">Pending</Badge>}
                                            {!l.lc_settled && l.on_facility === false && <span title="This LC reference hasn't appeared on the HSBC bank trade facility yet (Treasury)." style={{ marginLeft: 6 }}><Badge tone="red">Not on facility</Badge></span>}
                                            {!l.lc_settled && l.on_facility === true && <span title="Matched to a drawing on the HSBC bank trade facility." style={{ marginLeft: 6 }}><Badge tone="green">On facility</Badge></span>}
                                          </td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", whiteSpace: "nowrap" }}>
                                            <button style={{ ...ghost, marginRight: 6 }} disabled={isBusy} onClick={() => openEditLc(l)}>Edit</button>
                                            {!l.lc_settled && <button style={{ ...ghost, marginRight: 6 }} disabled={isBusy} onClick={() => { setEditLc(null); setReconLc(reconLc?.lc_id === l.lc_id ? null : { lc_id: l.lc_id, lc_settled_date: "", lc_settled_amount: l.lc_amount != null ? String(l.lc_amount) : "" }); }}>Reconcile</button>}
                                            <button style={ghost} disabled={isBusy} onClick={() => deleteLcRow(r, l)}>Delete</button>
                                          </td>
                                        </tr>
                                        {editLc?.lc_id === l.lc_id && (
                                          <tr><td colSpan={9} style={{ padding: "10px 10px", borderBottom: "1px solid var(--hairline)", background: "var(--surface)" }}>
                                            <div style={{ fontSize: 11.5, fontWeight: 650, marginBottom: 8 }}>Edit LC {l.lc_reference}</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 10, maxWidth: 900 }}>
                                              <Field label="DC reference"><select style={{ ...inputSt, width: "100%" }} value={editLc.dc_reference} onChange={(e) => editField("dc_reference", e.target.value)}><option value="">— none —</option>{(r.dcs || []).map((d) => <option key={d.dc_id} value={d.dc_reference}>{d.dc_reference}</option>)}</select></Field>
                                              <Field label="LC reference"><input style={{ ...inputSt, width: "100%" }} value={editLc.lc_reference} onChange={(e) => editField("lc_reference", e.target.value)} placeholder="the reference HSBC draws under" /></Field>
                                              <Field label={`LC amount (${curSym(r)})`}><MoneyInput style={{ ...inputSt, width: "100%", textAlign: "right" }} value={editLc.lc_amount} onChange={(e) => editField("lc_amount", e.target.value)} /></Field>
                                              <Field label="Issuing bank"><input style={{ ...inputSt, width: "100%" }} value={editLc.lc_bank} onChange={(e) => editField("lc_bank", e.target.value)} /></Field>
                                              <Field label="LC confirmed"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.lc_confirmed_date} onChange={(e) => editField("lc_confirmed_date", e.target.value)} /></Field>
                                              <Field label="Expected payment"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.lc_payment_date} onChange={(e) => editField("lc_payment_date", e.target.value)} /></Field>
                                              <Field label="Actual payment date"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.actual_payment_date} onChange={(e) => editField("actual_payment_date", e.target.value)} /></Field>
                                              <Field label="Loan type"><select style={{ ...inputSt, width: "100%" }} value={editLc.loan_type} onChange={(e) => editField("loan_type", e.target.value)}><option value="IMPORT">Import loan (in transit)</option><option value="TRADE">Trade loan (arrived — held by Miniso UK)</option></select></Field>
                                              <Field label="Goods arrived date"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.goods_arrived_date} onChange={(e) => editField("goods_arrived_date", e.target.value)} /></Field>
                                            </div>
                                            <div style={{ display: "flex", gap: 8 }}>
                                              <button style={btn("var(--accent)")} disabled={isBusy || !(editLc.lc_reference || "").trim()} onClick={() => saveEditLc(r)}>Save changes</button>
                                              <button style={ghost} onClick={() => setEditLc(null)}>Cancel</button>
                                            </div>
                                          </td></tr>
                                        )}
                                        {reconLc?.lc_id === l.lc_id && !l.lc_settled && (
                                          <tr><td colSpan={10} style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", background: "var(--surface)" }}>
                                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                                              <Field label="Settled date"><input type="date" style={{ ...inputSt, width: 150 }} value={reconLc.lc_settled_date} onChange={(e) => setReconLc((s) => ({ ...s, lc_settled_date: e.target.value }))} /></Field>
                                              <Field label={`Settled amount (${curSym(r)})`}><MoneyInput style={{ ...inputSt, width: 130, textAlign: "right" }} value={reconLc.lc_settled_amount} onChange={(e) => setReconLc((s) => ({ ...s, lc_settled_amount: e.target.value }))} /></Field>
                                              <button style={btn("var(--green)")} disabled={isBusy} onClick={() => reconcileEntry(r)}>Mark settled</button>
                                              <button style={ghost} onClick={() => setReconLc(null)}>Cancel</button>
                                            </div>
                                          </td></tr>
                                        )}
                                      </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Add an LC */}
                            {r.finance_status !== "CLOSED" && (
                              <div style={{ borderTop: lcs.length ? "1px solid var(--line)" : "none", paddingTop: lcs.length ? 12 : 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 8 }}>Add {lcs.length ? "another" : "an"} LC</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 10, maxWidth: 900 }}>
                                  <Field label="DC reference"><select style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.dc_reference || ""} onChange={(e) => setLcField(id, "dc_reference", e.target.value)}><option value="">{(r.dcs || []).length ? "— none —" : "— add a DC above —"}</option>{(r.dcs || []).map((d) => <option key={d.dc_id} value={d.dc_reference}>{d.dc_reference}</option>)}</select></Field>
                                  <Field label="LC reference"><input style={{ ...inputSt, width: "100%" }} placeholder="the reference HSBC draws under" value={lcForm[id]?.lc_reference || ""} onChange={(e) => setLcField(id, "lc_reference", e.target.value)} /></Field>
                                  <Field label={`LC amount (${curSym(r)})`}><MoneyInput style={{ ...inputSt, width: "100%", textAlign: "right" }} placeholder="0.00" value={lcForm[id]?.lc_amount || ""} onChange={(e) => setLcField(id, "lc_amount", e.target.value)} /></Field>
                                  <Field label="Issuing bank"><input style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.lc_bank || ""} onChange={(e) => setLcField(id, "lc_bank", e.target.value)} /></Field>
                                  <Field label="LC confirmed"><input type="date" style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.lc_confirmed_date || ""} onChange={(e) => setLcField(id, "lc_confirmed_date", e.target.value)} /></Field>
                                  <Field label="Expected payment"><input type="date" style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.lc_payment_date || ""} onChange={(e) => setLcField(id, "lc_payment_date", e.target.value)} /></Field>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <button style={btn("var(--accent)")} disabled={isBusy || !(lcForm[id]?.lc_reference || "").trim()} onClick={() => addLcRow(r)}>Log LC</button>
                                  <button style={ghost} onClick={() => setLcFor(null)}>Close</button>
                                </div>
                              </div>
                            )}
                              </>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                      {challengeFor === id && (
                        <tr>
                          <td colSpan={12} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Challenge {procRef(r)}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8, marginBottom: 10 }}>
                              {PROC_CHALLENGE_REASONS.map((x) => (
                                <label key={x.code} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                                  <input type="checkbox" checked={chReasons.has(x.code)} onChange={(e) => toggleReason(x.code, e.target.checked)} />
                                  <span>{x.label}</span>
                                </label>
                              ))}
                            </div>
                            <textarea rows={2}
                              placeholder={chNeedsNote ? "Say what the query is — required for “Other”…" : "Optional note (what needs resolving)…"}
                              style={{ ...inputSt, width: "100%", resize: "vertical", borderColor: chNoteErr ? "var(--red)" : undefined }}
                              value={chNote} onChange={(e) => setChNote(e.target.value)} />
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                              <button style={btn("var(--red)")} disabled={chReasons.size === 0 || !!chNoteErr || busy === id} onClick={() => submitChallenge(r)}>Raise challenge</button>
                              <button style={ghost} onClick={() => setChallengeFor(null)}>Cancel</button>
                              {chReasons.size === 0
                                ? <span style={{ fontSize: 11.5, color: "var(--faint)", alignSelf: "center" }}>Choose at least one reason.</span>
                                : chNoteErr && <span style={{ fontSize: 11.5, color: "var(--red)", alignSelf: "center" }}>{chNoteErr}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.6 }}>
          Approve a purchase, then either record its invoice + payment (Local Purchase) or log the <strong>HSBC Letter of Credit</strong> and reconcile it on settlement (Miniso HQ), before you <strong>Close</strong> it (reported as committed procurement spend). <strong>Challenge</strong> is available on any open purchase under a controlled reason (shown &ldquo;under challenge&rdquo; until resolved). Download the current view to CSV.
        </div>
      </div>
      </>
      )}
    </div>
  );
}

// A keyed group of two <tr> rows (the row + its optional challenge panel).
function FragmentRow({ children }) {
  return <>{children}</>;
}

// A labelled field for the LC panel.
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelSt}>{label}</span>
      {children}
    </label>
  );
}

/*
 * Whether this budget is in the wrong MONTHS or the wrong SHAPE.
 *
 * The distinction matters because only one of them is fixable from this panel.
 * A plan sitting in the wrong months is a re-phasing: every month is out by the
 * same distance and one shift puts it right — the Local case, where the budget
 * was keyed on supplier terms while Local settles at 180 days on the facility.
 * A plan of the wrong shape is not: shifting it only moves the mismatch around,
 * and the honest answer is to re-cut the forecast or explain the variance.
 *
 * So this says which, with the number behind it, rather than offering a shift
 * and leaving the judgement unmade.
 */
function PhasingVerdict({ phase, source }) {
  const pct = Math.round((phase.gain || 0) * 100);
  const aligned = phase.best === 0;
  const tone = aligned ? "var(--green)" : phase.uniform ? "var(--accent)" : "var(--amber)";
  return (
    <div style={{ border: `1px solid ${tone}`, borderRadius: 9, padding: "10px 12px", marginBottom: 12, fontSize: 12.5, lineHeight: 1.55 }}>
      <strong style={{ color: tone }}>
        {aligned
          ? "Already phased against its activity."
          : phase.uniform
            ? `Out by ${Math.abs(phase.best)} month${Math.abs(phase.best) === 1 ? "" : "s"} — a re-phasing case.`
            : "Shifting will not fix this."}
      </strong>{" "}
      {aligned ? (
        <>No shift reduces the gap between budget and activity, so there is nothing to re-phase. Any variance here is real.</>
      ) : phase.uniform ? (
        <>
          The budget sits around {ymLabel(phase.budgetCentre)} while the activity lands around {ymLabel(phase.activityCentre)}.
          Moving it {phase.best > 0 ? "+" : ""}{phase.best} removes <strong style={{ color: "var(--ink)" }}>{pct}%</strong> of the mismatch, which means the plan is the right shape and simply keyed to the wrong dates.
          {source === "LOCAL" && <> That is what you would expect: Local settles at 180 days on the facility, not on supplier terms.</>}
        </>
      ) : (
        <>
          The best shift available ({phase.best > 0 ? "+" : ""}{phase.best}) removes only <strong style={{ color: "var(--ink)" }}>{pct}%</strong> of the mismatch, so the budget is not merely sitting in the wrong months —
          the money is spread differently from the activity. Moving it would relabel the problem rather than solve it. Re-cut the plan, or record the variance and explain it.
        </>
      )}
    </div>
  );
}

/*
 * The trade-pay drawing a paid purchase settled on (migration 115).
 *
 * Recording HOW a purchase was paid was not enough to reconcile anything —
 * "trade pay" says which register the money is in, not which line of it. With
 * the reference, a procurement order can be tied to its HSBC drawing and closed
 * once that loan has been repaid in full.
 *
 * A reference the facility has never heard of is FLAGGED, not refused. The
 * extract is uploaded periodically, so a genuine reference may simply not be
 * loaded yet, and refusing it would stop Finance recording a payment that really
 * happened. Same treatment the LC references already get.
 */
function TradePayRef({ row, busy, onSave }) {
  const saved = row.trade_pay_ref || "";
  const [v, setV] = useState(saved);
  useEffect(() => { setV(row.trade_pay_ref || ""); }, [row.trade_pay_ref]);
  const dirty = v.trim().toUpperCase() !== saved.toUpperCase();
  const m = row.trade_pay || {};
  const TONE = { green: "var(--green)", amber: "var(--amber)", muted: "var(--faint)" };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        value={v} onChange={(e) => setV(e.target.value)} disabled={busy}
        placeholder="WC…" maxLength={40} title={m.label || "The HSBC drawing reference this settled on"}
        style={{ ...inputSt, width: 130, fontFamily: "var(--mono)", fontSize: 11.5, textTransform: "uppercase" }}
      />
      {dirty
        ? <button style={ghost} disabled={busy} onClick={() => onSave(v.trim().toUpperCase() || null)}>Save ref</button>
        : m.state && m.state !== "n/a" && (
            <span title={m.label} style={{ fontSize: 15, lineHeight: 1, color: TONE[m.tone] || "var(--faint)", cursor: "help" }}>
              {m.state === "matched" ? "✓" : m.state === "unknown" ? "·" : "!"}
            </span>
          )}
      {/* The facility saying the loan is repaid is what makes this order
          closable — the whole point of capturing the reference. */}
      {!dirty && row.trade_pay_settled === true && (
        <span style={{ fontSize: 10.5, color: "var(--green)" }} title="The facility reports this drawing fully repaid — this order can be closed">settled</span>
      )}
    </span>
  );
}
