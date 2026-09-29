import test from "node:test";
import assert from "node:assert/strict";
import {
  exportDate, claimantName, storeFromTracking, parseExpenseCsv, deptKey, resolveDepartment, summariseExpenses, accountName,
  expenseTabs, pickExpenseTab, canSeeExpenses, CONSOLIDATED,
  TEE_LINES, teeLineOf, teeLineName, parseTeeBudgetRows, teeTemplateRows, toCsv, pickTeeBudget,
} from "../lib/expense-rules.js";
import { teeBudgetAttention } from "../lib/hub-attention-rules.js";

const HEAD = "ContactName,EmailAddress,InvoiceNumber,InvoiceDate,DueDate,Total,TaxTotal,Description,Quantity,UnitAmount,LineAmount,AccountCode,TaxType,TaxAmount,TrackingName1,TrackingOption1,TrackingName2,TrackingOption2,Currency,Type,Status,Department";
const CSV = [
  HEAD,
  'Alex Norgate,a@x.com,Expense Claims,1/31/2026,2/5/2026,3.8,0.63,"Transport for London - Store visit, SHAFTSBURY",1,3.1667,3.17,266,20% (VAT on Expenses),0.63,Store,,Allocation,,GBP,Bill,Paid,Marketing',
  'Saad Usman (saad@x.com),saad@x.com,Expense Claims,2/14/2026,2/20/2026,326,0,Client dinner,1,326,326,420,No VAT,0,Store,13 Oxford Street,Allocation,,GBP,Bill,Paid,C-Suite',
  'Becky Moore,b@x.com,Expense Claims,12/20/2025,1/5/2026,12,2,Parking,1,10,10,266,20% (VAT on Expenses),2,Store,,Allocation,,GBP,Bill,Paid,Build & Architecture',
].join("\n");

test("exportDate reads Xero's month-first dates", () => {
  assert.equal(exportDate("1/31/2026"), "2026-01-31");
  assert.equal(exportDate("2026-03-04"), "2026-03-04");
  assert.equal(exportDate("31/1/2026"), null);
  assert.equal(exportDate(""), null);
});

test("claimantName drops an email in brackets; storeFromTracking drops the store number", () => {
  assert.equal(claimantName("Saad Usman (saad@x.com)"), "Saad Usman");
  assert.equal(claimantName("Alex Norgate"), "Alex Norgate");
  assert.equal(storeFromTracking("13 Oxford Street"), "Oxford Street");
  assert.equal(accountName("266"), "Mileage & Travelling");
  assert.equal(accountName("699"), "Account 699");
});

test("parseExpenseCsv reads the export: net line amount, VAT, date range, departments", () => {
  const p = parseExpenseCsv(CSV);
  assert.deepEqual(p.errors, []);
  assert.equal(p.lines.length, 3);
  assert.equal(p.lines[0].net_amount, 3.17);
  assert.equal(p.lines[0].tax_amount, 0.63);
  assert.equal(p.lines[0].description, "Transport for London - Store visit, SHAFTSBURY");
  assert.equal(p.lines[1].claimant, "Saad Usman");
  assert.equal(p.dateFrom, "2025-12-20");
  assert.equal(p.dateTo, "2026-02-14");
  assert.equal(p.netTotal, 339.17);
  assert.deepEqual(p.departments, ["Build & Architecture", "C-Suite", "Marketing"]);
  assert.match(parseExpenseCsv("a,b\n1,2").errors[0], /isn't the Xero expense-claims export/);
});

test("departments match loosely, and a saved mapping wins", () => {
  const app = ["Architecture & Build", "Marketing", "Operations"];
  assert.equal(deptKey("Build & Architecture"), deptKey("Architecture and Build"));
  assert.equal(resolveDepartment("Build & Architecture", app, {}), "Architecture & Build");
  assert.equal(resolveDepartment("marketing", app, {}), "Marketing");
  // Head Office and Store Operations are both Operations, by default.
  assert.equal(resolveDepartment("Head Office Operations", app, {}), "Operations");
  assert.equal(resolveDepartment("Store Operations", app, {}), "Operations");
  assert.equal(resolveDepartment("Legal", app, {}), null);
  assert.equal(resolveDepartment("Head Office Operations", app, { [deptKey("Head Office Operations")]: "Marketing" }), "Marketing");
});

test("summariseExpenses reports the year by department against its T&E budget to date", () => {
  const lines = [
    { department: "Marketing", claimant: "A", claim_date: "2026-01-10", net_amount: 100, tax_amount: 20, account_code: "266" },
    { department: "Marketing", claimant: "A", claim_date: "2026-02-10", net_amount: 250, tax_amount: 0, account_code: "495", store_tracking: "13 Oxford Street" },
    { department: "HR", claimant: "B", claim_date: "2026-02-11", net_amount: 40, tax_amount: 0, account_code: "266" },
    { department: "HR", claimant: "B", claim_date: "2025-12-11", net_amount: 999, tax_amount: 0, account_code: "266" },   // other year
  ];
  const months = Array(12).fill(100);                     // £100 a month, £1,200 a year
  const s = summariseExpenses(lines, { year: 2026, budgets: { Marketing: { total: 1200, months }, Finance: { total: 600, months: Array(12).fill(50) } } });
  assert.equal(s.net, 390);
  assert.equal(s.lastMonth, 2);
  const mk = s.departments.find((d) => d.department === "Marketing");
  assert.equal(mk.budgetYtd, 200);                        // Jan + Feb
  assert.equal(mk.overYtd, true);                         // £350 claimed vs £200 to date
  assert.equal(mk.over, false);
  assert.equal(mk.remaining, 850);
  assert.deepEqual(mk.months.slice(0, 3), [100, 250, 0]);
  const fin = s.departments.find((d) => d.department === "Finance");
  assert.equal(fin.net, 0);                               // a budget with no claims still shows
  assert.equal(s.departments.find((d) => d.department === "HR").budget, null);
  assert.deepEqual(s.categories.map((c) => c.key), ["Subsistence", "Mileage & Travelling"]);
  assert.deepEqual(s.stores.map((c) => c.key), ["Oxford Street"]);
});

test("teeBudgetAttention flags a department over its T&E budget to date, CRITICAL over the year", () => {
  const items = teeBudgetAttention([
    { department: "Marketing", net: 350, budget: 1200, budgetYtd: 200, lastMonth: 2, over: false },
    { department: "HR", net: 1300, budget: 1200, budgetYtd: 1000, lastMonth: 10, over: true },
    { department: "Finance", net: 50, budget: 600, budgetYtd: 100, lastMonth: 2, over: false },
  ]);
  assert.deepEqual(items.map((i) => [i.headline, i.severity]), [
    ["Marketing · Travel, Expenses & Entertainment: over budget by £150", "HIGH"],
    ["HR · Travel, Expenses & Entertainment: over budget by £100", "CRITICAL"],
  ]);
});

test("summariseExpenses keeps Head Office and Store Operations visible within Operations", () => {
  const lines = [
    { department: "Operations", team: "Head Office Operations", claimant: "A", claim_date: "2026-03-01", net_amount: 300, tax_amount: 0, account_code: "266" },
    { department: "Operations", team: "Store Operations", claimant: "B", claim_date: "2026-04-01", net_amount: 100, tax_amount: 0, account_code: "266" },
    { department: "Operations", team: "Operations", claimant: "C", claim_date: "2026-04-02", net_amount: 50, tax_amount: 0, account_code: "266" },
    { department: "Marketing", team: "Marketing", claimant: "D", claim_date: "2026-04-02", net_amount: 20, tax_amount: 0, account_code: "266" },
  ];
  const s = summariseExpenses(lines, { year: 2026 });
  const ops = s.departments.find((d) => d.department === "Operations");
  assert.equal(ops.net, 450);
  assert.deepEqual(ops.teams.map((t) => [t.key, t.net]), [["Head Office Operations", 300], ["Store Operations", 100], ["Operations", 50]]);
  assert.equal(ops.teams[0].months[2], 300);
  assert.deepEqual(s.departments.find((d) => d.department === "Marketing").teams, []);
});

test("the in-app table set-up is migration 117's own statements, and only creates", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("lib/expenses.js", "utf8");
  const mig = fs.readFileSync("db/migrations/117_expense_claims.sql", "utf8");
  const block = src.slice(src.indexOf("EXPENSE_TABLES_SQL = ["), src.indexOf("];", src.indexOf("EXPENSE_TABLES_SQL = [")));
  const stmts = [...block.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.equal(stmts.length, 4);
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  for (const st of stmts) {
    assert.match(st, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
    assert.ok(norm(mig).includes(norm(st)), `not in migration 117: ${st.slice(0, 60)}`);
  }
});

test("Expense Claims tabs: Finance see Consolidated and every department; a head only their own", () => {
  const all = ["Marketing", "HR", "Operations"];
  const fin = expenseTabs({ isFinance: true, departments: all });
  assert.deepEqual(fin.tabs.map((t) => t.key), [CONSOLIDATED, "HR", "Marketing", "Operations"]);
  assert.equal(pickExpenseTab(undefined, fin), CONSOLIDATED);
  assert.equal(pickExpenseTab("HR", fin), "HR");

  const head = expenseTabs({ isFinance: false, headed: ["Marketing"], departments: all });
  assert.deepEqual(head.tabs.map((t) => t.key), ["Marketing"]);
  assert.equal(head.consolidated, false);
  assert.equal(pickExpenseTab(CONSOLIDATED, head), "Marketing");     // asked for Consolidated, gets their own
  assert.equal(pickExpenseTab("HR", head), "Marketing");             // cannot open another department
  assert.equal(canSeeExpenses("HR", head), false);
  assert.equal(canSeeExpenses(CONSOLIDATED, head), false);

  const nobody = expenseTabs({ isFinance: false, headed: [], departments: all });
  assert.equal(pickExpenseTab("Marketing", nobody), null);
});

test("teeLineOf sorts each claim onto a T&E budget line", () => {
  assert.equal(teeLineOf({ account_code: "266", description: "Store visit SHAFTSBURY - Mileage" }), "Mileage");
  assert.equal(teeLineOf({ account_code: "266", description: "Transport for London - Store visit" }), "Travel");
  assert.equal(teeLineOf({ account_code: "266", description: "Premier Inn - Glasgow opening" }), "Accommodation");
  assert.equal(teeLineOf({ account_code: "266", description: "Pret - lunch on store visit" }), "Subsistence");
  assert.equal(teeLineOf({ account_code: "495", description: "costa - breakfast" }), "Subsistence");
  assert.equal(teeLineOf({ account_code: "420", description: "Team drinks" }), "Staff Entertainment");
  assert.equal(teeLineOf({ account_code: "420", description: "Dinner with client from Boots" }), "Client Entertainment");
  assert.equal(teeLineOf({ account_code: "424", description: "Dinner" }), "Client Entertainment");
  assert.equal(teeLineOf({ account_code: "425", description: "Stride Courier Services" }), "Postage/Courier");
  assert.equal(teeLineOf({ account_code: "279", description: "AWS fees" }), "IT/Software");
  assert.equal(teeLineOf({ account_code: "489", description: "Three PAYG Sim" }), "Telephone");
  assert.equal(teeLineOf({ account_code: "400", description: "Amazon order for penpen on tour" }), "Marketing/Event Costs");
  assert.equal(teeLineOf({ account_code: "461", description: "Toners" }), "Office Supplies");
  assert.equal(teeLineOf({ account_code: "473", description: "Replacement LED lamps" }), "Store/Operational Purchases");
  assert.equal(teeLineOf({ account_code: "484", description: "First aid training course" }), "Training");
  assert.equal(teeLineOf({ account_code: "999", description: "Something" }), "Other");
  assert.equal(TEE_LINES.length, 15);
});

test("teeLineName reads the line names loosely", () => {
  assert.equal(teeLineName("postage / courier"), "Postage/Courier");
  assert.equal(teeLineName("IT & Software"), "IT/Software");
  assert.equal(teeLineName("Store / Operational Purchases"), "Store/Operational Purchases");
  assert.equal(teeLineName("client entertaining"), "Client Entertainment");
  assert.equal(teeLineName("Biscuits"), null);
});

test("parseTeeBudgetRows reads the template: a budget per department and year, lines by month", () => {
  const rows = teeTemplateRows(2027, ["Marketing"], { Marketing: { Travel: 1234.5 } });
  assert.equal(rows.length, 1 + TEE_LINES.length);
  assert.equal(rows[1][15], 1234.5);                                   // reference column
  rows[1].splice(3, 12, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, "£1,100");
  rows[3].splice(3, 12, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  rows.push([2027, "HR", "Mileage", 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  rows.push([2027, "HR", "Biscuits", 10]);
  const p = parseTeeBudgetRows(rows);
  assert.equal(p.budgets.length, 2);
  const mk = p.budgets.find((b) => b.department === "Marketing");
  assert.equal(mk.year, 2027);
  assert.deepEqual(mk.lines.find((l) => l.label === "Travel").months.slice(10), [100, 1100]);
  assert.equal(mk.lines.length, TEE_LINES.length);
  assert.equal(p.errors.length, 1);
  assert.match(p.errors[0], /not one of the T&E budget lines/);
  assert.match(toCsv([["a,b", 'q"x']]), /"a,b","q""x"/);
});

test("summariseExpenses compares budget and claims line by line", () => {
  const lines = [
    { department: "Marketing", claimant: "A", claim_date: "2026-01-10", net_amount: 60, tax_amount: 0, account_code: "266", description: "Mileage" },
    { department: "Marketing", claimant: "A", claim_date: "2026-02-10", net_amount: 40, tax_amount: 0, account_code: "495", description: "lunch" },
  ];
  const months = (v) => Array(12).fill(v);
  const s = summariseExpenses(lines, { year: 2026, budgets: { Marketing: { total: 360, months: months(30), lines: { Mileage: months(20), Training: months(10) } } } });
  const bl = s.departments.find((d) => d.department === "Marketing").budgetLines;
  assert.deepEqual(bl.map((r) => [r.line, r.net, r.budgetYtd, r.budget]), [
    ["Mileage", 60, 40, 240], ["Subsistence", 40, null, null], ["Training", 0, 20, 120],
  ]);
});

test("pickTeeBudget: the T&E budget furthest through approval counts, then the newest", () => {
  const b = (id, status, updated, type = "TEE") => ({ budget_id: id, status, updated_at: updated, budget_type: type });
  assert.equal(pickTeeBudget([]), null);
  assert.equal(pickTeeBudget([b(1, "DRAFT", "2026-09-01", "BUSINESS")]), null);
  // An older submitted budget wins over a newer draft — so the upload must write to it, not the draft.
  assert.equal(pickTeeBudget([b(1, "DRAFT", "2026-09-29"), b(2, "FINANCE_REVIEW", "2026-06-01")]).budget_id, 2);
  assert.equal(pickTeeBudget([b(1, "LOCKED", "2026-01-01"), b(2, "SLT_APPROVAL", "2026-09-01")]).budget_id, 1);
  assert.equal(pickTeeBudget([b(1, "DRAFT", "2026-01-01"), b(2, "DRAFT", "2026-09-01")]).budget_id, 2);
});
