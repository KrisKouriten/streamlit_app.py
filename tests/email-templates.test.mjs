import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteEmail, resetEmail } from "../lib/email/templates.js";

const LINK = "https://finance.kouriten.com/set-password?token=abc123";

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
