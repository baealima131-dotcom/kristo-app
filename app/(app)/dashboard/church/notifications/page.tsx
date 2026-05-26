"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DEV_USER_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_USER_ID || "";
const DEV_ROLE = process.env.NEXT_PUBLIC_KRISTO_DEV_ROLE || "";
const DEV_CHURCH_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_CHURCH_ID || "";

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
type ApiErr = { ok: false; error: string; details?: unknown };
type ApiRes<T> = ApiOk<T> | ApiErr;

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

function explainAuthProblem(status: number, msg: string) {
  if (status === 401) {
    return (
      msg ||
      "Unauthorized. Kwa dev tumia KRISTO_DEV_AUTO_LOGIN=1 kwenye .env.local kisha restart dev server. Uki-test kwa headers, weka KRISTO_DEV_HEADER_AUTH=1 na utume x-kristo-user-id, x-kristo-role, x-kristo-church-id."
    );
  }
  if (status === 403) {
    return (
      msg ||
      "Forbidden. Role/church scope haikuruhusu. Hakikisha role ni Pastor au Church_Admin."
    );
  }
  return msg || "Request failed.";
}

async function readApi<T>(res: Response): Promise<ApiRes<T> | null> {
  try {
    return (await res.json()) as ApiRes<T>;
  } catch {
    return null;
  }
}

function okJson<T>(x: ApiRes<T> | null): x is ApiOk<T> {
  return !!x && (x as any).ok === true;
}

function devHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const enabled = String(localStorage.getItem("kristo_dev_header_auth") || "").trim();
    if (enabled !== "1") return {};

    const uid = String(localStorage.getItem("kristo_dev_user_id") || "").trim();
    const role = String(localStorage.getItem("kristo_dev_role") || "").trim();
    const cid = String(localStorage.getItem("kristo_dev_church_id") || "").trim();

    const h: Record<string, string> = {};
    if (uid) h["x-kristo-user-id"] = uid;
    if (role) h["x-kristo-role"] = role;
    if (cid) h["x-kristo-church-id"] = cid;
    return h;
  } catch {
    return {};
  }
}

/* =========================
   PAGE
   ========================= */

export default function ChurchNotificationsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [onlyUnread, setOnlyUnread] = useState(true);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = String(sp.get("devHeaderAuth") || "").trim();
      if (v === "1" || v === "0") localStorage.setItem("kristo_dev_header_auth", v);
    } catch {}
  }, [sp]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!localStorage.getItem("kristo_dev_header_auth")) localStorage.setItem("kristo_dev_header_auth", "0");
      if (DEV_USER_ID && !localStorage.getItem("kristo_dev_user_id")) localStorage.setItem("kristo_dev_user_id", DEV_USER_ID);
      if (DEV_ROLE && !localStorage.getItem("kristo_dev_role")) localStorage.setItem("kristo_dev_role", DEV_ROLE);
      if (DEV_CHURCH_ID && !localStorage.getItem("kristo_dev_church_id")) localStorage.setItem("kristo_dev_church_id", DEV_CHURCH_ID);
    } catch {}
  }, []);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const qs = new URLSearchParams();
      if (onlyUnread) qs.set("unread", "1");
      qs.set("limit", String(limit));

      const res = await fetch(`/api/church/notifications?${qs.toString()}`, {
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const json = await readApi<Notification[]>(res);

      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || `Failed to load (HTTP ${res.status})`));
        setItems([]);
        return;
      }

      setItems(Array.isArray(json.data) ? json.data : []);
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
        credentials: "include",
        headers: { ...devHeaders(), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ isRead }),
      });

      const json = await readApi<Notification>(res);

      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || `Failed to update (HTTP ${res.status})`));
        return;
      }

      setItems((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, isRead: json.data?.isRead ?? isRead, readAt: json.data?.readAt }
            : x
        )
      );

      if (onlyUnread && isRead) {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/church/notifications/mark-all", {
        method: "POST",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const json = await readApi<{ changed: number }>(res);

      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || `Failed to mark all read (HTTP ${res.status})`));
        return;
      }

      if (onlyUnread) {
        setItems([]);
      } else {
        setItems((prev) =>
          prev.map((x) => ({
            ...x,
            isRead: true,
            readAt: x.readAt || new Date().toISOString(),
          }))
        );
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function deleteOne(id: string) {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/church/notifications?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const json = await readApi<Notification>(res);

      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || `Failed to delete (HTTP ${res.status})`));
        return;
      }

      setItems((prev) => prev.filter((x) => x.id !== id));
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
    alert("Hakuna link ya hii notification (bado).");
  }

  const unreadCount = useMemo(() => items.filter((x) => !x.isRead).length, [items]);

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>🔔 Notifications</h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            API: <b>/api/church/notifications</b>
            {" • "}
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

          <button onClick={markAllRead} disabled={loading || items.length === 0}>
            Mark all read
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

                <button onClick={() => deleteOne(n.id)} disabled={loading}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, opacity: 0.8, fontSize: 12, lineHeight: 1.6 }}>
        Tip: Notifications zitaonekana zaidi tukianza ku-log events automatically kwenye API.
      </div>
    </div>
  );
}
