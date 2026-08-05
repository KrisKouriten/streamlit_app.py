import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestProcurementCsv, setBudget, addProcurementPurchase, hodApproveProcurement, financeApproveProcurement, cancelProcurement, deleteProcurement } from "../../../lib/procurement";

// Role gates per action. Raising / editing needs procurement management; the
// Head of Department (EXEC) signs off first, then Finance; only Finance can
// delete (once the Head of Department has approved — enforced in the data layer).
const MANAGE = ["ADMIN", "FINANCE", "OPS"];
const HOD = ["ADMIN", "EXEC"];
const FIN = ["ADMIN", "FINANCE"];

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  const deny = (roles, msg) => (hasRole(session, ...roles) ? null : NextResponse.json({ error: msg }, { status: 403 }));

  try {
    switch (body.action) {
      case "upload": {
        const d = deny(MANAGE, "Procurement entry requires ADMIN, FINANCE or OPS"); if (d) return d;
        if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await ingestProcurementCsv(body.csv, actor)) });
      }
      case "purchase": {
        const d = deny(MANAGE, "Procurement entry requires ADMIN, FINANCE or OPS"); if (d) return d;
        await addProcurementPurchase(body, actor);
        return NextResponse.json({ ok: true });
      }
      case "budget": {
        const d = deny(MANAGE, "Procurement entry requires ADMIN, FINANCE or OPS"); if (d) return d;
        const { source, ym, budget } = body;
        if (!["MINISO", "LOCAL"].includes(source) || !/^\d{4}-\d{2}$/.test(ym || "") || !Number.isFinite(Number(budget))) {
          return NextResponse.json({ error: "source, month (YYYY-MM) and a numeric budget are required" }, { status: 400 });
        }
        await setBudget({ source, ym, budget: Number(budget) }, actor);
        return NextResponse.json({ ok: true });
      }
      case "hod-approve": {
        const d = deny(HOD, "Head-of-Department approval requires the EXEC (head of department) or ADMIN role"); if (d) return d;
        return NextResponse.json(await hodApproveProcurement(body.id, actor));
      }
      case "finance-approve": {
        const d = deny(FIN, "Finance approval requires the FINANCE or ADMIN role"); if (d) return d;
        return NextResponse.json(await financeApproveProcurement(body.id, actor));
      }
      case "cancel": {
        const d = deny(MANAGE, "Cancelling requires ADMIN, FINANCE or OPS"); if (d) return d;
        return NextResponse.json(await cancelProcurement(body.id, body.reason, actor));
      }
      case "delete": {
        const d = deny(FIN, "Only Finance can delete a procurement order"); if (d) return d;
        return NextResponse.json(await deleteProcurement(body.id, actor, { isFinance: hasRole(session, "FINANCE"), isAdmin: hasRole(session, "ADMIN") }));
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("procurement API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
