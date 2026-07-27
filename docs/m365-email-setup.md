# Microsoft 365 email setup — invite & reset emails

The Finance OS invite / password-reset feature is **live and works today**. Until
Microsoft 365 is connected, each invite or reset shows the admin a **one-time
link to copy and share manually**. This is a graceful fallback — nothing is
broken.

Connecting Microsoft 365 is a **one-time, global** setup (not per-person). Once
done, every invite/reset **emails the link automatically** to the recipient, for
all users, and the copy-link box disappears for good.

This document has two parts:
- **Part 1 — for your Microsoft 365 / Entra admin** (needs tenant-admin rights).
- **Part 2 — for us to finish in Vercel** (no admin rights needed).

---

## Part 1 — Microsoft 365 / Entra admin

> This part requires a tenant-admin role (Global Administrator, or Application
> Administrator + Cloud Application Administrator to grant consent). Forward this
> section to whoever administers the Kouriten Microsoft 365 tenant.

**Goal:** let the Finance OS app send invite and password-reset emails from
`no-reply@kouriten.com` via Microsoft Graph (application permissions,
client-credentials flow).

1. **Register an application** — Entra ID → **App registrations** → **New
   registration**.
   - Name: `Miniso UK Finance OS — mailer`
   - Supported account types: **Accounts in this organizational directory only**
     (single tenant)
   - Redirect URI: **leave blank** → **Register**

2. **Add the send-mail permission** — in the app: **API permissions** → **Add a
   permission** → **Microsoft Graph** → **Application permissions** → search
   **`Mail.Send`** → **Add**. Then **Grant admin consent** and confirm it shows
   a green **Granted**. *(Essential — without consent, sends fail with 403.)*

3. **Create a client secret** — **Certificates & secrets** → **Client secrets**
   → **New client secret** (24-month expiry). **Copy the *Value* immediately** —
   it is shown only once. (Copy the *Value*, not the *Secret ID*.)

4. **Confirm the sender mailbox** — ensure `no-reply@kouriten.com` exists. A
   **shared mailbox** is ideal (no licence required).

5. *(Optional, recommended)* **Restrict the app to only send as that mailbox.**
   By default `Mail.Send` (application) can send as any mailbox in the tenant.
   Scope it down in Exchange Online PowerShell (`Connect-ExchangeOnline`):

   ```powershell
   New-DistributionGroup -Name "FinanceOS Mail Senders" -Type Security `
     -PrimarySmtpAddress financeos-senders@kouriten.com
   Add-DistributionGroupMember -Identity "FinanceOS Mail Senders" `
     -Member no-reply@kouriten.com
   New-ApplicationAccessPolicy -AppId <CLIENT_ID> `
     -PolicyScopeGroupId financeos-senders@kouriten.com `
     -AccessRight RestrictAccess `
     -Description "Restrict Finance OS app to the no-reply mailbox"
   # verify:
   Test-ApplicationAccessPolicy -Identity no-reply@kouriten.com -AppId <CLIENT_ID>
   ```
   > This is PowerShell for Exchange Online — **not** a SQL query and not part of
   > the app database.

### Please send back (securely)
- **Directory (tenant) ID**
- **Application (client) ID**
- **Client secret — Value** (not the Secret ID)
- Confirmation the sender is `no-reply@kouriten.com`

> The client secret is a credential — please share it via a secure channel, not
> plain email. It can be rotated at any time by creating a new secret.

---

## Part 2 — Finish in Vercel (no admin rights needed)

Once the four values are back:

1. **Vercel** → project → **Settings** → **Environment Variables**, add for
   **Production**:

   | Variable | Value |
   | --- | --- |
   | `MS_GRAPH_TENANT_ID` | Directory (tenant) ID |
   | `MS_GRAPH_CLIENT_ID` | Application (client) ID |
   | `MS_GRAPH_CLIENT_SECRET` | the secret **Value** |
   | `MS_GRAPH_SENDER` | `no-reply@kouriten.com` |
   | `APP_BASE_URL` | the production URL, e.g. `https://finance.kouriten.com` |

2. **Redeploy** (Deployments → latest → **Redeploy**). Environment variables
   only take effect on a new deployment.

3. **Verify**:
   - Open **`/api/health`** → `config.graphEmail` should read **`set`** (was
     `MISSING`).
   - In **Govern › Users**, use **Send invite** / **Email reset link** on a
     user → it should report the email was **sent**, with **no copy-link box**.

After this, invites and resets email automatically to everyone — the manual
copy-link step is gone.

---

## Notes

- **Secret expiry:** the client secret expires (24 months if set as above). When
  it lapses, email silently stops — set a reminder to rotate it (create a new
  secret, update `MS_GRAPH_CLIENT_SECRET` in Vercel, redeploy).
- **No database changes** are involved in this setup. The only DB migration for
  the feature (`044`) is already applied.
- **Fallback always available:** if the Graph variables are ever missing or a
  send fails, the app falls back to showing the admin a one-time copy-link, so
  onboarding is never blocked.
- See `docs/phase-email-invites.md` for how the invite/token mechanism works.
