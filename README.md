# Miniso UK — Finance Operating System

A connected dashboard platform for finance, built on one governed database so a
number means the same thing everywhere. Built with Next.js + Postgres.

It has two parts today:

1. **Month-end close tracker** — shared task tracking across every entity, with
   who/when stamps and a month-by-month history. (This is the original app.)
2. **Finance Operating System** (`/finance-os`) — the connected dashboard
   ecosystem: a registry of eight dashboards across four layers (strategy,
   performance, operations, executive), a shared data warehouse, a governed KPI
   catalogue, and an AI-insight log where every recommendation waits for a human
   to review it. The **Executive Intelligence Hub** is the first live dashboard;
   the others are scaffolded and marked "Coming soon".

The database design (schemas, tables, reporting views, KPI catalogue) lives in
[`db/schema.sql`](db/schema.sql).

---

## What it does

- One number up top: how many of your entities are fully closed this period.
- Four stage rollups (bank & cash, accruals & journals, AR/AP & intercompany,
  reporting/tax/sign-off) so you can see where the bottleneck is across the group.
- Expand any entity to tick off its tasks. Each tick records who did it and when.
- A period dropdown keeps each month separate, so you build a running history.
- Everyone on the team sees the same live state (auto-syncs every 15 seconds).

---

## Before you start

You'll need (all have free tiers that cover a 5-person team):
- A **GitHub** account (to hold the code).
- A **Vercel** account (hosting) — sign in with GitHub.
- A **Postgres** database. Easiest: **Neon** (neon.tech) or **Supabase**. Vercel's
  own Postgres works too.

I can't create these accounts or enter your credentials for you — those steps are
yours. Everything below is copy-paste.

---

## Step 1 — Get a database

1. Create a project on Neon (or Supabase / Vercel Postgres).
2. Copy the **connection string** (starts with `postgres://...`). Keep it handy.

## Step 2 — Put the code on GitHub

From this folder:

```bash
git init
git add .
git commit -m "Month-end close app"
```

Create an empty repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

## Step 3 — Deploy on Vercel

1. On Vercel, **Add New → Project**, import your GitHub repo.
2. Before deploying, open **Environment Variables** and add two:

   | Name             | Value |
   | ---------------- | ----- |
   | `DATABASE_URL`   | your Postgres connection string from step 1 |
   | `SESSION_SECRET` | a long random string (see below) |

   Generate the secret locally with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Click **Deploy**. You'll get a live URL like `your-app.vercel.app`.

## Step 4 — Create the database tables

Run once, locally, pointing at your real database:

```bash
npm install
DATABASE_URL="postgres://...your string..." npm run init-db
```

You should see `Database initialised`. This creates the month-end tables **and**
the full Finance Operating System schema (dimensions, facts, reporting views,
dashboard registry and KPI catalogue).

### Optional — load demo data so the dashboards aren't empty

Before you have real feeds connected, you can load illustrative demo data
(entities, stores, a year of budget/forecast/actual, KPIs and sample AI
insights) so you can see the dashboards working:

```bash
DATABASE_URL="postgres://...your string..." npm run seed-demo
```

Every figure it loads is invented for illustration. It's safe to re-run, and it
never touches your login accounts or month-end close data. Once real ETL feeds
are connected, stop running it.

## Step 5 — Add your team members (you set the passwords)

Run this once per person. It asks for name, email, and password, and stores the
password securely hashed — never in plain text:

```bash
DATABASE_URL="postgres://...your string..." npm run create-user
```

Do this for each of your 2–5 finance users. They log in at your Vercel URL with
the email and password you set.

---

## Customising the entities and tasks

Open `lib/close-config.js`. Replace the placeholder `ENTITIES` list with your
real 24 entity names, and adjust the `STAGES` / tasks to match your close
(e.g. transfer-pricing adjustments, VAT MOSS, parent consolidation). Commit and
push; Vercel redeploys automatically. Existing ticked tasks are keyed by entity
name + stage + position, so renaming an entity starts it fresh.

---

## Running locally (optional)

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and SESSION_SECRET
npm run init-db              # first time only
npm run create-user          # add yourself
npm run dev                  # http://localhost:3000
```

---

## Notes

- **Security:** passwords are bcrypt-hashed; sessions are signed JWTs in an
  httpOnly cookie, expiring after 12 hours. Keep `SESSION_SECRET` private.
- **Next.js version:** pinned to 15.5.19, the current patched release. Run
  `npm outdated next` periodically and bump to the latest 15.5.x to stay current.
  Ignore `npm audit`'s suggestion to run `--force` — it would downgrade Next to
  v9 and break the app; the maintainers ship security patches within the 15.5 line.
- **Backups:** your data lives in Postgres. Neon/Supabase handle backups; check
  your provider's settings if close history matters to you long-term.
- **Cost:** free tiers on Vercel + Neon/Supabase comfortably cover a small team.
