"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "../../lib/notification-rules";

// Client inbox: renders the feed, marks items read (on open or explicitly),
// and "mark all read". Relative times are computed after mount to avoid any
// server/client hydration mismatch on the clock.
export default function InboxUI({ initial }) {
  const router = useRouter();
  const [items, setItems] = useState(initial || []);
  const [now, setNow] = useState(null);
  useEffect(() => { setNow(Date.now()); }, []);

  const unread = items.filter((n) => !n.read_at).length;
  const timeLabel = (iso) => (now ? relativeTime(new Date(iso).getTime(), now) : "");

  const post = (body) => fetch("/api/notifications", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  const markRead = (id) => {
    setItems((xs) => xs.map((n) => (n.notification_id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
    post({ action: "markRead", notificationId: id });
  };
  const markAll = () => {
    setItems((xs) => xs.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    post({ action: "markAllRead" });
  };
  const open = (n) => {
    if (!n.read_at) markRead(n.notification_id);
    if (n.link) router.push(n.link);
  };

  if (!items.length) {
    return (
      <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "20px 18px", textAlign: "center" }}>
        You&rsquo;re all caught up — no notifications.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>{unread} unread · {items.length} total</div>
        <button className="fos-btn-ghost" onClick={markAll} disabled={!unread}>Mark all read</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((n) => {
          const isUnread = !n.read_at;
          return (
            <div key={n.notification_id}
              onClick={() => open(n)}
              style={{
                display: "flex", gap: 12, alignItems: "flex-start", cursor: n.link ? "pointer" : "default",
                background: "var(--surface)", border: "1px solid " + (isUnread ? "var(--accent-deep)" : "var(--line)"),
                borderRadius: "var(--radius)", padding: "12px 14px",
              }}>
              <span aria-hidden style={{ marginTop: 5, width: 8, height: 8, borderRadius: "50%", flex: "none", background: isUnread ? "var(--accent)" : "transparent", border: isUnread ? "none" : "1px solid var(--line-strong)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: isUnread ? 650 : 500, color: "var(--ink)" }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{n.body}</div>}
                <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4, fontFamily: "var(--mono)" }}>
                  {n.actor ? `${n.actor} · ` : ""}{timeLabel(n.created_at)}
                </div>
              </div>
              {isUnread && (
                <button className="fos-btn-ghost" style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
                  onClick={(e) => { e.stopPropagation(); markRead(n.notification_id); }}>
                  Mark read
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
