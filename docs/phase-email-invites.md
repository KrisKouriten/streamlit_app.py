# Email invites & self-service password set-up

Onboarding a new user no longer means an admin typing a password and passing it
on by hand. An admin creates the account; the user receives an email with a
one-time link and sets their own password before first sign-in. The same
mechanism powers an emailed "reset your password" link.

## How it works

1. **Admin adds a user** in **Govern › Users**. "Email an invite" is ticked by
   default, so no password field is shown — the account is created with an
   unguessable random password nobody knows and is flagged
   `must_change_password` (shown as **INVITED** in the list).
2. **An invite email** goes out via Resend (from a verified sender on your own
   domain) with a link to `/set-password?token=…`.
3. **The user sets a password** on that public page. The token is single-use and
   expires after `INVITE_TTL_HOURS` (48h). On success the flag clears (status
   becomes **ACTIVE**) and any existing sessions for the account are revoked.
4. **The user signs in** normally. MFA, throttling and session rules are
   untouched — this flow only sets the password.

An admin can also, per user:
- **Resend invite** (for an account still awaiting first sign-in),
- **Email reset link** (for an active account — the current password keeps
  working until a new one is chosen),
- **Set password** directly (the original admin override), still available.

## The token

Tokens are 256-bit random values. Only the **SHA-256 hash** is stored
(`governance.user_invite.token_hash`); the raw token exists only in the email
link, exactly like a password reset. Tokens are single-use (`used_at`),
time-boxed (`expires_at`), and creating a new one supersedes any open link for
that user. Redemption is a guarded update, so two concurrent submits can't both
succeed.

## Email transport — Resend

Mail is sent via [Resend](https://resend.com) — a single authenticated HTTPS
POST with an API key, so invites come from a verified sender on your own domain.

**Resend setup (one-off):**
1. Create a Resend account.
2. Add your **sending domain** and publish the DNS records Resend shows (SPF /
   DKIM), then wait for it to verify.
3. Create an **API key**.

**Environment variables** (Vercel project settings or `.env.local`):

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | The Resend API key (starts `re_…`) |
| `RESEND_SENDER` | From address on a verified domain, e.g. `Miniso UK Finance OS <no-reply@your-domain>` (`EMAIL_FROM` is accepted as an alias) |
| `APP_BASE_URL` | (Optional) public URL for building links; defaults to the request origin |

**Graceful fallback:** if the API key or sender isn't set — or a send fails —
the user is still created and the admin is shown the one-time link to copy and
share securely. Nothing blocks on email being configured. `/api/health` reports
`config.email` as `set` or `MISSING`.

## Migration

`db/migrations/044_user_invites.sql` — adds `public.users.must_change_password`
and the `governance.user_invite` table. Additive and idempotent.

## Files

- `db/migrations/044_user_invites.sql` — schema
- `lib/invite-rules.js` — pure: token state, new-password validation, base-URL
  resolution, link building (unit-tested)
- `lib/invite.js` — token generation/hashing, create/find/redeem (I/O)
- `lib/email/resend.js` — Resend transport: `emailConfigured` + `sendMail`
- `lib/email/templates.js` — pure invite/reset email bodies (unit-tested)
- `app/api/admin/users/route.js` — invite-on-create + `invite` / `email-reset`
- `app/api/auth/set-password/route.js` — public redemption endpoint
- `app/set-password/*` — public page + form
- `app/govern/users/users-admin.js` — invite-by-default UI, send-link buttons,
  status, manual-link fallback
