/*
 * Joiin consolidated P&L — pure parsing/mapping of the connector's report
 * output (a markdown table) into rows and the summary the dashboards read.
 *
 * The report has section headers (value "-"), indented account rows, a "Total"
 * per section, and computed lines (Gross Profit, Operating Profit, Other Profit,
 * Net Profit) at the top level. Columns are monthly (e.g. "Jun 26").
 */

const MONTHS3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "Jun 26" / "Jun 2026" → "2026-06"
export function headerToYm(h) {
  const m = String(h).trim().toLowerCase().match(/^([a-z]{3})[a-z]*\s+(\d{2}|\d{4})$/);
  if (!m || !(m[1] in MONTHS3)) return null;
  const yr = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${yr}-${String(MONTHS3[m[1]]).padStart(2, "0")}`;
}

// "£1,687,139" | "-£8,000" | "£0" | "-" | "(£8,000)" → number | null
export function parseMoney(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "" || t === "-" || t === "—") return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = Number(t.replace(/[()£$,%\s-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const SECTION_STARTS = ["revenue", "cost of sales", "expenses", "other income", "other expenses"];
const CANON_SECTION = { "revenue": "Revenue", "cost of sales": "Cost of Sales", "expenses": "Expenses", "other income": "Other Income", "other expenses": "Other Expenses" };

// Parse one report (markdown string). Returns { months, rows:[{section,account,ym,value}], memo }
// memo carries the computed/total lines per month for reconciliation.
export function parseJoiinPnl(markdown) {
  const lines = String(markdown).split("\n").filter((l) => l.trim().startsWith("|"));
  if (!lines.length) return { months: [], rows: [], memo: {} };

  // split a markdown row into raw cells (keep leading spaces for indent detection)
  const cells = (l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");

  // header row: first cell blank-ish, remaining cells parse as month headers
  let headerIdx = -1, cols = [];
  for (let i = 0; i < lines.length; i++) {
    const c = cells(lines[i]);
    const yms = c.slice(1).map((x) => headerToYm(x));
    if (yms.length && yms.every((y) => y) && yms.length >= 1 && !c[0].trim()) { headerIdx = i; cols = yms; break; }
  }
  if (headerIdx < 0) {
    // fall back: header is the first row whose later cells are month-like
    for (let i = 0; i < lines.length; i++) {
      const c = cells(lines[i]);
      const yms = c.slice(1).map((x) => headerToYm(x));
      if (yms.length && yms.some((y) => y)) { headerIdx = i; cols = yms; break; }
    }
  }
  if (headerIdx < 0) return { months: [], rows: [], memo: {} };

  const agg = new Map(); // `${section}||${account}` -> { section, account, months:{ym:v} }
  const memo = {}; // label -> { ym: v }
  let section = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = cells(lines[i]);
    if (c.length < 2) continue;
    if (/^[\s:-]+$/.test(c[0]) && c.slice(1).every((x) => /^[\s:-]*$/.test(x))) continue; // divider
    const rawLabel = c[0];
    const indent = rawLabel.length - rawLabel.replace(/^\s+/, "").length;
    const name = rawLabel.trim();
    if (!name) continue;
    const low = name.toLowerCase();
    const vals = cols.map((ym, k) => (ym ? parseMoney(c[k + 1]) : null));

    if (SECTION_STARTS.includes(low)) { section = CANON_SECTION[low]; continue; }
    if (low === "total") { // section subtotal — reconciliation only
      if (section) { memo[`${section} Total`] ||= {}; cols.forEach((ym, k) => { if (ym) memo[`${section} Total`][ym] = vals[k]; }); }
      section = null; // section ends at its total
      continue;
    }
    // Markdown pads every cell with a leading space, so top-level lines sit at
    // indent 1 and account rows are more deeply indented (≥ 2).
    if (indent <= 1) { // computed top-level line (Gross/Operating/Other/Net Profit)
      memo[name] ||= {}; cols.forEach((ym, k) => { if (ym) memo[name][ym] = vals[k]; });
      continue;
    }
    // indented account row within the current section
    if (!section) continue;
    const key = `${section}||${name}`;
    const rec = agg.get(key) || { section, account: name, months: {} };
    cols.forEach((ym, k) => { if (ym && vals[k] != null) rec.months[ym] = (rec.months[ym] || 0) + vals[k]; });
    agg.set(key, rec);
  }

  const months = cols.filter(Boolean);
  const rows = [];
  for (const rec of agg.values()) for (const ym of Object.keys(rec.months)) rows.push({ section: rec.section, account: rec.account, ym, value: rec.months[ym] });
  return { months, rows, memo };
}

// Parse a "by-company" report (one month): entities are the columns, the last
// column is the un-eliminated "Total". Returns
//   { entities:[name], ym, rows:[{entity_name, section, account, value}] }
// Only real account rows are kept (section headers, per-section "Total" rows,
// and top-level computed lines are dropped — the format engine recomputes those).
// Duplicate (entity, section, account) cells are summed.
export function parseJoiinByCompany(markdown, ym) {
  const lines = String(markdown).split("\n").filter((l) => l.trim().startsWith("|"));
  if (!lines.length) return { entities: [], ym, rows: [] };
  const cells = (l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");

  // header: first cell blank-ish, remaining are entity names; drop a trailing "Total"
  let headerIdx = -1, names = [];
  for (let i = 0; i < lines.length; i++) {
    const c = cells(lines[i]);
    if (c.length > 2 && !c[0].trim() && c.slice(1).some((x) => x.trim())) { headerIdx = i; names = c.slice(1).map((x) => x.trim()); break; }
  }
  if (headerIdx < 0) return { entities: [], ym, rows: [] };
  // last column is the group Total — exclude it from per-entity rows
  const lastIsTotal = names[names.length - 1].toLowerCase() === "total";
  const entities = lastIsTotal ? names.slice(0, -1) : names;

  const agg = new Map(); // `${entity}||${section}||${account}` -> value
  let section = null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = cells(lines[i]);
    if (c.length < 2) continue;
    if (/^[\s:-]+$/.test(c[0]) && c.slice(1).every((x) => /^[\s:-]*$/.test(x))) continue; // divider
    const rawLabel = c[0];
    const indent = rawLabel.length - rawLabel.replace(/^\s+/, "").length;
    const name = rawLabel.trim();
    if (!name) continue;
    const low = name.toLowerCase();
    if (SECTION_STARTS.includes(low)) { section = CANON_SECTION[low]; continue; }
    if (low === "total") { section = null; continue; } // section subtotal — end of section
    if (indent <= 1) continue; // top-level computed line (Gross/Operating/Net Profit)
    if (!section) continue;
    // account row: cells 1..entities.length map to each entity
    entities.forEach((ent, k) => {
      const v = parseMoney(c[k + 1]);
      if (v == null) return;
      const key = `${ent}||${section}||${name}`;
      agg.set(key, (agg.get(key) || 0) + v);
    });
  }

  const rows = [];
  for (const [key, value] of agg) {
    const [entity_name, sec, account] = key.split("||");
    if (value === 0) continue;
    rows.push({ entity_name, section: sec, account, value });
  }
  return { entities, ym, rows };
}

// Derive the summary the existing dashboards read (per month), from section
// totals. COGS/opex held negative (ledger convention); net = GP + opex + otherNet.
export function summariseJoiinPnl(parsed) {
  const { months, rows, memo } = parsed;
  const sectionSum = (section, ym) => rows.filter((r) => r.section === section && r.ym === ym).reduce((t, r) => t + r.value, 0);
  const out = {};
  for (const ym of months) {
    const revenue = sectionSum("Revenue", ym);
    const cogs = sectionSum("Cost of Sales", ym);
    const expenses = sectionSum("Expenses", ym);
    const otherIncome = sectionSum("Other Income", ym);
    const otherExp = sectionSum("Other Expenses", ym);
    const grossProfit = revenue - cogs;
    const opex = -(expenses - otherIncome + otherExp); // negative; GP + opex = net
    const netResult = grossProfit + opex;
    out[ym] = { revenue, cogs: -cogs, grossProfit, opex, netResult, net_memo: memo["Net Profit"]?.[ym] ?? null };
  }
  return out;
}
