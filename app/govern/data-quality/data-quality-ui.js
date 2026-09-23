"use client";
import { useState } from "react";
import { Badge } from "../../finance-os/ui";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 14 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const TONE = { OK: "green", WARN: "amber", FAIL: "red" };
const WORD = { OK: "Passing", WARN: "Attention", FAIL: "Broken" };
const BAR = { OK: "var(--green)", WARN: "var(--amber)", FAIL: "var(--red)" };

export default function DataQualityUI({ checks = [], status = "OK", repairs = [], applyAction = null }) {
  return (
    <>
      {repairs.length > 0 && applyAction && <ApplyMissingColumns repairs={repairs} action={applyAction} />}
      <div style={{ ...card, borderLeft: `3px solid ${BAR[status]}` }}>
        <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 3 }}>
          {status === "OK" ? "Every feed is landing." : status === "FAIL" ? "Something is broken, not just empty." : "Everything runs, but some data isn’t counted."}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>
          {status === "OK"
            ? "No missing tables, unrecognised values or unconverted amounts."
            : "Each item below says what is wrong, what it costs you on screen, and where to fix it."}
        </div>
      </div>
      {checks.map((c) => <Check key={c.key} check={c} />)}
    </>
  );
}

function Check({ check }) {
  // Detail is collapsed by default on a passing check — the point of the page is
  // to surface problems, not to make you read through what already works.
  const [open, setOpen] = useState(check.status !== "OK");
  const has = (check.detail || []).length > 0;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 650 }}>{check.label}</span>
        <Badge tone={TONE[check.status]}>{WORD[check.status]}</Badge>
        {has && (
          <button onClick={() => setOpen((x) => !x)} style={{
            marginLeft: "auto", fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 8,
            border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer",
          }}>{open ? "Hide detail" : "Show detail"}</button>
        )}
      </div>

      <div style={{ fontSize: 13, color: "var(--ink)", marginTop: 8, lineHeight: 1.55 }}>{check.summary}</div>

      {check.remedy && (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.55 }}>
          <strong style={{ color: "var(--ink)" }}>Fix:</strong> {check.remedy}
        </div>
      )}

      {has && open && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          {check.detail.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "5px 0", flexWrap: "wrap" }}>
              <span style={{ ...labelSt, minWidth: 220, color: d.tone ? BAR[d.tone] : "var(--faint)" }}>{d.label}</span>
              <span style={{ fontSize: 13, fontFamily: "var(--mono)", fontWeight: 600 }}>{d.value}</span>
              {d.note && <span style={{ fontSize: 12, color: "var(--faint)" }}>{d.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * Apply the missing columns, here, against the database the app is connected to.
 *
 * This panel exists because the SQL editor and the app disagreed about which
 * Neon branch was in front of you — five runs reported success against a branch
 * the app has never read, and nothing on either side could tell. The button runs
 * through the same pool every reader uses, so the check that says a column is
 * missing is the check that says it is fixed.
 *
 * The exact statement is shown rather than described. An admin should be able to
 * read what they are about to run, and "trust me" is how the wrong branch got
 * written to in the first place.
 */
function ApplyMissingColumns({ repairs, action }) {
  return (
    <div style={{ ...card, borderLeft: "3px solid var(--amber)" }}>
      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 3 }}>
        {repairs.length === 1 ? "One column can be added here." : `${repairs.length} columns can be added here.`}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, marginBottom: 12 }}>
        This runs against the database above — the one the app is actually connected to — so it cannot land on
        the wrong branch. Each statement is additive and idempotent: it adds a column if it is absent and does
        nothing if it is already there. No data is written, nothing is dropped, and no deploy is needed.
      </div>
      <form action={action}>
        {repairs.map((r) => (
          <div key={r.key} style={{ marginBottom: 10 }}>
            <input type="hidden" name="key" value={r.key} />
            <div style={{ ...labelSt, color: "var(--red)" }}>finance.{r.table}.{r.column}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 5px" }}>
              <strong style={{ color: "var(--ink)" }}>{r.migration}</strong> · {r.feature}
            </div>
            <code style={{
              display: "block", fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.5, color: "var(--muted)",
              background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 6, padding: "7px 9px",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{r.sql}</code>
          </div>
        ))}
        <button type="submit" style={{
          marginTop: 4, fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 8,
          border: "1px solid var(--line)", background: "var(--ink)", color: "var(--surface)", cursor: "pointer",
        }}>
          {repairs.length === 1 ? "Add this column" : `Add these ${repairs.length} columns`}
        </button>
      </form>
    </div>
  );
}
