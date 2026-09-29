/*
 * Automatic follow-ups on the Finance desks — pure and unit-testable.
 *
 *   * A challenged P.O or procurement request that has not been adjusted and
 *     resubmitted (or deleted) within CHALLENGE_GRACE_DAYS working days of the
 *     challenge is cancelled. Cancelled, not deleted: the row keeps its history
 *     and shows under Cancelled, but it no longer counts anywhere.
 *   * A P.O whose invoice Finance has already chased once by hand is chased
 *     again automatically every AUTO_CHASE_DAYS working days until the invoice
 *     is recorded. The first chase stays manual — Finance decide when to start.
 *
 * Working days are Monday to Friday less England & Wales bank holidays.
 */

import { addWorkingDays, dayOf, workingDaysBetween } from "./working-days-rules.js";
import { invoiceChaseStatus } from "./po-rules.js";

export const CHALLENGE_GRACE_DAYS = 5;
export const AUTO_CHASE_DAYS = 5;
export const AUTO_ACTOR = { email: "finance-os-auto", name: "Finance OS (automatic)", roles: [] };

const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

// Still an open challenge? A P.O is challenged while signed off; a procurement
// request while it is not cancelled (approval_status is absent before 082).
export function isOpenChallenge(row = {}, kind = "PO") {
  if (row.finance_status !== "CHALLENGED") return false;
  return kind === "PO" ? row.status === "APPROVED" : row.approval_status !== "CANCELLED";
}

/*
 * When a challenge lapses. The submitter has the whole of the fifth working day
 * after the challenge; it is cancelled from the working day after that.
 * Returns { deadline, lapsed, daysLeft, amended } — deadline 'YYYY-MM-DD', null
 * (and never lapsed) when there is no challenge date to count from.
 *   amendedAt  when the raiser last amended a procurement request, if they have
 */
export function challengeLapse(row = {}, today = new Date(), kind = "PO", days = CHALLENGE_GRACE_DAYS, { amendedAt = null } = {}) {
  const none = { deadline: null, lapsed: false, daysLeft: null, amended: false };
  if (!isOpenChallenge(row, kind)) return none;
  const from = dayOf(row.challenged_at);
  if (!from) return none;
  // A procurement request is answered by amending it — it then waits on
  // Finance to re-review, so the clock stops. (A P.O is answered by resubmitting,
  // which clears the challenge itself.)
  if (amendedAt && new Date(amendedAt).getTime() > new Date(row.challenged_at).getTime()) {
    return { ...none, amended: true };
  }
  const deadline = addWorkingDays(from, days);
  const now = dayOf(today);
  const lapsed = !!now && now > deadline;
  return { deadline, lapsed, daysLeft: lapsed ? 0 : workingDaysBetween(now, deadline), amended: false };
}

// The reason recorded on an automatically cancelled item.
export function autoCancelReason(row = {}, days = CHALLENGE_GRACE_DAYS) {
  const on = dayOf(row.challenged_at);
  return `Cancelled automatically: challenged by Finance${on ? ` on ${dmy(on)}` : ""} and not adjusted and resubmitted within ${days} working days.`;
}

// Short line for the desks: "Cancels automatically after 06/10/2026".
export function lapseNote(lapse) {
  if (lapse?.amended) return "Amended since the challenge — waiting on Finance to re-review";
  if (!lapse?.deadline) return null;
  if (lapse.lapsed) return "Due to cancel automatically at the next run";
  return `Cancels automatically after ${dmy(lapse.deadline)}${lapse.daysLeft != null ? ` · ${lapse.daysLeft} working day${lapse.daysLeft === 1 ? "" : "s"} left` : ""}`;
}

/*
 * Is a P.O due its automatic invoice chase?
 *   lastChase: { at, times } from the audit log (lastInvoiceChases), or null
 * Only once Finance have chased by hand, only while the invoice is still
 * missing on an open signed-off P.O, and AUTO_CHASE_DAYS working days after the
 * last chase — manual or automatic.
 * Returns { due, nextOn } — nextOn 'YYYY-MM-DD' or null when none will be sent.
 */
export function autoChaseDue(po = {}, lastChase = null, today = new Date(), days = AUTO_CHASE_DAYS) {
  const none = { due: false, nextOn: null };
  if (!lastChase?.at) return none;
  const st = invoiceChaseStatus(po, today).state;
  if (st !== "waiting" && st !== "overdue") return none;
  const nextOn = addWorkingDays(lastChase.at, days);
  const now = dayOf(today);
  return { due: !!now && now >= nextOn, nextOn };
}
