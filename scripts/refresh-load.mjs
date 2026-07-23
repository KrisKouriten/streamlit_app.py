#!/usr/bin/env node
/*
 * Joiin refresh loader (used by the scheduled refresh Routine and for manual
 * loads). Parses saved Joiin report markdown and upserts into the finance DB at
 * process.env.DATABASE_URL — which MUST point at Neon for a production refresh.
 *
 *   node scripts/refresh-load.mjs consolidated <dir>   # *.md -> finance.joiin_pl
 *   node scripts/refresh-load.mjs by-company   <dir>   # *.md -> finance.joiin_pl_entity
 *
 * Each by-company file is named for its month (YYYY-MM.md). Idempotent: clears
 * the covered months, then upserts. Reconciliation (derived net vs the report's
 * Net Profit memo) is printed for the consolidated load.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { parseJoiinPnl, parseJoiinByCompany, summariseJoiinPnl } = await import(`${ROOT}/lib/joiin-rules.js`);
const { ENTITY_ID } = await import(`${ROOT}/lib/entity-map.js`);
const { query } = await import(`${ROOT}/lib/db.js`);

const [mode, dir] = process.argv.slice(2);
if (!["consolidated", "by-company"].includes(mode) || !dir) {
  console.error("usage: node scripts/refresh-load.mjs <consolidated|by-company> <dir>");
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
if (!files.length) { console.error(`No .md files in ${dir}`); process.exit(1); }

if (mode === "consolidated") {
  let rows = [];
  for (const f of files) {
    const parsed = parseJoiinPnl(fs.readFileSync(path.join(dir, f), "utf8"));
    rows = rows.concat(parsed.rows);
    const s = summariseJoiinPnl(parsed);
    for (const ym of parsed.months) {
      const d = s[ym].net_memo == null ? "n/a" : Math.round(s[ym].netResult - s[ym].net_memo);
      console.log(`  ${f} ${ym}: derived net £${Math.round(s[ym].netResult).toLocaleString()} (diff ${d})`);
    }
  }
  const months = [...new Set(rows.map((r) => r.ym))];
  await query(`DELETE FROM finance.joiin_pl WHERE ym = ANY($1)`, [months]);
  for (const r of rows) {
    await query(
      `INSERT INTO finance.joiin_pl (section, account, ym, value, updated_by) VALUES ($1,$2,$3,$4,'joiin-refresh')
       ON CONFLICT (section, account, ym) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
      [r.section, r.account, r.ym, r.value]
    );
  }
  console.log(`consolidated: loaded ${rows.length} rows across ${months.length} month(s)`);
} else {
  let all = [];
  for (const f of files) {
    const ym = f.replace(".md", "");
    const parsed = parseJoiinByCompany(fs.readFileSync(path.join(dir, f), "utf8"), ym);
    const unmatched = parsed.entities.filter((e) => !ENTITY_ID[e]);
    if (unmatched.length) console.log(`  WARN ${f}: unmapped entities ${unmatched.join(", ")}`);
    for (const r of parsed.rows) all.push({ ...r, ym, entity_id: ENTITY_ID[r.entity_name] || r.entity_name });
    console.log(`  ${f}: ${parsed.entities.length} entities, ${parsed.rows.length} rows`);
  }
  const months = [...new Set(all.map((r) => r.ym))];
  await query(`DELETE FROM finance.joiin_pl_entity WHERE ym = ANY($1)`, [months]);
  for (const r of all) {
    await query(
      `INSERT INTO finance.joiin_pl_entity (entity_id, entity_name, section, account, ym, value, updated_by) VALUES ($1,$2,$3,$4,$5,$6,'joiin-refresh')
       ON CONFLICT (entity_id, section, account, ym) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
      [r.entity_id, r.entity_name, r.section, r.account, r.ym, r.value]
    );
  }
  console.log(`by-company: loaded ${all.length} rows across ${months.length} month(s)`);
}
process.exit(0);
