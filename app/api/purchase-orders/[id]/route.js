import { NextResponse } from "next/server";
import { getSession, hasRole, isAdmin } from "../../../../lib/auth";
import {
  getPo, updatePo, submitForSignoff, returnToDraft,
  approvePo, rejectPo, deletePo, setInvoice, closePo, challengePo, reopenFinance,
} from "../../../../lib/purchase-orders";
import { getApproverEmails } from "../../../../lib/dept-budget";
import { canDeletePo } from "../../../../lib/po-rules";

export const dynamic = "force-dynamic";

async function canApprove(session, department) {
  if (isAdmin(session)) return true;
  const emails = (await getApproverEmails(department)).map((e) => (e || "").toLowerCase());
  return emails.includes((session.email || "").toLowerCase());
}
const isFinance = (session) => hasRole(session, "ADMIN", "FINANCE");

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const po = await getPo(id);
  if (!po) return NextResponse.json({ error: "P.O not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...po });
}

// Mutating operations. `op` selects the action.
export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "update":
        return NextResponse.json(await updatePo(id, body.patch || {}, session));
      case "submit":
        return NextResponse.json(await submitForSignoff(id, session));
      case "return":
        return NextResponse.json(await returnToDraft(id, session));

      case "approve":
      case "reject": {
        const loaded = await getPo(id);
        if (!loaded) return NextResponse.json({ error: "P.O not found" }, { status: 404 });
        if (!(await canApprove(session, loaded.po.department))) {
          return NextResponse.json({ error: "Only this department's sign-off approvers (or an admin) can sign off" }, { status: 403 });
        }
        return NextResponse.json(await (body.op === "approve" ? approvePo(id, session) : rejectPo(id, session)));
      }

      case "delete": {
        const loaded = await getPo(id);
        if (!loaded) return NextResponse.json({ error: "P.O not found" }, { status: 404 });
        const gate = canDeletePo(loaded.po, { isAdmin: isAdmin(session) });
        if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });
        return NextResponse.json(await deletePo(id, session));
      }

      // ---- Finance: invoice / close / challenge / reopen (P.O Summary + Close) ----
      case "set-invoice":
      case "close":
      case "challenge":
      case "reopen-finance": {
        if (!isFinance(session)) return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
        if (body.op === "set-invoice") return NextResponse.json(await setInvoice(id, { invoice_number: body.invoice_number, invoice_amount: body.invoice_amount }, session));
        if (body.op === "close") return NextResponse.json(await closePo(id, { invoice_number: body.invoice_number, invoice_amount: body.invoice_amount }, session));
        if (body.op === "challenge") return NextResponse.json(await challengePo(id, { reasons: body.reasons || [], note: body.note || null }, session));
        return NextResponse.json(await reopenFinance(id, session));
      }

      default:
        return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
