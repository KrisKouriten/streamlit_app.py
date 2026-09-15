import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../../lib/auth";
import { transitionMerchRequest, setRequestException, generatePoFromRequest, getMerchRequest } from "../../../../../lib/otb-procurement";
import { getApproverEmails } from "../../../../../lib/dept-budget";
import { resolveBaseUrl } from "../../../../../lib/invite-rules";
import { notifyMerchAwaitingHod, notifyMerchHodApproved, notifyMerchReturned } from "../../../../../lib/workflow-notify";
import { CHANNEL_LABEL } from "../../../../../lib/otb-rules";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");
const canApprove = (s) => hasRole(s, "ADMIN", "FINANCE");

function baseUrlOf(request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin")
    || (host ? `${request.headers.get("x-forwarded-proto") || "https"}://${host}` : null);
  return resolveBaseUrl({ origin, env: process.env });
}

// Is this session a Merchandising Department sign-off approver (the procurement
// head-of-department, e.g. Becky)? Admins always qualify.
async function isMerchApprover(session) {
  if (hasRole(session, "ADMIN")) return true;
  const emails = (await getApproverEmails("Merchandising").catch(() => [])).map((e) => (e || "").toLowerCase());
  return emails.includes((session.email || "").toLowerCase());
}

// The request's channel + value etc. for a notification payload.
function notifyReq(req, session) {
  return {
    purchaseId: req.purchase_id,
    submitter: req.created_by,
    approver: session.email || session.name,
    channel: CHANNEL_LABEL[req.channel_code] || req.channel_code,
    supplier: req.supplier,
    value: req.amount_gbp,
    period: req.otb_period,
    reason: req.reason,
  };
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // The head-of-department sign-off (Merchandising approver) can act even without a
  // management role; everyone else needs ADMIN/FINANCE/OPS to touch a request.
  const merchApprover = await isMerchApprover(session);
  if (!canManage(session) && !merchApprover) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  try {
    if (body.op === "exception") {
      if (!canManage(session)) return NextResponse.json({ error: "Finance or Ops only" }, { status: 403 });
      return NextResponse.json(await setRequestException(id, { reason: body.reason }, session));
    }
    if (body.op === "generate-po") {
      if (!canManage(session)) return NextResponse.json({ error: "Finance or Ops only" }, { status: 403 });
      return NextResponse.json(await generatePoFromRequest(id, session));
    }
    if (body.op === "transition") {
      const action = body.action;
      const req = await getMerchRequest(id);
      if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

      // Head-of-department sign-off (approve / return at MERCH_REVIEW) is the
      // Merchandising sign-off approver (or admin). Finance approval is finance/admin.
      const isHodStep = req.request_status === "MERCH_REVIEW";
      if (action === "hod_approve" || (action === "reject" && isHodStep)) {
        if (!merchApprover) return NextResponse.json({ error: "Only the department sign-off (or an admin) can sign off a procurement request" }, { status: 403 });
      } else if (["approve", "reject", "finance"].includes(action) && !canApprove(session)) {
        return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
      } else if (["submit", "validate"].includes(action) && !canManage(session)) {
        return NextResponse.json({ error: "Finance or Ops only" }, { status: 403 });
      }

      const result = await transitionMerchRequest(id, action, session);

      // Notify the next person in the chain (best-effort — never blocks the action).
      try {
        const baseUrl = baseUrlOf(request);
        const payload = notifyReq(req, session);
        if (action === "submit") {
          const hodEmails = await getApproverEmails("Merchandising").catch(() => []);
          await notifyMerchAwaitingHod({ request: payload, hodEmails, baseUrl });
        } else if (action === "hod_approve") {
          await notifyMerchHodApproved({ request: payload, baseUrl });
        } else if (action === "reject" && isHodStep) {
          await notifyMerchReturned({ request: payload, baseUrl });
        }
      } catch (e) { console.error("merch request notify failed:", e.message); }

      return NextResponse.json(result);
    }
    return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
