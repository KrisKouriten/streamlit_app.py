"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";

/* Plan P&L (preview) — read-only viewer over the driver-based planning engine.
   Selectors (version / scenario / scope / store) drive a server round-trip; the
   P&L itself is assembled by getScopePL through the governed pl_format template,
   so it renders identically to the actuals board packs. No inputs here yet — the
   driver/cost/payroll builder is the next phase. */

export default function PlanPnlUI({ versions, scenarios, stores, viewScopes, selected, pnl, canManage, createVersionAction }) {
  const router = useRouter();

  const nav = (patch) => {
    const p = new URLSearchParams();
    const next = { ...selected, ...patch };
    if (next.versionId) p.set("version", String(next.versionId));
    if (next.scenario) p.set("scenario", next.scenario);
    if (next.scope) p.set("scope", next.scope);
    if (next.storeCode) p.set("store", next.storeCode);
    router.push(`/plan/pl?${p.toString()}`);
  };

  // No versions yet — offer to create the first one (nothing to render otherwise).
  if (!versions.length) {
    return (
      <div className="fos-card" style={{ padding: "20px 22px", maxWidth: 560 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 8 }}>No plan version yet</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
          A plan version is the container for a budget or forecast. Create one, then the
          driver builder (next phase) fills it — for now this screen renders whatever the
          engine has computed for the version, through your existing P&L templates.
          {" "}If this stays empty after creating one, the planning schema migrations
          (<span style={{ fontFamily: "var(--mono)" }}>055–060</span>) may not be applied yet.
        </div>
        {canManage
          ? <CreateVersionForm action={createVersionAction} />
          : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Ask a Finance admin to create the first plan version.</div>}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Field label="Version">
          <select className="fos-input" value={selected.versionId ?? ""} onChange={(e) => nav({ versionId: Number(e.target.value) })} style={sel}>
            {versions.map((v) => <option key={v.version_id} value={v.version_id}>{v.kind} · {v.label}{v.fiscal_year ? ` · FY${v.fiscal_year}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Scenario">
          <select className="fos-input" value={selected.scenario} onChange={(e) => nav({ scenario: e.target.value })} style={sel}>
            {scenarios.map((s) => <option key={s.scenario_code} value={s.scenario_code}>{s.name || s.scenario_code}</option>)}
          </select>
        </Field>
        <Field label="Scope">
          <select className="fos-input" value={selected.scope} onChange={(e) => nav({ scope: e.target.value, storeCode: null })} style={sel}>
            {viewScopes.map((s) => <option key={s.scope} value={s.scope}>{s.label}</option>)}
          </select>
        </Field>
        {selected.scope !== "HEAD_OFFICE" && (
          <Field label="Store">
            <select className="fos-input" value={selected.storeCode ?? ""} onChange={(e) => nav({ storeCode: e.target.value || null })} style={sel}>
              <option value="">All in scope</option>
              {stores.map((s) => <option key={s.store_code} value={s.store_code}>{s.store_code} — {s.store_name}</option>)}
            </select>
          </Field>
        )}
      </div>

      <PnlTable pnl={pnl} />

      {canManage && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ fontSize: 12.5, color: "var(--faint)", cursor: "pointer" }}>New plan version</summary>
          <div style={{ marginTop: 12, maxWidth: 480 }}><CreateVersionForm action={createVersionAction} /></div>
        </details>
      )}
    </>
  );
}

function PnlTable({ pnl }) {
  if (!pnl) return null;
  const { cols = [], rows = [], unmapped = [], formatName } = pnl;
  const hasData = rows.some((r) => r.kind !== "section" && r.kind !== "sub" && Math.abs(r.total || 0) > 0.005);

  return (
    <>
      {unmapped.length > 0 && (
        <div className="fos-card" style={{ padding: "12px 16px", marginBottom: 14, fontSize: 12.5, color: "var(--red)", lineHeight: 1.55 }}>
          <strong>{unmapped.length} nominal{unmapped.length === 1 ? "" : "s"} unmapped</strong> — computed by the engine but not claimed by any
          template line, so they are excluded from the P&L: <span style={{ fontFamily: "var(--mono)" }}>{unmapped.join(", ")}</span>.
          {" "}Map them in GOVERN → P&L Format Builder, or align the driver's nominal to a template account.
        </div>
      )}
      {!hasData && (
        <div className="fos-card" style={{ padding: "14px 18px", marginBottom: 14, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          No computed plan lines for this version, scenario and scope yet. The engine renders whatever has been
          computed from driver, cost and payroll inputs — none exist for this selection. Entering those and running the
          compute is the next phase; this preview will fill in automatically once they do.
        </div>
      )}
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
          <thead><tr>
            <th style={thL}>{formatName ? `${formatName} P&L` : "P&L"}</th>
            {cols.map((c) => <th key={c} style={thR}>{c}</th>)}
            <th style={thR}>Total</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => <PnlRow key={`${r.label}-${i}`} r={r} cols={cols} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PnlRow({ r, cols }) {
  if (r.kind === "section" || r.kind === "sub") {
    return <tr><td colSpan={cols.length + 2} style={{ padding: r.kind === "section" ? "12px 12px 5px 16px" : "8px 12px 4px 24px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{r.label}</td></tr>;
  }
  const tone = r.tone === "ebitda" ? (r.total >= 0 ? "var(--green)" : "var(--red)") : (r.tone === "gp" ? "var(--accent)" : undefined);
  const fmt = (v) => r.isPct ? `${(v * 100).toFixed(1)}%` : (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));
  return (
    <tr>
      <td style={tdL(r.strong || !!r.tone)}>{r.label}</td>
      {cols.map((c) => <td key={c} className="fos-num" style={tdR({ strong: r.strong, tone })}>{fmt(r.values?.[c])}</td>)}
      <td className="fos-num" style={tdR({ strong: true, tone })}>{fmt(r.total)}</td>
    </tr>
  );
}

function CreateVersionForm({ action }) {
  const [busy, setBusy] = useState(false);
  return (
    <form action={action} onSubmit={() => setBusy(true)} style={{ display: "grid", gap: 10 }}>
      <input name="label" required placeholder="Version label (e.g. FY2026 Budget v1)" className="fos-input" style={{ padding: "8px 11px", fontSize: 13 }} />
      <div style={{ display: "flex", gap: 10 }}>
        <select name="kind" className="fos-input" style={{ ...sel, flex: 1 }} defaultValue="BUDGET">
          <option value="BUDGET">Budget</option>
          <option value="FORECAST">Forecast</option>
        </select>
        <input name="fiscal_year" type="number" placeholder="FY (e.g. 2026)" className="fos-input" style={{ padding: "8px 11px", fontSize: 13, width: 140 }} />
      </div>
      <button type="submit" className="fos-btn" disabled={busy} style={{ justifySelf: "start", padding: "8px 16px", fontSize: 13 }}>{busy ? "Creating…" : "Create version"}</button>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", letterSpacing: ".06em", textTransform: "uppercase" }}>
      {label}
      {children}
    </label>
  );
}

const sel = { fontSize: 12.5, padding: "7px 10px" };
const thL = { textAlign: "left", padding: "9px 12px 9px 16px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--surface)" };
const thR = { textAlign: "right", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdL = (strong) => ({ textAlign: "left", padding: "7px 12px 7px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, color: "var(--ink)", position: "sticky", left: 0, background: "var(--surface)" });
const tdR = ({ strong, tone } = {}) => ({ textAlign: "right", padding: "7px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, color: tone || "var(--ink)" });
