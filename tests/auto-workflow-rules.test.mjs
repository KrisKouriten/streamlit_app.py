import test from "node:test";
import assert from "node:assert/strict";
import { isWorkingDay, addWorkingDays, workingDaysBetween, dayOf } from "../lib/working-days-rules.js";
import { challengeLapse, autoCancelReason, lapseNote, autoChaseDue, isOpenChallenge, CHALLENGE_GRACE_DAYS, AUTO_CHASE_DAYS } from "../lib/auto-workflow-rules.js";

test("working days skip weekends and England & Wales bank holidays", () => {
  assert.equal(isWorkingDay("2026-09-29"), true);   // Tuesday
  assert.equal(isWorkingDay("2026-10-03"), false);  // Saturday
  assert.equal(isWorkingDay("2026-08-31"), false);  // summer bank holiday
  assert.equal(isWorkingDay("2026-12-28"), false);  // Boxing Day substitute
  assert.equal(isWorkingDay("nonsense"), false);
});

test("addWorkingDays counts from the day after", () => {
  assert.equal(addWorkingDays("2026-09-28", 5), "2026-10-05");  // Mon → next Mon
  assert.equal(addWorkingDays("2026-09-24", 5), "2026-10-01");  // Thu → next Thu
  assert.equal(addWorkingDays("2026-10-03", 1), "2026-10-05");  // from a Saturday
  // Christmas 2026: 25th (Fri) and 28th (Mon) are holidays.
  assert.equal(addWorkingDays("2026-12-23", 3), "2026-12-30");
  // Easter 2027: Good Friday 26/03 and Easter Monday 29/03.
  assert.equal(addWorkingDays("2027-03-25", 1), "2027-03-30");
  assert.equal(addWorkingDays("2026-09-28", 0), "2026-09-28");
});

test("workingDaysBetween and dayOf", () => {
  assert.equal(workingDaysBetween("2026-09-28", "2026-10-05"), 5);
  assert.equal(workingDaysBetween("2026-10-05", "2026-09-28"), 0);
  assert.equal(dayOf(new Date("2026-09-29T21:30:00Z")), "2026-09-29");
  assert.equal(dayOf("2026-09-29T08:00:00.000Z"), "2026-09-29");
  assert.equal(dayOf(null), null);
});

const po = (o = {}) => ({ status: "APPROVED", finance_status: "CHALLENGED", challenged_at: "2026-09-28T10:00:00Z", ...o });

test("a challenge lapses after the fifth working day", () => {
  assert.equal(CHALLENGE_GRACE_DAYS, 5);
  const onDeadline = challengeLapse(po(), "2026-10-05");
  assert.equal(onDeadline.deadline, "2026-10-05");
  assert.equal(onDeadline.lapsed, false);
  assert.equal(onDeadline.daysLeft, 0);
  const after = challengeLapse(po(), "2026-10-06");
  assert.equal(after.lapsed, true);
  const early = challengeLapse(po(), "2026-09-29");
  assert.equal(early.lapsed, false);
  assert.equal(early.daysLeft, 4);
});

test("only an open challenge lapses", () => {
  assert.equal(challengeLapse(po({ status: "CANCELLED" }), "2026-12-01").lapsed, false);
  assert.equal(challengeLapse(po({ finance_status: "OPEN" }), "2026-12-01").lapsed, false);
  assert.equal(challengeLapse(po({ challenged_at: null }), "2026-12-01").lapsed, false);
  assert.equal(isOpenChallenge(po({ status: undefined, approval_status: "APPROVED" }), "PROCUREMENT"), true);
  assert.equal(isOpenChallenge(po({ approval_status: "CANCELLED" }), "PROCUREMENT"), false);
  // Before migration 082 there is no approval_status at all.
  assert.equal(isOpenChallenge({ finance_status: "CHALLENGED" }, "PROCUREMENT"), true);
});

test("an amendment after the challenge stops the procurement clock", () => {
  const r = { finance_status: "CHALLENGED", approval_status: "APPROVED", challenged_at: "2026-09-28T10:00:00Z" };
  const amended = challengeLapse(r, "2026-12-01", "PROCUREMENT", undefined, { amendedAt: "2026-09-29T09:00:00Z" });
  assert.equal(amended.lapsed, false);
  assert.equal(amended.amended, true);
  assert.match(lapseNote(amended), /waiting on Finance/);
  // An amendment before the challenge does not count as answering it.
  const before = challengeLapse(r, "2026-12-01", "PROCUREMENT", undefined, { amendedAt: "2026-09-27T09:00:00Z" });
  assert.equal(before.lapsed, true);
});

test("lapse notes and the cancel reason are plain and dated DD/MM/YYYY", () => {
  assert.equal(lapseNote(challengeLapse(po(), "2026-09-29")), "Cancels automatically after 05/10/2026 · 4 working days left");
  assert.equal(lapseNote(challengeLapse(po(), "2026-10-06")), "Due to cancel automatically at the next run");
  assert.equal(lapseNote(challengeLapse(po({ finance_status: "OPEN" }))), null);
  assert.equal(autoCancelReason(po()), "Cancelled automatically: challenged by Finance on 28/09/2026 and not adjusted and resubmitted within 5 working days.");
});

const waiting = (o = {}) => ({ status: "APPROVED", finance_status: "OPEN", approved_at: "2026-09-01T09:00:00Z", ...o });

test("the automatic invoice chase follows a manual one, every 5 working days", () => {
  assert.equal(AUTO_CHASE_DAYS, 5);
  // Never chased by hand: the app does not start it.
  assert.deepEqual(autoChaseDue(waiting(), null, "2026-10-20"), { due: false, nextOn: null });
  const last = { at: "2026-09-24T10:00:00Z", times: 1 };
  assert.deepEqual(autoChaseDue(waiting(), last, "2026-09-30"), { due: false, nextOn: "2026-10-01" });
  assert.deepEqual(autoChaseDue(waiting(), last, "2026-10-01"), { due: true, nextOn: "2026-10-01" });
  assert.equal(autoChaseDue(waiting(), last, "2026-10-09").due, true);
});

test("no automatic chase once the invoice is in, or the P.O is closed", () => {
  const last = { at: "2026-09-24T10:00:00Z", times: 2 };
  assert.equal(autoChaseDue(waiting({ invoice_number: "INV1" }), last, "2026-10-09").due, false);
  assert.equal(autoChaseDue(waiting({ finance_status: "CLOSED" }), last, "2026-10-09").due, false);
  assert.equal(autoChaseDue(waiting({ status: "CANCELLED" }), last, "2026-10-09").due, false);
});
