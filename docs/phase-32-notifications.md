# Phase 32 — Notifications (Tier 2.3, part 1 of Collaboration & notifications)

**Tier 2, item 3 ("Match the best").** A per-user notification feed — *"everything
that needs you, as it happens"* — which lights up the previously-PLANNED
**Notifications** module on the Home hub.

## What it does

- New **`/inbox`** page: the signed-in user's notification feed, newest first,
  with unread markers, per-item **Mark read** / open, and **Mark all read**.
- The **Notifications** nav item (Home section) is now **LIVE** → `/inbox`
  (previously a PLANNED placeholder whose noted dependency was a "Notification
  store" — now built).
- First **producer**: when an agent run produces outputs that land in
  `PENDING_REVIEW`, the agent's configured **reviewer** gets a notification
  linking to the review queue. Best-effort — a notification failure never fails
  the run, and it degrades silently if migration 034 hasn't been applied.

## Shape

- `db/migrations/034_notifications.sql` — `governance.notification` (recipient,
  kind, title, body, link, actor, object ref, `read_at`) + partial index for the
  unread badge and a recent-feed index.
- `lib/notification-rules.js` — **pure**: `relativeTime`, `unreadCount`,
  `badgeLabel` (unit-tested in `tests/notification-rules.test.mjs`).
- `lib/notifications.js` — **server**: `notifyUser`, `notifyUserByName`,
  `listForUser`, `unreadCountFor`, `markRead`, `markAllRead`. All writes swallow
  a missing table (42P01) so producers are safe pre-migration.
- `app/api/notifications/route.js` — `GET` (feed, or `?count` for the unread
  badge), `POST` (`markRead` / `markAllRead`) — scoped to the caller only.
- `app/inbox/{page,inbox-ui}.js` — server page + client feed.
- `lib/agents.js` — the reviewer-notification producer.
- `lib/nav-registry.js` — Notifications flipped to LIVE.

## Not yet in this part (fast-follow, part 2)

- **Top-bar bell + unread badge** — deliberately left off this cut to avoid
  touching the shared app shell mid-stream; the sidebar **Notifications** link is
  the entry point for now. `badgeLabel` / the `?count` endpoint are already built
  for it.
- **@mentions on comments** — the collaboration half: parse `@name` in comments
  (building on the existing `workflow.task_comment`) and notify the mentioned
  user via `notifyUser`. Producer #2.
- More producers (task assignment, review decisions).

## Migration to run at merge

- **034** — creates `governance.notification`. Until it's applied, the producer
  and reads no-op cleanly (no errors); the inbox shows "all caught up".
