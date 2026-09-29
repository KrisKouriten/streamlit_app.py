import { query, getPool, connectionTarget } from "./db";
import { audit, listDepartments, getAppSetting, setAppSetting } from "./governance";
import { listBudgets, getBudget } from "./dept-budget";
import { monthlyTotals, grandTotal } from "./dept-budget-rules.js";
import { parseExpenseCsv, resolveDepartment, deptKey, summariseExpenses } from "./expense-rules.js";

/*
 * Expense claims — the DB layer. The export is parsed and summarised in
 * lib/expense-rules.js; this stores it, maps its departments onto the app's,
 * and reads each department's Travel, Expenses & Entertainment budget (TEE)
 * to report against.
 */

/*
 * Creating the expense tables from inside the app.
 *
 * Migration 117 applied in a SQL editor can land on a different Neon branch
 * from the one the app reads — the page then goes on saying "one migration to
 * run" after it has been run. The app cannot be wrong about its own
 * connection, so Finance can create the tables from the page instead. These
 * are migration 117's own statements (pinned to the file by
 * tests/expense-rules.test.mjs): CREATE TABLE / INDEX IF NOT EXISTS, nothing
 * else, and safe to run again.
 */
export const EXPENSE_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS finance.expense_claim_upload (
  upload_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename     varchar(240),
  line_count   integer NOT NULL DEFAULT 0,
  date_from    date,
  date_to      date,
  net_total    numeric(14,2),
  replaced     integer NOT NULL DEFAULT 0,       -- lines in that range the upload replaced
  uploaded_by  varchar(160),
  uploaded_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS finance.expense_claim_line (
  line_id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id           bigint REFERENCES finance.expense_claim_upload(upload_id) ON DELETE CASCADE,
  claimant            varchar(160) NOT NULL,
  department          varchar(120),              -- as named in the export
  claim_date          date NOT NULL,
  due_date            date,
  description         varchar(400),
  quantity            numeric(14,4),
  unit_amount         numeric(14,4),
  net_amount          numeric(14,2) NOT NULL,    -- before VAT
  tax_amount          numeric(14,2) NOT NULL DEFAULT 0,
  account_code        varchar(20),
  tax_type            varchar(60),
  store_tracking      varchar(120),              -- Xero tracking "Store"
  allocation_tracking varchar(120),              -- Xero tracking "Allocation"
  status              varchar(30)
)`,
  `CREATE INDEX IF NOT EXISTS ix_expense_claim_line_date ON finance.expense_claim_line (claim_date)`,
  `CREATE INDEX IF NOT EXISTS ix_expense_claim_line_dept ON finance.expense_claim_line (department)`,
];

export async function createExpenseTables(actor) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const sql of EXPENSE_TABLES_SQL) await client.query(sql);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  const target = connectionTarget();
  await audit({ actor, eventType: "expenses.create_tables", objectType: "migration", objectRef: "117_expense_claims.sql", detail: { host: target.host, database: target.database } });
  return { ok: true, target: { host: target.host, database: target.database } };
}

// Where the app is reading — host and database name only, never credentials.
export function expenseDbTarget() {
  const t = connectionTarget();
  return { host: t.host, database: t.database };
}

const absent = (e) => e?.code === "42P01" || e?.code === "42703";
const MAP_KEY = "expense_department_map";

export async function getDeptMap() {
  try { return JSON.parse((await getAppSetting(MAP_KEY, "{}")) || "{}") || {}; } catch { return {}; }
}

// Map one export department onto an app department (or clear it with null).
export async function setDeptMapping(fileDept, appDept, actor) {
  const map = await getDeptMap();
  const k = deptKey(fileDept);
  if (!k) throw new Error("No department given");
  if (appDept) map[k] = String(appDept); else delete map[k];
  await setAppSetting(MAP_KEY, JSON.stringify(map), actor);
  await audit({ actor, eventType: "expenses.department_map", objectType: "expense_department", objectRef: String(fileDept), detail: { appDept: appDept || null } });
  return { ok: true };
}

/*
 * Load an export. One transaction: every line dated within the file's own date
 * range is replaced, so the same year-to-date export can be loaded again each
 * month without doubling up.
 */
export async function uploadExpenses(text, { filename = "" } = {}, actor) {
  const p = parseExpenseCsv(text);
  if (!p.lines.length) throw new Error(p.errors[0] || "No expense lines found in that file");
  const who = actor?.email || actor?.name || null;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rowCount: replaced } = await client.query(
      `DELETE FROM finance.expense_claim_line WHERE claim_date BETWEEN $1 AND $2`, [p.dateFrom, p.dateTo]);
    const { rows: up } = await client.query(
      `INSERT INTO finance.expense_claim_upload (filename, line_count, date_from, date_to, net_total, replaced, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING upload_id`,
      [String(filename || "").slice(0, 240), p.lines.length, p.dateFrom, p.dateTo, p.netTotal, replaced, who]);
    const uploadId = Number(up[0].upload_id);
    const L = p.lines;
    const cols = (k) => L.map((l) => l[k]);
    await client.query(
      `INSERT INTO finance.expense_claim_line (upload_id, claimant, department, claim_date, due_date, description, quantity,
         unit_amount, net_amount, tax_amount, account_code, tax_type, store_tracking, allocation_tracking, status)
       SELECT $1, * FROM unnest($2::varchar[], $3::varchar[], $4::date[], $5::date[], $6::varchar[], $7::numeric[],
         $8::numeric[], $9::numeric[], $10::numeric[], $11::varchar[], $12::varchar[], $13::varchar[], $14::varchar[], $15::varchar[])`,
      [uploadId, cols("claimant"), cols("department"), cols("claim_date"), cols("due_date"), cols("description"), cols("quantity"),
       cols("unit_amount"), cols("net_amount"), cols("tax_amount"), cols("account_code"), cols("tax_type"), cols("store_tracking"),
       cols("allocation_tracking"), cols("status")]);
    await client.query("COMMIT");
    const depts = (await listDepartments().catch(() => [])).map((d) => d.department_name);
    const map = await getDeptMap();
    const unmapped = p.departments.filter((d) => !resolveDepartment(d, depts, map));
    await audit({ actor, eventType: "expenses.upload", objectType: "expense_claim_upload", objectRef: String(uploadId),
      detail: { filename, lines: p.lines.length, replaced, dateFrom: p.dateFrom, dateTo: p.dateTo, net: p.netTotal } });
    return { ok: true, uploadId, lines: p.lines.length, replaced, dateFrom: p.dateFrom, dateTo: p.dateTo, net: p.netTotal, vat: p.taxTotal, unmapped, skipped: p.errors };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/*
 * Each department's T&E budget for a year: the LOCKED one if there is one,
 * else the most recently edited. → { department: { budgetId, total, months: [12] } }
 */
export async function teeBudgets(year) {
  const { budgets = [] } = await listBudgets({ year }).catch(() => ({ budgets: [] }));
  const byDept = new Map();
  for (const b of budgets) {
    if ((b.budget_type || "BUSINESS") !== "TEE" || !b.department) continue;
    const cur = byDept.get(b.department);
    const better = !cur
      || (b.status === "LOCKED" && cur.status !== "LOCKED")
      || (b.status === cur.status && new Date(b.updated_at) > new Date(cur.updated_at));
    if (better) byDept.set(b.department, b);
  }
  const out = {};
  for (const [dept, b] of byDept) {
    const full = await getBudget(b.budget_id).catch(() => null);
    if (!full) continue;
    out[dept] = { budgetId: b.budget_id, status: b.status, total: grandTotal(full.lines), months: monthlyTotals(full.lines) };
  }
  return out;
}

// Every claim line for a year, with its department mapped onto the app's.
async function linesForYear(year) {
  const { rows } = await query(
    `SELECT line_id, claimant, department AS file_department, to_char(claim_date,'YYYY-MM-DD') AS claim_date,
            description, net_amount, tax_amount, account_code, tax_type, store_tracking, allocation_tracking
       FROM finance.expense_claim_line
      WHERE claim_date BETWEEN $1 AND $2
      ORDER BY claim_date DESC, line_id DESC`, [`${year}-01-01`, `${year}-12-31`]);
  const [depts, map] = await Promise.all([
    listDepartments().catch(() => []).then((r) => r.map((d) => d.department_name)),
    getDeptMap(),
  ]);
  return {
    depts, map,
    lines: rows.map((r) => ({
      ...r, net_amount: Number(r.net_amount) || 0, tax_amount: Number(r.tax_amount) || 0,
      department: resolveDepartment(r.file_department, depts, map) || (r.file_department ? `${r.file_department} (unmapped)` : "Unmapped"),
      team: r.file_department || null,
      mapped: !!resolveDepartment(r.file_department, depts, map),
    })),
  };
}

/*
 * The expense report for a year, optionally for one department.
 *   → { ready, year, years, summary, lines (latest first, capped), uploads, unmapped: [{ fileDept, lines, net }], departments }
 */
export async function getExpenseReport({ year = new Date().getFullYear(), department = null } = {}) {
  try {
    const [{ depts, map, lines }, budgets, { rows: yrs }, { rows: uploads }] = await Promise.all([
      linesForYear(year),
      teeBudgets(year),
      query(`SELECT DISTINCT EXTRACT(YEAR FROM claim_date)::int AS y FROM finance.expense_claim_line ORDER BY y DESC`),
      query(`SELECT upload_id, filename, line_count, to_char(date_from,'YYYY-MM-DD') AS date_from, to_char(date_to,'YYYY-MM-DD') AS date_to,
                    net_total, replaced, uploaded_by, uploaded_at FROM finance.expense_claim_upload ORDER BY uploaded_at DESC LIMIT 10`),
    ]);
    const mine = department ? lines.filter((l) => l.department === department) : lines;
    const scopedBudgets = department ? (budgets[department] ? { [department]: budgets[department] } : {}) : budgets;
    const unmappedMap = new Map();
    for (const l of lines) {
      if (l.mapped || !l.file_department) continue;
      const e = unmappedMap.get(l.file_department) || { fileDept: l.file_department, lines: 0, net: 0 };
      e.lines += 1; e.net += l.net_amount;
      unmappedMap.set(l.file_department, e);
    }
    return {
      ready: true, year: Number(year), department,
      years: yrs.map((r) => r.y),
      summary: summariseExpenses(mine, { year, budgets: scopedBudgets }),
      lines: mine.slice(0, 500),
      lineCount: mine.length,
      uploads: uploads.map((u) => ({ ...u, net_total: Number(u.net_total) || 0 })),
      unmapped: [...unmappedMap.values()].map((e) => ({ ...e, net: Math.round(e.net * 100) / 100 })).sort((a, b) => b.net - a.net),
      departments: depts,
      map,
    };
  } catch (e) {
    if (absent(e)) return { ready: false };
    throw e;
  }
}

/*
 * One department's T&E position for the department dashboard: its T&E budget
 * and the claims against it this year. Null before migration 117.
 */
export async function deptExpensePosition(department, year) {
  const r = await getExpenseReport({ year, department }).catch(() => ({ ready: false }));
  if (!r.ready) return null;
  const d = r.summary.departments.find((x) => x.department === department) || null;
  return {
    year: r.year, department,
    net: d?.net || 0, vat: d?.vat || 0, lines: d?.lines || 0,
    budget: d?.budget ?? null, budgetYtd: d?.budgetYtd ?? null, remaining: d?.remaining ?? null,
    months: d?.months || Array(12).fill(0), budgetMonths: d?.budgetMonths || null,
    teams: d?.teams || [],
    lastMonth: r.summary.lastMonth,
    categories: r.summary.categories.slice(0, 8),
    claimants: r.summary.claimantsList.slice(0, 10),
    hasData: r.lineCount > 0,
  };
}

/*
 * T&E budgets overspent this year, for the Executive Intelligence Hub:
 * departments whose claims so far exceed their T&E budget for the months
 * claimed (or the whole year's budget).
 */
export async function teeOverspends(year = new Date().getFullYear()) {
  const r = await getExpenseReport({ year }).catch(() => ({ ready: false }));
  if (!r.ready) return [];
  return r.summary.departments
    .filter((d) => d.budget != null && (d.overYtd || d.over))
    .map((d) => ({ department: d.department, net: d.net, budget: d.budget, budgetYtd: d.budgetYtd, lastMonth: r.summary.lastMonth, over: d.over }));
}
