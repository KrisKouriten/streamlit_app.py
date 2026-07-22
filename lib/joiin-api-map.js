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

// Normalise the company list → [{ id, name }].
export function mapCompanies(json) {
  const arr = Array.isArray(json) ? json : (json?.companies || json?.data || []);
  return arr.map((c) => ({ id: c.id ?? c.companyId ?? c.uuid, name: c.name ?? c.companyName ?? c.displayName })).filter((c) => c.id && c.name);
}
