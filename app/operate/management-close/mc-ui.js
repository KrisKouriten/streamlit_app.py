"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, pct, Badge } from "../../finance-os/ui";

/* Client UI for the management accounts close: pre-close exceptions with the
   confirm · correct · explain cycle, the per-period playbook checklist, and
   the reference model (view + CSV upload). */

const CHECK_META = {
  A: ["Completeness", "Expected nominals present — missing lines are accrual candidates; new lines need a home in the model."],
  B: ["Variable drift", "Variable costs re-derived from the revenue driver and compared to actuals."],
  C: ["Fixed drift", "Fixed costs line-by-line against the schedule — under-postings hint at accrual top-ups."],
  SIGN: ["Sign consistency", "Postings sitting on the wrong side of the account's natural balance."],
};
const WS_LABEL = { PL: "01 · P&L actuals", ACCRUALS: "02 · Accruals & prepayments", FA: "03 · Fixed assets" };
const REVIEW_LABEL = { CONFIRMED: "Confirmed", EXPLAINED: "Explained", CORRECTING: "Correcting" };
const REVIEW_TONE = { CONFIRMED: "green", EXPLAINED: "accent", CORRECTING: "amber" };

const CSV_TEMPLATE = "Account Code,Behaviour,Monthly Amount,% of Revenue,Tolerance %,Tolerance £,Expected Every Period\n6100,FIXED,20500,,10,500,Yes\n5000,VARIABLE,,40,10,1000,Yes\n4000,REVENUE,,,,,Yes\n";

async function post(body) {
  const res = await fetch("/api/management-close", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function ManagementCloseUI({ pre, actions, canManage, monthsCovered }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  if (!pre.period) {
    return (
      <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)" }}>
        No Xero actuals loaded yet — once a period is loaded, the pre-close checks and the close playbook run here.
      </div>
    );
  }

  const high = pre.exceptions.filter((e) => e.severity === "HIGH").length;
  const open = pre.exceptions.filter((e) => !e.review).length;

  async function review(e, status) {
    setErr("");
    let note = null;
    if (status !== "CONFIRMED") {
      note = window.prompt(status === "EXPLAINED" ? "Explanation (kept on the file):" : "What is being corrected?");
      if (note === null) return;
    }
    setBusy(`${e.account_code}|${e.check}`);
    try { await post({ action: "review", period: pre.period, accountCode: e.account_code, check: e.check, status, note }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }

  async function toggle(a) {
    setErr(""); setBusy(`act-${a.action_id}`);
    try { await post({ action: "toggle", actionId: a.action_id, period: pre.period, done: !a.done }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }

  const groups = ["A", "B", "C", "SIGN"].map((c) => [c, pre.exceptions.filter((e) => e.check === c)]).filter(([, list]) => list.length);

  return (
    <>
      {/* summary + period coverage */}
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 26 }}>
        <Tile label="Exceptions" value={pre.exceptions.length} tone={pre.exceptions.length ? (high ? "var(--red)" : "var(--amber)") : "var(--green)"} sub={`${high} high · ${open} unreviewed`} />
        <Tile label="Lines assured" value={pre.assured} tone="var(--green)" sub="within tolerance — no action" />
        <Tile label="Revenue driver" value={money(pre.revenueActual, { compact: true })} sub="drives variable expectations" />
        <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>Period covers</div>
          <select value={monthsCovered} onChange={(e) => router.push(`/operate/management-close?months=${e.target.value}`)}
            className="fos-input" style={{ height: 34, fontSize: 13.5, padding: "0 8px" }} aria-label="Months covered by the loaded period">
            {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
          </select>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>The current Cambridge load is cumulative H1 — 6 months.</div>
        </div>
      </div>

      {err && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{err}</div>}

      {/* exceptions, grouped by check */}
      {groups.length === 0 ? (
        <div className="fos-card" style={{ padding: "16px 18px", marginBottom: 30, fontSize: 13.5, color: "var(--green)" }}>
          All lines reconcile to expectation — nothing needs review before sign-off.
        </div>
      ) : groups.map(([c, list]) => (
        <section key={c} style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>Check {c === "SIGN" ? "" : c} · {CHECK_META[c][0]}</span>
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {CHECK_META[c][1]}</span>
          </div>
          <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 700 }}>
              <thead><tr>
                {["", "Nominal", "Actual", "Expected", "Variance", "What to look at", ""].map((h, i) => (
                  <th key={i} style={{ textAlign: i >= 2 && i <= 4 ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {list.map((e, i) => {
                  const k = `${e.account_code}|${e.check}`;
                  const reviewed = e.review;
                  return (
                    <tr key={k} style={{ opacity: reviewed ? 0.62 : 1 }}>
                      <td style={{ padding: "10px 14px", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)" }}>
                        <Badge tone={e.severity === "HIGH" ? "red" : "amber"}>{e.severity}</Badge>
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--faint)", marginRight: 7 }}>{e.account_code}</span>
                        <span style={{ fontWeight: 570 }}>{e.account_name || "—"}</span>
                      </td>
                      <td className="fos-num" style={{ padding: "10px 14px", textAlign: "right", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)" }}>{money(e.actual)}</td>
                      <td className="fos-num" style={{ padding: "10px 14px", textAlign: "right", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)", color: "var(--muted)" }}>{e.check === "SIGN" ? "natural side" : money(e.expected)}</td>
                      <td className="fos-num" style={{ padding: "10px 14px", textAlign: "right", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)", color: e.severity === "HIGH" ? "var(--red)" : "var(--amber)" }}>
                        {e.check === "SIGN" ? "—" : <>{money(e.varianceAbs)}{e.variancePct != null && <span style={{ color: "var(--faint)" }}> · {pct(e.variancePct, 0)}</span>}</>}
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)", fontSize: 12.5, color: "var(--muted)", maxWidth: 340, whiteSpace: "normal" }}>
                        {e.hint}
                        {reviewed?.note && <div style={{ color: "var(--faint)", marginTop: 3 }}>“{reviewed.note}” — {reviewed.actor}</div>}
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: i === list.length - 1 ? "none" : "1px solid var(--hairline)", whiteSpace: "nowrap", textAlign: "right" }}>
                        {reviewed ? (
                          <Badge tone={REVIEW_TONE[reviewed.status]}>{REVIEW_LABEL[reviewed.status]}</Badge>
                        ) : canManage ? (
                          <span style={{ display: "inline-flex", gap: 5 }}>
                            <button className="fos-btn-ghost" disabled={busy === k} onClick={() => review(e, "CONFIRMED")} title="Confirm — fine as posted">Confirm</button>
                            <button className="fos-btn-ghost" disabled={busy === k} onClick={() => review(e, "EXPLAINED")} title="Explain — keep a note on file">Explain</button>
                            <button className="fos-btn-ghost" disabled={busy === k} onClick={() => review(e, "CORRECTING")} title="Correcting — a fix is going through">Correct</button>
                          </span>
                        ) : <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Awaiting review</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* the close playbook */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "30px 0 11px" }}>
        <span style={{ fontSize: 14.5, fontWeight: 650 }}>Close actions — period {pre.period}</span>
        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· the assurance playbook; per-entity execution ticks live on Workflow → Month-end close</span>
      </div>
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginBottom: 12 }}>
        {["PL", "ACCRUALS", "FA"].map((ws) => {
          const list = actions.filter((a) => a.workstream === ws);
          const doneN = list.filter((a) => a.done).length;
          return (
            <div key={ws} className="fos-card" style={{ padding: "15px 17px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--accent)" }}>{WS_LABEL[ws]}</span>
                <span className="fos-num" style={{ fontSize: 11.5, color: doneN === list.length && list.length ? "var(--green)" : "var(--faint)" }}>{doneN}/{list.length}</span>
              </div>
              {list.map((a) => (
                <label key={a.action_id} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "6px 0", fontSize: 13, color: a.done ? "var(--faint)" : "var(--ink)", textDecoration: a.done ? "line-through" : "none", cursor: canManage ? "pointer" : "default" }}>
                  <input type="checkbox" checked={a.done} disabled={!canManage || busy === `act-${a.action_id}`} onChange={() => toggle(a)} style={{ marginTop: 3, accentColor: "var(--accent)" }} />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="fos-card" style={{ padding: "13px 17px", marginBottom: 30, fontSize: 12.5, color: "var(--faint)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", marginRight: 8 }}>04 · Inventory</span>
        Stock roll-forward (goods in transit + delivered + opening − allocations) reconciling to the balance sheet and COGS — defined in the process, next to build.
      </div>

      {/* reference model */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: 14.5, fontWeight: 650 }}>Reference model</span>
        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· what each nominal is expected to do — held and maintained by finance</span>
      </div>
      <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
          <thead><tr>
            {["Nominal", "Behaviour", "Expectation", "Tolerance", "Source"].map((h, i) => (
              <th key={i} style={{ textAlign: i >= 2 && i <= 3 ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {pre.expectations.map((x, i) => (
              <tr key={x.account_code}>
                <td style={{ padding: "9px 14px", borderBottom: i === pre.expectations.length - 1 ? "none" : "1px solid var(--hairline)" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--faint)", marginRight: 7 }}>{x.account_code}</span>
                </td>
                <td style={{ padding: "9px 14px", borderBottom: i === pre.expectations.length - 1 ? "none" : "1px solid var(--hairline)" }}><Badge tone={x.behaviour === "FIXED" ? "accent" : "muted"}>{x.behaviour}</Badge></td>
                <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: i === pre.expectations.length - 1 ? "none" : "1px solid var(--hairline)" }}>
                  {x.behaviour === "FIXED" ? `${money(x.monthly_amount)} / month` : x.behaviour === "VARIABLE" ? `${pct(x.pct_of_revenue)} of revenue` : "driver"}
                </td>
                <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: i === pre.expectations.length - 1 ? "none" : "1px solid var(--hairline)", color: "var(--muted)" }}>
                  {pct(x.tolerance_pct, 0)} · {money(x.tolerance_abs)}
                </td>
                <td style={{ padding: "9px 14px", borderBottom: i === pre.expectations.length - 1 ? "none" : "1px solid var(--hairline)", fontSize: 12, color: "var(--faint)" }}>{x.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && <ModelUpload onDone={() => router.refresh()} />}
    </>
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

function ModelUpload({ onDone }) {
  const fileRef = useRef(null);
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState("Loading…");
    try {
      const csv = await f.text();
      const r = await post({ action: "model", csv });
      setState(`Loaded ${r.loaded} expectation lines${r.errors?.length ? ` · ${r.errors.length} row error(s) skipped` : ""}.`);
      onDone();
    } catch (x) { setState(x.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
      <button className="fos-btn-ghost" onClick={() => fileRef.current?.click()}>Upload reference model (CSV)</button>
      <a className="fos-btn-ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="reference-model-template.csv">Template</a>
      <span>Replaces the active model — fixed schedule, variable rates, tolerances.</span>
      {state && <span style={{ color: "var(--muted)" }}>{state}</span>}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
    </div>
  );
}
