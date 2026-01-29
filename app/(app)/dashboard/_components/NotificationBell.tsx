"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Notification = {
  id: string;
  isRead: boolean;
};

type ApiOk<T> = { ok: true; data: T };
type ApiRes<T> = ApiOk<T> | { ok: false; error: string };

export default function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const alive = useRef(true);

  async function fetchUnreadCount() {
    try {
      // fetch unread notifications (cap to 200)
      const res = await fetch("/api/church/notifications?unread=1&limit=200", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiRes<Notification[]> | null;

      if (!alive.current) return;

      if (!res.ok || !json || (json as any).ok !== true) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      const data = Array.isArray((json as any).data) ? ((json as any).data as Notification[]) : [];
      setUnreadCount(data.length);
      setLoading(false);
    } catch {
      if (!alive.current) return;
      setUnreadCount(0);
      setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;

    // initial
    const t0 = setTimeout(() => fetchUnreadCount(), 0);
// lightweight polling
    const t = setInterval(fetchUnreadCount, 20000);

    return () => {
      alive.current = false;
      clearInterval(t);
    };
     
  }, []);

  return (
    <button
      type="button"
      onClick={() => router.push("/dashboard/church/notifications")}
      title={loading ? "Loading notifications..." : unreadCount ? `${unreadCount} unread` : "Notifications"}
      style={{
        position: "relative",
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(0,0,0,0.18)",
        color: "inherit",
        borderRadius: 12,
        padding: "10px 12px",
        cursor: "pointer",
        fontWeight: 900,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16 }}>
        🔔
      </span>
      <span style={{ fontSize: 13, opacity: 0.9 }}>Notifications</span>

      {unreadCount > 0 ? (
        <span
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            background: "rgba(239,68,68,0.95)",
            color: "white",
            fontSize: 12,
            fontWeight: 950,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid rgba(0,0,0,0.35)",
          }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
