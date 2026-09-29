import { getSession, hasRole } from "../../../../lib/auth";
import { teeBudgetTemplate } from "../../../../lib/expenses";
import { toCsv } from "../../../../lib/expense-rules.js";

export const dynamic = "force-dynamic";

// GET ?year= — the T&E budget template as CSV: every department × line, with
// claims to date as a reference column. Finance / admin only.
export async function GET(request) {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return new Response("T&E budgets are loaded by Finance", { status: 403 });
  const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear();
  const csv = toCsv(await teeBudgetTemplate(year));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="te-budget-template-${year}.csv"`,
    },
  });
}
