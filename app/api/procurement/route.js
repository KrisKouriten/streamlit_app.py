import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestProcurementCsv, setBudget, addProcurementPurchase, hodApproveProcurement, financeApproveProcurement, cancelProcurement, deleteProcurement, amendProcurementSupplier } from "../../../lib/procurement";
import { setFxRate } from "../../../lib/fx";
import { getApproverEmails } from "../../../lib/dept-budget";
import { resolveBaseUrl } from "../../../lib/invite-rules";
import { notifyMerchAwaitingHod, notifyMerchHodApproved } from "../../../lib/workflow-notify";

// Role gates per action. Raising / editing needs procurement management; the
// Head of Department (EXEC, or the Merchandising Department sign-off approver)
// signs off first, then Finance; only Finance can delete (once the Head of
// Department has approved — enforced in the data layer).
const MANAGE = ["ADMIN", "FINANCE", "OPS"];
const FIN = ["ADMIN", "FINANCE"];
const SOURCE_LABEL = { MINISO: "Miniso HQ", LOCAL: "Local" };

function baseUrlOf(request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin") || (host ? `${request.headers.get("x-forwarded-proto") || "https"}://${host}` : null);
  return resolveBaseUrl({ origin, env: process.env });
}

// The procurement head-of-department sign-off is the Merchandising Department
// sign-off approver (e.g. Becky), or a Head/admin role.
async function isMerchApprover(session) {
  if (hasRole(session, "ADMIN")) return true;
  const emails = (await getApproverEmails("Merchandising").catch(() => [])).map((e) => (e || "").toLowerCase());
  return emails.includes((session.email || "").toLowerCase());
}


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
        const res = await addProcurementPurchase(body, actor);
        // Ping the head of department (the Merchandising Department sign-off, e.g.
        // Becky) that an order is waiting for sign-off (best-effort — never blocks).
        try {
          const hodEmails = await getApproverEmails("Merchandising").catch(() => []);
          await notifyMerchAwaitingHod({
            request: { purchaseId: res.purchaseId, submitter: actor, channel: SOURCE_LABEL[body.source] || body.source, supplier: body.supplier, value: body.amount_gbp },
            hodEmails, baseUrl: baseUrlOf(request),
          });
        } catch (e) { console.error("procurement raise notify failed:", e.message); }
        return NextResponse.json(res);
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
        if (!hasRole(session, "EXEC") && !(await isMerchApprover(session))) {
          return NextResponse.json({ error: "Head-of-Department sign-off requires the Merchandising Department sign-off, the EXEC role, or ADMIN" }, { status: 403 });
        }
        const res = await hodApproveProcurement(body.id, actor);
        // Now it's the head of department's approval → tell Finance it's ready to
        // take forward on Procurement Summary + Close (best-effort).
        try {
          const o = res.order || {};
          await notifyMerchHodApproved({
            request: { purchaseId: o.purchase_id, submitter: o.created_by, approver: actor, channel: SOURCE_LABEL[o.source] || o.source, supplier: o.supplier, value: o.amount_gbp },
            baseUrl: baseUrlOf(request),
          });
        } catch (e) { console.error("procurement hod-approve notify failed:", e.message); }
        return NextResponse.json(res);
      }
      case "finance-approve": {
        const d = deny(FIN, "Finance approval requires the FINANCE or ADMIN role"); if (d) return d;
        return NextResponse.json(await financeApproveProcurement(body.id, actor, { cost_rate_type: body.cost_rate_type, stock_rate_type: body.stock_rate_type }));
      }
      case "set-fx-rate": {
        const d = deny(FIN, "Setting exchange rates requires the FINANCE or ADMIN role"); if (d) return d;
        return NextResponse.json(await setFxRate(body, actor));
      }
      case "cancel": {
        const d = deny(MANAGE, "Cancelling requires ADMIN, FINANCE or OPS"); if (d) return d;
        return NextResponse.json(await cancelProcurement(body.id, body.reason, actor));
      }
      case "edit-supplier": {
        const d = deny(MANAGE, "Editing an order requires ADMIN, FINANCE or OPS"); if (d) return d;
        return NextResponse.json(await amendProcurementSupplier(body.id, { supplier: body.supplier, reference: body.reference }, actor));
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
