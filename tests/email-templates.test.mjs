import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteEmail, resetEmail, poSignoffEmail, poDecisionEmail, poChallengeEmail } from "../lib/email/templates.js";

const LINK = "https://finance.kouriten.com/set-password?token=abc123";
const PO_LINK = "https://finance.kouriten.com/operate/po-tracker";

test("invite email carries the link in both HTML and text, and greets by first name", () => {
  const e = inviteEmail({ name: "San Patel", link: LINK, expiresHours: 48, inviterName: "Kris" });
  assert.match(e.subject, /set up your/i);
  assert.ok(e.html.includes(LINK));
  assert.ok(e.text.includes(LINK));
  assert.match(e.html, /Hi San/);
  assert.match(e.text, /Hi San/);
  assert.match(e.html, /by Kris/); // inviter attribution
  assert.match(e.text, /48 hours/);
});

test("invite email degrades gracefully with no name or inviter", () => {
  const e = inviteEmail({ link: LINK });
  assert.match(e.html, /Hi there/);
  assert.ok(!/ by /.test(e.html.split("<h1")[1] || "")); // no dangling 'by'
  assert.ok(e.html.includes(LINK));
});

test("reset email is distinct from invite and reassures about the current password", () => {
  const e = resetEmail({ name: "San Patel", link: LINK, expiresHours: 24 });
  assert.match(e.subject, /reset your/i);
  assert.ok(e.html.includes(LINK));
  assert.match(e.text, /current password will keep working/i);
  assert.match(e.text, /24 hours/);
});

test("HTML bodies are self-contained (no external asset references)", () => {
  const e = inviteEmail({ name: "A", link: LINK });
  assert.ok(!/src=/.test(e.html), "should embed no external images");
  assert.ok(!/<link/.test(e.html), "should reference no external stylesheets");
});

test("P.O sign-off email names the ref, value and submitter, and links to the tracker", () => {
  const e = poSignoffEmail({ ref: "PO-1042", submitter: "sam@kouriten.com", department: "Marketing", supplier: "Design360", value: 12500, link: PO_LINK });
  assert.match(e.subject, /PO-1042/);
  assert.match(e.subject, /£12,500/);
  assert.ok(e.html.includes(PO_LINK));
  assert.ok(e.text.includes(PO_LINK));
  assert.match(e.html, /Design360/);
  assert.match(e.html, /Marketing/);
  assert.match(e.text, /sam@kouriten\.com/);
});

test("P.O decision email reads approved vs rejected and carries a rejection note", () => {
  const ok = poDecisionEmail({ ref: "PO-7", decision: "APPROVED", approver: "Priya", value: 900, link: PO_LINK });
  assert.match(ok.subject, /was approved/i);
  assert.match(ok.html, /approved/i);
  const no = poDecisionEmail({ ref: "PO-7", decision: "REJECTED", approver: "Priya", value: 900, note: "Wrong cost centre", link: PO_LINK });
  assert.match(no.subject, /was rejected/i);
  assert.match(no.text, /Wrong cost centre/);
  assert.ok(no.html.includes(PO_LINK));
});

test("P.O challenge email lists reasons (array or string) and the note", () => {
  const e = poChallengeEmail({ ref: "PO-55", reasons: ["Missing invoice", "Other — see note"], note: "Please attach the quote", value: 4200, link: PO_LINK });
  assert.match(e.subject, /challenged/i);
  assert.match(e.html, /Missing invoice/);
  assert.match(e.html, /Other — see note/);
  assert.match(e.text, /Please attach the quote/);
  assert.ok(e.html.includes(PO_LINK));
  // Accepts a pre-joined string too.
  const s = poChallengeEmail({ ref: "PO-56", reasons: "Duplicate", value: 10, link: PO_LINK });
  assert.match(s.html, /Duplicate/);
});
