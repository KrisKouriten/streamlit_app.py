import { query } from "./db";
import { parseBoardPack } from "./joiin-rules.js";
import { BOARDPACK_SCOPES } from "./joiin-reports.js";
export { parseBoardPack };

/*
 * Joiin board-pack P&L — parse the custom-report output and read it back for
 * rendering. Joiin returns each board pack fully laid out (sections, account
 * lines, subtotals, computed lines like Gross Profit / EBITDA / Group Net
 * Profit, and % rows); we store it verbatim (finance.joiin_boardpack) and
 * render it in row order. Joiin does the arithmetic and the intercompany
 * wholesale elimination, so the app never recomputes it.
 */
const tableMissing = (e) => e?.code === "42P01";
const COMPUTED_TONE = /ebitda|net profit|group net|gross profit|initial profit/i;

// Upsert a parsed board pack for a scope (clears the covered months first).
export async function upsertBoardPack(scope, parsed, actor) {
  const months = parsed.months;
  if (months.length) await query(`DELETE FROM finance.joiin_boardpack WHERE scope = $1 AND ym = ANY($2)`, [scope, months]);
  for (const r of parsed.rows) {
    for (const ym of months) {
      const v = r.values[ym];
      await query(
        `INSERT INTO finance.joiin_boardpack (scope, ym, seq, kind, label, value, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (scope, ym, seq) DO UPDATE SET kind = EXCLUDED.kind, label = EXCLUDED.label, value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
        [scope, ym, r.seq, r.kind, r.label, v == null ? null : v, actor || "joiin"]
      );
    }
  }
}

// Read a scope's board pack for a year → render-ready rows (BoardPackPnl shape).
export async function getBoardPack(scope, year) {
  let rows;
  try {
    ({ rows } = await query(`SELECT ym, seq, kind, label, value FROM finance.joiin_boardpack WHERE scope = $1 ORDER BY ym, seq`, [scope]));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };

  const allMonths = [...new Set(rows.map((r) => r.ym))].sort();
  const years = [...new Set(allMonths.map((m) => m.slice(0, 4)))].sort();
  const yr = year && years.includes(year) ? year : years[years.length - 1];
  const months = allMonths.filter((m) => m.startsWith(yr));

  // reassemble rows by seq with a value per month
  const bySeq = new Map();
  for (const r of rows) {
    if (!months.includes(r.ym)) continue;
    if (!bySeq.has(r.seq)) bySeq.set(r.seq, { seq: r.seq, kind: r.kind, label: r.label, values: {} });
    const rec = bySeq.get(r.seq);
    rec.kind = r.kind; rec.label = r.label;
    if (r.value != null) rec.values[r.ym] = Number(r.value);
  }
  const out = [...bySeq.values()].sort((a, b) => a.seq - b.seq).map((r) => {
    const isPct = r.kind === "pct";
    const strong = r.kind === "total" || r.kind === "computed";
    const tone = r.kind === "computed" && COMPUTED_TONE.test(r.label) ? "ebitda" : undefined;
    const total = isPct ? null : months.reduce((t, m) => t + (r.values[m] || 0), 0);
    return { kind: r.kind === "computed" ? "calc" : r.kind, label: r.label, values: r.values, total, isPct, strong, tone };
  });
  return { ready: true, loaded: true, years, year: yr, months, rows: out };
}

export { BOARDPACK_SCOPES };
