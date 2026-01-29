"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/* =========================
   TYPES
   ========================= */

type NotificationType =
  | "MinistryMemberAdded"
  | "MinistryMemberRemoved"
  | "MinistryLeaderAssigned"
  | "MinistryLeaderRemoved"
  | "Generic";

type Notification = {
  id: string;
  churchId: string;

  type: NotificationType;
  title: string;
  message?: string;

  ministryId?: string;
  ministryMemberId?: string;
  targetUserId?: string;

  isRead: boolean;
  createdAt: string;
  readAt?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiRes<T> = ApiOk<T> | { ok: false; error: string };

/* =========================
   HELPERS
   ========================= */

function fmtDate(x?: string) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString();
}

function typeLabel(t: NotificationType) {
  if (t === "MinistryMemberAdded") return "Member Added";
  if (t === "MinistryMemberRemoved") return "Member Removed";
  if (t === "MinistryLeaderAssigned") return "Leader Assigned";
  if (t === "MinistryLeaderRemoved") return "Leader Removed";
  return "Notice";
}

/* =========================
   PAGE
   ========================= */

export default function ChurchNotificationsPage() {
  const router = useRouter();

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [onlyUnread, setOnlyUnread] = useState(true);
  const [limit, setLimit] = useState(50);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const qs = new URLSearchParams();
      if (onlyUnread) qs.set("unread", "1");
      qs.set("limit", String(limit));

      const res = await fetch(`/api/church/notifications?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiRes<Notification[]> | null;

      if (!res.ok || !json || (json as any).ok !== true) {
        setError((json as any)?.error || `Failed to load (HTTP ${res.status})`);
        setItems([]);
        return;
      }

      const ok = json as any;
      setItems(Array.isArray(ok?.data) ? ok.data : []);
    } catch {
      setError("Network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnread, limit]);

  async function markRead(id: string, isRead: boolean) {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/church/notifications?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isRead }),
      });

      const json = (await res.json().catch(() => null)) as ApiRes<Notification> | null;

      if (!res.ok || !json || (json as any).ok !== true) {
        setError((json as any)?.error || `Failed to update (HTTP ${res.status})`);
        return;
      }

      // update local
      setItems((prev) =>
        prev.map((x) => (x.id === id ? { ...x, isRead: (json as any).data?.isRead ?? isRead, readAt: (json as any).data?.readAt } : x))
      );

      // if onlyUnread, remove read items
      if (onlyUnread && isRead) {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function openTarget(n: Notification) {
    if (n.ministryId) {
      router.push(`/dashboard/church/ministries?open=${encodeURIComponent(n.ministryId)}`);
      return;
    }
    // fallback
    alert("Hakuna link ya hii notification (bado).");
  }

  const unreadCount = useMemo(() => items.filter((x) => !x.isRead).length, [items]);

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>🔔 Notifications</h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            {onlyUnread ? (
              <>
                Showing: <b>Unread</b>
              </>
            ) : (
              <>
                Showing: <b>All</b>
              </>
            )}{" "}
            • Count: <b>{items.length}</b> {onlyUnread ? "" : <>• Unread: <b>{unreadCount}</b></>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
            Unread only
          </label>

          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>

          <button onClick={load} disabled={loading}>
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(255,0,0,0.25)" }}>
          <b style={{ color: "red" }}>Error:</b> {error}
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {!loading && items.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No notifications</div>
        ) : null}

        {items.map((n) => (
          <div
            key={n.id}
            style={{
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.08)",
              padding: 12,
              background: n.isRead ? "rgba(0,0,0,0.02)" : "rgba(255, 215, 0, 0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 950 }}>
                  {n.title}{" "}
                  <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
                    [{typeLabel(n.type)}] • {fmtDate(n.createdAt)}
                  </span>
                </div>
                {n.message ? <div style={{ opacity: 0.9, marginTop: 6 }}>{n.message}</div> : null}
                {n.isRead && n.readAt ? (
                  <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>Read: {fmtDate(n.readAt)}</div>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => openTarget(n)}>Open</button>

                {n.isRead ? (
                  <button onClick={() => markRead(n.id, false)} disabled={loading}>
                    Mark Unread
                  </button>
                ) : (
                  <button onClick={() => markRead(n.id, true)} disabled={loading}>
                    Mark Read
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, opacity: 0.8, fontSize: 12, lineHeight: 1.6 }}>
        Tip: Notifications zitaonekana zaidi tukianza ku-log events (member added/removed, leader assigned) automatically kwenye API.
      </div>
    </div>
  );
}
