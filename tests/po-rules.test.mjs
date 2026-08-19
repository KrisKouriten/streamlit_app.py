import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePo, rechargeTotal, rechargeError, equalSplit, rechargeAmounts,
  invoiceOutcome, canSubmitForSignoff, poTransitionError, isEditablePo, PO_STATUSES, PO_TRANSITIONS,
  displayStatus, canDeletePo, canEditPo, isChallenged, financeActionError, committedAmount, challengeReasonLabels, isSignedOff,
  termDaysFrom, dueDateFrom, MARKETING_BUDGET_LINKS,
  poRef, paymentStatusOf, isPaymentStatus, selfApproveAllowed,
  selfApprovalDecision, validateDeptPoPolicy, isMeasurementPeriod,
  PO_APPROVAL_ROUTES, CANCELLED_PO_POLICIES,
  CHALLENGE_REASONS, CHALLENGE_RETURN_ROUTES, isChallengeReturnRoute,
  challengeNoteRequired, challengeValidationError, isChallengeReason,
  validatePoInvoice, invoiceTotals, derivePaymentStatus, invoicesReconcile, invoiceSummaryRef,
  describePoAuditEvent,
} from "../lib/po-rules.js";

const goodPo = {
  po_date: "2026-07-01", supplier: "Acme Media Ltd", currency: "GBP",
  payment_value: 12000, vat_amount: 2400, po_category: "Marketing",
  xero_po_number: "PO-1042", department: "Marketing", is_marketing: false,
};

test("validatePo happy path", () => {
  assert.equal(validatePo(goodPo), null);
});

test("validatePo catches each missing/!bad field", () => {
  assert.match(validatePo({ ...goodPo, po_date: "" }), /P.O date/);
  assert.match(validatePo({ ...goodPo, supplier: "  " }), /supplier/);
  assert.match(validatePo({ ...goodPo, currency: "" }), /currency/);
  assert.match(validatePo({ ...goodPo, payment_value: 0 }), /greater than zero/);
  assert.match(validatePo({ ...goodPo, fulfilment_days: -3 }), /days/);
  assert.match(validatePo({ ...goodPo, po_category: "" }), /category/);
  assert.match(validatePo({ ...goodPo, department: "" }), /department/);
});

test("validatePo no longer requires a P.O number (the platform mints it)", () => {
  const { xero_po_number, ...noNumber } = goodPo;
  assert.equal(validatePo(noNumber), null);
});

test("poRef prefers the minted number, then legacy Xero, then the id", () => {
  assert.equal(poRef({ po_number: "PO-2001", xero_po_number: "PO-1042" }), "PO-2001");
  assert.equal(poRef({ xero_po_number: "PO-1042" }), "PO-1042");
  assert.equal(poRef({ po_id: 7 }), "P.O #7");
  assert.equal(poRef({}), "—");
});

test("paymentStatusOf maps the code, defaulting to Unpaid", () => {
  assert.equal(paymentStatusOf({ payment_status: "PAID" }).label, "Paid");
  assert.equal(paymentStatusOf({ payment_status: "PART_PAID" }).tone, "amber");
  assert.equal(paymentStatusOf({}).code, "UNPAID");
  assert.equal(isPaymentStatus("PAID"), true);
  assert.equal(isPaymentStatus("NOPE"), false);
});

test("selfApproveAllowed: within a positive limit only", () => {
  assert.equal(selfApproveAllowed({ value: 500, limit: 1000 }), true);
  assert.equal(selfApproveAllowed({ value: 1000, limit: 1000 }), true); // at the limit
  assert.equal(selfApproveAllowed({ value: 1500, limit: 1000 }), false);
  assert.equal(selfApproveAllowed({ value: 500, limit: 0 }), false);    // feature off
  assert.equal(selfApproveAllowed({ value: 0, limit: 1000 }), false);
});

test("rechargeTotal and rechargeError", () => {
  assert.equal(rechargeTotal([{ pct: 60 }, { pct: 40 }]), 100);
  assert.equal(rechargeError([{ pct: 60 }, { pct: 40 }]), null);
  assert.match(rechargeError([{ pct: 60 }, { pct: 30 }]), /must total 100%.*90%/);
  assert.match(rechargeError([]), /at least one store/);
  assert.match(rechargeError([{ pct: -10 }, { pct: 110 }]), /negative/);
  assert.equal(rechargeError([{ pct: 10 }], { enabled: false }), null);
});

test("equalSplit sums to exactly 100 including awkward counts", () => {
  for (const n of [1, 2, 3, 6, 7, 11]) {
    const stores = Array.from({ length: n }, (_, i) => ({ store_code: `S${i}` }));
    const split = equalSplit(stores);
    assert.equal(split.length, n);
    assert.equal(rechargeTotal(split), 100, `n=${n} must total 100`);
  }
  // 3-way: 33.34 / 33.33 / 33.33
  const three = equalSplit([{ store_code: "a" }, { store_code: "b" }, { store_code: "c" }]);
  assert.deepEqual(three.map((s) => s.pct), [33.34, 33.33, 33.33]);
});

test("rechargeAmounts derives the £ share", () => {
  const out = rechargeAmounts([{ pct: 25 }, { pct: 75 }], 12000);
  assert.deepEqual(out.map((l) => l.amount), [3000, 9000]);
});

test("invoiceOutcome follows the marketing levy logic", () => {
  assert.equal(invoiceOutcome({ isMarketing: true, marketingLevy: true }).code, "LEVY_NO_INVOICE");
  assert.equal(invoiceOutcome({ isMarketing: true, marketingLevy: false }).code, "FINANCE_TO_INVOICE");
  assert.equal(invoiceOutcome({ isMarketing: false, rechargeEnabled: true }).code, "STANDARD");
  assert.equal(invoiceOutcome({ isMarketing: false, rechargeEnabled: false }).code, "NONE");
});

test("canSubmitForSignoff enforces fields, levy answer and 100% recharge", () => {
  // no recharge, non-marketing → fine
  assert.equal(canSubmitForSignoff({ ...goodPo, recharge_enabled: false }), null);
  // marketing without a levy answer → blocked
  assert.match(canSubmitForSignoff({ ...goodPo, is_marketing: true, marketing_levy: null }), /marketing levy/);
  // recharge on but not 100% → blocked
  assert.match(
    canSubmitForSignoff({ ...goodPo, recharge_enabled: true }, [{ pct: 50 }, { pct: 30 }]),
    /must total 100%/
  );
  // recharge on and 100% → fine
  assert.equal(
    canSubmitForSignoff({ ...goodPo, is_marketing: true, marketing_levy: true, recharge_enabled: true }, [{ pct: 50 }, { pct: 50 }]),
    null
  );
  // Head-Office-only recharge needs no store split
  assert.equal(canSubmitForSignoff({ ...goodPo, recharge_enabled: true, recharge_ho_only: true }, []), null);
});

test("PO transitions", () => {
  assert.equal(poTransitionError("submit_for_signoff", "DRAFT"), null);
  assert.equal(poTransitionError("approve", "PENDING_SIGNOFF"), null);
  assert.match(poTransitionError("approve", "DRAFT"), /Cannot approve/);
  assert.match(poTransitionError("bogus", "DRAFT"), /Unknown action/);
  for (const t of Object.values(PO_TRANSITIONS)) {
    if (t.to) assert.ok(PO_STATUSES.includes(t.to));
  }
});

test("isEditablePo", () => {
  assert.equal(isEditablePo("DRAFT"), true);
  assert.equal(isEditablePo("REJECTED"), true);
  assert.equal(isEditablePo("PENDING_SIGNOFF"), false);
  assert.equal(isEditablePo("APPROVED"), false);
});

test("displayStatus reflects request lifecycle before sign-off, finance after", () => {
  assert.equal(displayStatus({ status: "DRAFT" }).label, "Draft");
  assert.equal(displayStatus({ status: "PENDING_SIGNOFF" }).label, "Awaiting sign-off");
  assert.equal(displayStatus({ status: "REJECTED" }).code, "REJECTED");
  assert.equal(displayStatus({ status: "APPROVED", finance_status: "OPEN" }).label, "Open");
  assert.equal(displayStatus({ status: "APPROVED", finance_status: "CHALLENGED" }).label, "Challenged");
  assert.equal(displayStatus({ status: "APPROVED", finance_status: "CLOSED" }).label, "Closed");
});

test("canDeletePo: pre-signoff anyone; post-signoff admin only", () => {
  assert.equal(canDeletePo({ status: "DRAFT" }, { isAdmin: false }).ok, true);
  assert.equal(canDeletePo({ status: "PENDING_SIGNOFF" }, { isAdmin: false }).ok, true);
  assert.equal(canDeletePo({ status: "APPROVED", finance_status: "OPEN" }, { isAdmin: false }).ok, false);
  assert.equal(canDeletePo({ status: "APPROVED", finance_status: "OPEN" }, { isAdmin: true }).ok, true);
  assert.equal(canDeletePo({ status: "APPROVED", finance_status: "CLOSED" }, { isAdmin: false }).ok, false);
});

test("financeActionError requires a signed-off P.O; blocks double-close", () => {
  assert.match(financeActionError("close", { status: "PENDING_SIGNOFF" }), /not been signed off/);
  assert.equal(financeActionError("close", { status: "APPROVED", finance_status: "OPEN" }), null);
  assert.match(financeActionError("close", { status: "APPROVED", finance_status: "CLOSED" }), /already closed/);
  assert.equal(isSignedOff({ status: "APPROVED" }), true);
});

test("committedAmount uses invoice net if present, else P.O value", () => {
  assert.equal(committedAmount({ payment_value: 1000, invoice_amount: 950 }), 950);
  assert.equal(committedAmount({ payment_value: 1000 }), 1000);
  assert.equal(committedAmount({ payment_value: 1000, invoice_amount: "" }), 1000);
});

test("challengeReasonLabels maps codes (string or array) to labels", () => {
  assert.deepEqual(challengeReasonLabels(["INVOICE_VALUE"]), ["Invoice value — different to the P.O"]);
  assert.equal(challengeReasonLabels("PO_DETAILS,SPEND_VS_BUDGET").length, 2);
  assert.deepEqual(challengeReasonLabels([]), []);
});

test("termDaysFrom parses the number of days from free text", () => {
  assert.equal(termDaysFrom("30"), 30);
  assert.equal(termDaysFrom("30 days"), 30);
  assert.equal(termDaysFrom("Net 45"), 45);
  assert.equal(termDaysFrom("net-60"), 60);
  assert.equal(termDaysFrom(""), null);
  assert.equal(termDaysFrom(null), null);
  assert.equal(termDaysFrom("on receipt"), null);
});

test("dueDateFrom adds term days to the P.O date (UTC, date-only)", () => {
  assert.equal(dueDateFrom("2026-07-01", 30), "2026-07-31");
  assert.equal(dueDateFrom("2026-07-01", 0), "2026-07-01");
  assert.equal(dueDateFrom("2026-01-31", 1), "2026-02-01");   // month rollover
  assert.equal(dueDateFrom("2026-12-15", 30), "2027-01-14");  // year rollover
  assert.equal(dueDateFrom("", 30), null);
  assert.equal(dueDateFrom("2026-07-01", null), null);
});

test("MARKETING_BUDGET_LINKS covers the expected budget parts", () => {
  assert.ok(MARKETING_BUDGET_LINKS.includes("Campaign costs"));
  assert.ok(MARKETING_BUDGET_LINKS.includes("One-off projects"));
  assert.ok(MARKETING_BUDGET_LINKS.includes("New store openings"));
});

// ---- Department self-approval policy (migration 063) ----

const marketingPolicy = {
  department: "Marketing", active: true,
  count_limit: 5, measurement_period: "FINANCIAL_PERIOD",
  max_individual_value: 2500, max_cumulative_value: 8000,
  line_manager_email: "head.marketing@example.com",
  cancelled_po_policy: "RETAIN_IN_COUNT",
};

test("validateDeptPoPolicy accepts a well-formed policy", () => {
  assert.equal(validateDeptPoPolicy(marketingPolicy), null);
});

test("validateDeptPoPolicy rejects bad input", () => {
  assert.match(validateDeptPoPolicy({ ...marketingPolicy, department: "  " }), /department/i);
  assert.match(validateDeptPoPolicy({ ...marketingPolicy, measurement_period: "NOPE" }), /period/i);
  assert.match(validateDeptPoPolicy({ ...marketingPolicy, count_limit: -1 }), /count limit/i);
  assert.match(validateDeptPoPolicy({ ...marketingPolicy, max_cumulative_value: -5 }), /cumulative/i);
  assert.match(validateDeptPoPolicy({ ...marketingPolicy, measurement_period: "CUSTOM_PERIOD", custom_period_days: 0 }), /custom period/i);
  assert.match(validateDeptPoPolicy({ ...marketingPolicy, cancelled_po_policy: "WAT" }), /cancelled/i);
});

test("isMeasurementPeriod + CANCELLED_PO_POLICIES vocab", () => {
  assert.ok(isMeasurementPeriod("FINANCIAL_PERIOD"));
  assert.ok(!isMeasurementPeriod("FORTNIGHT"));
  assert.ok(CANCELLED_PO_POLICIES.some((c) => c.code === "RETAIN_IN_COUNT"));
});

test("selfApprovalDecision: within all limits self-approves", () => {
  const d = selfApprovalDecision({
    value: 1900, policy: marketingPolicy,
    usage: { count: 2, cumulativeValue: 4100 },
  });
  assert.equal(d.selfApprove, true);
  assert.equal(d.route, PO_APPROVAL_ROUTES.SELF);
  assert.equal(d.remainingCount, 3);
  assert.equal(d.remainingValue, 3900);
  assert.equal(d.projectedValue, 6000);
  assert.equal(d.binding, null);
});

test("selfApprovalDecision: cumulative cap is the binding rule", () => {
  // 4 used, £6,450 cumulative; this P.O £1,900 → £8,350 > £8,000.
  const d = selfApprovalDecision({
    value: 1900, policy: marketingPolicy,
    usage: { count: 4, cumulativeValue: 6450 },
  });
  assert.equal(d.selfApprove, false);
  assert.equal(d.route, PO_APPROVAL_ROUTES.MANAGER);   // policy has a line manager
  assert.match(d.binding, /cumulative/i);
  assert.equal(d.remainingCount, 1);
});

test("selfApprovalDecision: count limit reached", () => {
  const d = selfApprovalDecision({
    value: 100, policy: marketingPolicy,
    usage: { count: 5, cumulativeValue: 500 },
  });
  assert.equal(d.selfApprove, false);
  assert.match(d.binding, /all 5 self-approved/i);
  assert.equal(d.remainingCount, 0);
});

test("selfApprovalDecision: individual value cap", () => {
  const d = selfApprovalDecision({
    value: 3000, policy: marketingPolicy,
    usage: { count: 0, cumulativeValue: 0 },
  });
  assert.equal(d.selfApprove, false);
  assert.match(d.binding, /individual self-approval limit/i);
});

test("selfApprovalDecision: most-restrictive lists every breached rule", () => {
  const d = selfApprovalDecision({
    value: 3000, policy: marketingPolicy,
    usage: { count: 5, cumulativeValue: 7900 },
  });
  assert.equal(d.selfApprove, false);
  // count + individual + cumulative all breached.
  assert.equal(d.reasons.length >= 3, true);
});

test("selfApprovalDecision: extra blocks (budget/supplier/SoD) always defer", () => {
  const d = selfApprovalDecision({
    value: 100, policy: marketingPolicy,
    usage: { count: 0, cumulativeValue: 0 },
    blocks: ["Department budget is insufficient"],
  });
  assert.equal(d.selfApprove, false);
  assert.match(d.binding, /budget/i);
  assert.equal(d.route, PO_APPROVAL_ROUTES.MANAGER);
});

test("selfApprovalDecision: no policy falls back to the org-wide limit", () => {
  const within = selfApprovalDecision({ value: 400, policy: null, orgLimit: 500 });
  assert.equal(within.selfApprove, true);
  assert.equal(within.route, PO_APPROVAL_ROUTES.SELF);

  const over = selfApprovalDecision({ value: 900, policy: null, orgLimit: 500 });
  assert.equal(over.selfApprove, false);
  assert.equal(over.route, PO_APPROVAL_ROUTES.DEPT);
  assert.match(over.binding, /self-approval limit/i);

  const off = selfApprovalDecision({ value: 900, policy: null, orgLimit: 0 });
  assert.equal(off.selfApprove, false);
  assert.match(off.binding, /off/i);
});

test("selfApprovalDecision: inactive policy also falls back", () => {
  const d = selfApprovalDecision({ value: 400, policy: { ...marketingPolicy, active: false }, orgLimit: 500 });
  assert.equal(d.selfApprove, true);
});

// ---- Challenge: Other reason + return route (migration 098) ----

test("CHALLENGE_REASONS includes the Other option", () => {
  assert.ok(CHALLENGE_REASONS.some((r) => r.code === "OTHER"));
  assert.equal(isChallengeReason("OTHER"), true);
  assert.equal(isChallengeReason("NONSENSE"), false);
});

test("challengeNoteRequired only when Other is chosen", () => {
  assert.equal(challengeNoteRequired(["INVOICE_VALUE"]), false);
  assert.equal(challengeNoteRequired(["INVOICE_VALUE", "OTHER"]), true);
  assert.equal(challengeNoteRequired("OTHER"), true);
});

test("challengeValidationError: needs a reason", () => {
  assert.match(challengeValidationError({ reasons: [] }), /at least one/i);
});

test("challengeValidationError: Other needs a note", () => {
  assert.match(challengeValidationError({ reasons: ["OTHER"], note: "" }), /note/i);
  assert.equal(challengeValidationError({ reasons: ["OTHER"], note: "Wrong cost centre" }), null);
});

test("challengeValidationError: rejects an unknown reason or route", () => {
  assert.match(challengeValidationError({ reasons: ["MADE_UP"] }), /Unknown challenge reason/);
  assert.match(challengeValidationError({ reasons: ["INVOICE_VALUE"], returnRoute: "SIDEWAYS" }), /valid return route/i);
});

test("challengeValidationError: passes a plain reason with no note", () => {
  assert.equal(challengeValidationError({ reasons: ["INVOICE_VALUE"], returnRoute: "TO_FINANCE" }), null);
});

test("CHALLENGE_RETURN_ROUTES has the two routes", () => {
  assert.deepEqual(CHALLENGE_RETURN_ROUTES.map((r) => r.code).sort(), ["TO_FINANCE", "TO_SIGNOFF"]);
  assert.equal(isChallengeReturnRoute("TO_FINANCE"), true);
  assert.equal(isChallengeReturnRoute("nope"), false);
});

// ---- Editability of a challenged P.O ----

test("canEditPo: drafts, rejected and challenged are editable; others are not", () => {
  assert.equal(canEditPo({ status: "DRAFT" }), true);
  assert.equal(canEditPo({ status: "REJECTED" }), true);
  assert.equal(canEditPo({ status: "APPROVED", finance_status: "CHALLENGED" }), true);
  assert.equal(canEditPo({ status: "APPROVED", finance_status: "OPEN" }), false);
  assert.equal(canEditPo({ status: "APPROVED", finance_status: "CLOSED" }), false);
  assert.equal(canEditPo({ status: "PENDING_SIGNOFF" }), false);
});

test("isChallenged reflects the finance lifecycle", () => {
  assert.equal(isChallenged({ status: "APPROVED", finance_status: "CHALLENGED" }), true);
  assert.equal(isChallenged({ status: "APPROVED", finance_status: "OPEN" }), false);
  assert.equal(isChallenged({ status: "REJECTED" }), false);
});

// ---- Multiple invoices per P.O (migration 099) ----

test("validatePoInvoice needs a number and a positive amount", () => {
  assert.match(validatePoInvoice({ invoice_amount: 100 }), /invoice number/i);
  assert.match(validatePoInvoice({ invoice_number: "INV-1", invoice_amount: 0 }), /greater than zero/i);
  assert.equal(validatePoInvoice({ invoice_number: "INV-1", invoice_amount: 100 }), null);
});

test("invoiceTotals sums total, paid and outstanding", () => {
  const inv = [
    { invoice_amount: 1000, paid: true },
    { invoice_amount: 650, paid: false },
  ];
  const t = invoiceTotals(inv);
  assert.equal(t.count, 2);
  assert.equal(t.total, 1650);
  assert.equal(t.paid, 1000);
  assert.equal(t.outstanding, 650);
  assert.equal(t.paidCount, 1);
  assert.deepEqual(invoiceTotals([]), { count: 0, total: 0, paid: 0, outstanding: 0, paidCount: 0 });
});

test("derivePaymentStatus reflects how many invoices are paid", () => {
  assert.equal(derivePaymentStatus([]), null);
  assert.equal(derivePaymentStatus([{ paid: false, invoice_amount: 100 }, { paid: false, invoice_amount: 100 }]), "UNPAID");
  assert.equal(derivePaymentStatus([{ paid: true, invoice_amount: 100 }, { paid: false, invoice_amount: 100 }]), "PART_PAID");
  // No P.O value supplied → falls back to "every invoice paid" = PAID.
  assert.equal(derivePaymentStatus([{ paid: true, invoice_amount: 100 }, { paid: true, invoice_amount: 100 }]), "PAID");
});

test("derivePaymentStatus measures paid invoices against the P.O value", () => {
  // One £330 invoice paid against a £1,700 P.O is PART_PAID, not PAID.
  assert.equal(derivePaymentStatus([{ paid: true, invoice_amount: 330 }], 1700), "PART_PAID");
  // Paid invoices covering the P.O value → PAID (within 1p tolerance).
  assert.equal(derivePaymentStatus([{ paid: true, invoice_amount: 1700 }], 1700), "PAID");
  assert.equal(derivePaymentStatus([{ paid: true, invoice_amount: 1000 }, { paid: true, invoice_amount: 700 }], 1700), "PAID");
  // Covers the value but one invoice still unpaid → PART_PAID (paid sum short).
  assert.equal(derivePaymentStatus([{ paid: true, invoice_amount: 1000 }, { paid: false, invoice_amount: 700 }], 1700), "PART_PAID");
  // Nothing paid → UNPAID regardless of value.
  assert.equal(derivePaymentStatus([{ paid: false, invoice_amount: 500 }], 1700), "UNPAID");
});

test("invoicesReconcile checks the invoiced total against the P.O value", () => {
  const inv = [{ invoice_amount: 1000 }, { invoice_amount: 650 }];
  assert.equal(invoicesReconcile(inv, 1650), true);
  assert.equal(invoicesReconcile(inv, 1650.005), true);   // within 1p
  assert.equal(invoicesReconcile(inv, 1700), false);
});

test("invoiceSummaryRef summarises the invoice numbers", () => {
  assert.equal(invoiceSummaryRef([]), null);
  assert.equal(invoiceSummaryRef([{ invoice_number: "INV-1" }]), "INV-1");
  assert.equal(invoiceSummaryRef([{ invoice_number: "INV-1" }, { invoice_number: "INV-2" }, { invoice_number: "INV-3" }]), "INV-1 +2");
});

test("describePoAuditEvent labels the P.O lifecycle events", () => {
  const raised = describePoAuditEvent({ event_type: "purchase_order.create", detail: { po_number: "PO-1042" }, actor_name: "Kris", occurred_at: "2026-07-01T09:00:00Z" });
  assert.equal(raised.action, "create");
  assert.equal(raised.label, "P.O raised");
  assert.equal(raised.tone, "accent");
  assert.equal(raised.detail, "Reference PO-1042");
  assert.equal(raised.actor, "Kris");
  assert.equal(raised.at, "2026-07-01T09:00:00Z");

  assert.equal(describePoAuditEvent({ event_type: "purchase_order.self_approve" }).label, "Self-approved");
  assert.equal(describePoAuditEvent({ event_type: "purchase_order.self_approve" }).tone, "green");
  assert.equal(describePoAuditEvent({ event_type: "purchase_order.approve" }).label, "Approved");
  assert.equal(describePoAuditEvent({ event_type: "purchase_order.close" }).label, "Closed by Finance");
});

test("describePoAuditEvent names the sign-off route", () => {
  const mgr = describePoAuditEvent({ event_type: "purchase_order.submit_for_signoff", detail: { route: "LINE_MANAGER" } });
  assert.equal(mgr.label, "Sent for sign-off");
  assert.equal(mgr.detail, "Routed to line manager");
  const dept = describePoAuditEvent({ event_type: "purchase_order.submit_for_signoff", detail: { route: "DEPT_SIGNOFF" } });
  assert.equal(dept.detail, "Routed to department sign-off");
});

test("describePoAuditEvent describes a challenge with its reasons", () => {
  const ch = describePoAuditEvent({ event_type: "purchase_order.challenge", detail: { reasons: ["INVOICE_VALUE", "OTHER"] } });
  assert.equal(ch.label, "Challenged by Finance");
  assert.equal(ch.tone, "red");
  assert.match(ch.detail, /Invoice value/);
  assert.match(ch.detail, /Other/);
});

test("describePoAuditEvent marks a reissue after challenge", () => {
  const re = describePoAuditEvent({ event_type: "purchase_order.resubmit_challenge", detail: { route: "TO_FINANCE" } });
  assert.equal(re.label, "Reissued after challenge");
  assert.equal(re.tone, "accent");
});

test("describePoAuditEvent lists updated fields in business terms", () => {
  const up = describePoAuditEvent({ event_type: "purchase_order.update", detail: { fields: ["payment_value", "payment_date", "recharge"] } });
  assert.equal(up.label, "Record updated");
  assert.equal(up.detail, "Changed value, due date, recharge allocation");
});

test("describePoAuditEvent falls back to the actor email and an unknown action", () => {
  const e = describePoAuditEvent({ event_type: "purchase_order.mystery_thing", actor_email: "a@b.com" });
  assert.equal(e.label, "mystery thing");
  assert.equal(e.actor, "a@b.com");
  assert.equal(e.tone, "muted");
});

test("describePoAuditEvent overrides show the route change and reason", () => {
  const o = describePoAuditEvent({ event_type: "purchase_order.override_route", detail: { original: "LINE_MANAGER", revised: "SELF_APPROVED", reason: "under limit" } });
  assert.equal(o.label, "Approval route overridden");
  assert.match(o.detail, /line manager → self-approved/);
  assert.match(o.detail, /under limit/);
});
