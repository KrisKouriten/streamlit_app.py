/*
 * Joiin Connect API response mapping (pure, tested). The API returns report
 * values in a nested shape (e.g. value: [["123.45"]]); custom reports come as
 * { sections: [{ name, accounts: [{ displayName, value }] }] }. These helpers
 * normalise that into flat { section, account, value } rows the loaders use.
 * Written defensively so small shape differences don't break the refresh.
 */

// Coerce Joiin's value (number | "1,234.5" | [["123.45"]] | [123.45]) → number.
export function numFrom(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return numFrom(v[0]);
  const n = Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const SECTION_NAME = (s) => s?.name ?? s?.title ?? s?.displayName ?? s?.section ?? "";
const ACC_NAME = (a) => a?.displayName ?? a?.name ?? a?.account ?? a?.accountName ?? "";
const ACC_VALUE = (a) => a?.value ?? a?.amount ?? a?.total ?? a?.balance;

// Map a P&L / custom-report response → [{ section, account, value }].
// Handles { sections:[{accounts:[…]}] } and a flat { accounts:[…] } fallback.
export function mapReportRows(json) {
  const out = [];
  const sections = json?.sections || json?.report?.sections;
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      const section = SECTION_NAME(sec) || "P&L";
      const accts = sec?.accounts || sec?.rows || [];
      for (const a of accts) {
        const account = ACC_NAME(a);
        if (!account) continue;
        out.push({ section, account, value: numFrom(ACC_VALUE(a)) });
      }
      // nested sub-sections (defensive)
      if (Array.isArray(sec?.sections)) for (const r of mapReportRows({ sections: sec.sections })) out.push(r);
    }
    return out;
  }
  const flat = json?.accounts;
  if (Array.isArray(flat)) {
    for (const a of flat) {
      const account = ACC_NAME(a);
      if (account) out.push({ section: "P&L", account, value: numFrom(ACC_VALUE(a)) });
    }
  }
  return out;
}

// Map a Custom Report (board pack) response for a single month → the shape
// upsertBoardPack expects: { months:[ym], rows:[{seq,kind,label,values,isPct}] }.
// Joiin returns the pack as ordered sections. A section with accounts is a
// header + its account lines + (usually) a subtotal; a section with no accounts
// but a value is a top-level computed line (Gross Profit, EBITDA, Group Net
// Profit); anything whose name carries "%" is a ratio (stored as a fraction).
// We preserve Joiin's order and classify each entry, mirroring the markdown
// parser (parseBoardPack) so both refresh paths store the same row shape. The
// exact board-pack JSON field names should be confirmed on the first live run.
export function mapBoardPackRows(json, ym) {
  const sections = json?.sections || json?.report?.sections || [];
  const rows = [];
  let seq = 0;
  const isPctName = (s) => /%/.test(String(s));
  const cell = (n, pct) => ({ [ym]: pct ? n / 100 : n });
  for (const sec of sections) {
    const name = SECTION_NAME(sec);
    const accts = sec?.accounts || sec?.rows || [];
    if (accts.length) {
      rows.push({ seq: seq++, kind: "section", label: name, values: {}, isPct: false });
      for (const a of accts) {
        const label = ACC_NAME(a);
        if (!label) continue;
        const pct = isPctName(label);
        rows.push({ seq: seq++, kind: pct ? "pct" : "line", label, values: cell(numFrom(ACC_VALUE(a)), pct), isPct: pct });
      }
      const tot = sec?.total ?? sec?.subtotal ?? sec?.value;
      if (tot != null) rows.push({ seq: seq++, kind: "total", label: `Total ${name}`, values: cell(numFrom(tot), false), isPct: false });
    } else {
      const pct = isPctName(name);
      rows.push({ seq: seq++, kind: pct ? "pct" : "computed", label: name, values: cell(numFrom(ACC_VALUE(sec)), pct), isPct: pct });
    }
  }
  return { months: [ym], rows };
}

// Normalise the company list → [{ id, name }].
export function mapCompanies(json) {
  const arr = Array.isArray(json) ? json : (json?.companies || json?.data || []);
  return arr.map((c) => ({ id: c.id ?? c.companyId ?? c.uuid, name: c.name ?? c.companyName ?? c.displayName })).filter((c) => c.id && c.name);
}
