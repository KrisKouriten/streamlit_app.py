import { getSession, hasRole } from "../../../../lib/auth";
import { getExpenseReport } from "../../../../lib/expenses";
import { departmentsHeadedBy } from "../../../../lib/dept-budget";
import { listDepartments } from "../../../../lib/governance";
import { expenseTabs, canSeeExpenses, pickExpenseTab, expensePeriod, claimExportRow, CONSOLIDATED } from "../../../../lib/expense-rules.js";
import { confidentialStamp } from "../../../../lib/reporting/watermark";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * GET — the claim lines Expense Claims is showing, as Excel: the same tab,
 * employee, year and period as the page (?tab=&emp=&year=&period=&from=&to=),
 * every line rather than the latest 500. Finance see any tab; a head of
 * department only their own, exactly as on the page.
 */
export async function GET(request) {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const isFinance = hasRole(session, "ADMIN", "FINANCE");
  const [headed, deptRows] = await Promise.all([
    isFinance ? [] : departmentsHeadedBy(session.email).catch(() => []),
    listDepartments().catch(() => []),
  ]);
  const access = expenseTabs({ isFinance, headed, departments: deptRows.map((d) => d.department_name) });
  const tab = pickExpenseTab(sp.get("tab"), access);
  if (!tab || !canSeeExpenses(tab, access)) return new Response("Expense claims are visible to Finance and to the head of the department", { status: 403 });

  const year = Number(sp.get("year")) || new Date().getFullYear();
  const period = expensePeriod({ year, period: sp.get("period") || "ytd", from: sp.get("from"), to: sp.get("to") });
  const department = tab === CONSOLIDATED ? null : tab;
  const r = await getExpenseReport({ year, department, claimant: department ? sp.get("emp") || null : null, period, allLines: true });
  if (!r.ready) return new Response("Expense claims are not loaded yet", { status: 404 });

  const rows = r.lines.map(claimExportRow);
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Date: "No claim lines for this selection" }]);
  ws["!cols"] = [{ wch: 11 }, { wch: 24 }, { wch: 20 }, { wch: 22 }, { wch: 48 }, { wch: 28 }, { wch: 9 }, { wch: 26 }, { wch: 22 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Claim lines");
  const scope = [department || "All departments", r.claimant, `${year} · ${period.label}`].filter(Boolean).join(" · ");
  const info = XLSX.utils.aoa_to_sheet([["Expense claims"], [scope], [`${rows.length} lines · net of VAT, £`], [], [confidentialStamp(session, new Date())]]);
  info["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, info, "About");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const slug = (department || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="expense-claims-${slug}-${period.from}-to-${period.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
