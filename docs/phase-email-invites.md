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
2. **An invite email** goes out from a Microsoft 365 mailbox with a link to
   `/set-password?token=…`.
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

## Email transport — Microsoft 365 (Graph)

Mail is sent via Microsoft Graph using the application (client-credentials)
flow, so invites come from a real `@kouriten.com` mailbox.

**Azure / Entra setup (one-off):**
1. Register an application in Entra ID.
2. Under **API permissions**, add **Microsoft Graph → Application permissions →
   `Mail.Send`**, then **Grant admin consent**.
3. Under **Certificates & secrets**, create a **client secret**.
4. (Optional, recommended) Restrict which mailbox the app may send as with an
   [ApplicationAccessPolicy](https://learn.microsoft.com/graph/auth-limit-mailbox-access)
   scoped to `MS_GRAPH_SENDER`.

**Environment variables** (Vercel project settings or `.env.local`):

| Variable | Purpose |
| --- | --- |
| `MS_GRAPH_TENANT_ID` | Entra tenant (GUID or domain) |
| `MS_GRAPH_CLIENT_ID` | App registration client id |
| `MS_GRAPH_CLIENT_SECRET` | App registration client secret |
| `MS_GRAPH_SENDER` | Mailbox to send as, e.g. `no-reply@kouriten.com` |
| `APP_BASE_URL` | (Optional) public URL for building links; defaults to the request origin |

**Graceful fallback:** if the four Graph vars aren't all set — or a send fails —
the user is still created and the admin is shown the one-time link to copy and
share securely. Nothing blocks on email being configured. `/api/health` reports
`config.graphEmail` as `set` or `MISSING`.

## Migration

`db/migrations/044_user_invites.sql` — adds `public.users.must_change_password`
and the `governance.user_invite` table. Additive and idempotent.

## Files

- `db/migrations/044_user_invites.sql` — schema
- `lib/invite-rules.js` — pure: token state, new-password validation, base-URL
  resolution, link building (unit-tested)
- `lib/invite.js` — token generation/hashing, create/find/redeem (I/O)
- `lib/email/graph.js` — Microsoft Graph token cache + `sendMail`
- `lib/email/templates.js` — pure invite/reset email bodies (unit-tested)
- `app/api/admin/users/route.js` — invite-on-create + `invite` / `email-reset`
- `app/api/auth/set-password/route.js` — public redemption endpoint
- `app/set-password/*` — public page + form
- `app/govern/users/users-admin.js` — invite-by-default UI, send-link buttons,
  status, manual-link fallback
