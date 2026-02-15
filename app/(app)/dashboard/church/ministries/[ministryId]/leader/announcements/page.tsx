"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";

type Ann = {
  id: string;
  churchId: string;
  ministryId: string;
  title: string;
  body: string;
  pinned?: boolean;
  createdBy: { userId: string; role: string };
  createdAt: string;
  updatedAt?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

const pageWrap: CSSProperties = { padding: 16, maxWidth: 980, margin: "0 auto" };
const row: CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };
const card: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  borderRadius: 16,
  padding: 14,
};
const input: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.28)",
  color: "inherit",
  outline: "none",
};
const textarea: CSSProperties = { ...input, minHeight: 110, resize: "vertical" };
const btn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};
const dangerBtn: CSSProperties = { ...btn, border: "1px solid rgba(255,90,90,0.35)" };
const chip: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  fontSize: 12,
  fontWeight: 800,
};

export default function LeaderAnnouncementsPage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "");

  // DEMO headers (same style as other pages)
  const headers = useMemo(() => {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "x-kristo-user-id": "u-demo-1",
      "x-kristo-role": "Church_Admin",
      "x-kristo-church-id": "c-demo-1",
    };
    return h;
  }, []);

  const [items, setItems] = useState<Ann[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);

  async function load() {
    if (!ministryId) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/church/ministry-announcements?ministryId=${encodeURIComponent(ministryId)}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as ApiRes<Ann[]>;
      if (!r.ok || !j || (j as any).ok !== true) {
        setErr((j as any)?.error || `Load failed (${r.status})`);
        setItems([]);
      } else {
        setItems(Array.isArray((j as any).data) ? (j as any).data : []);
      }
    } catch (e: any) {
      setErr(e?.message || "Load failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setErr("");
    if (!title.trim() || !body.trim()) {
      setErr("Title + body required");
      return;
    }
    try {
      const r = await fetch(`/api/church/ministry-announcements`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ ministryId, title: title.trim(), body: body.trim(), pinned }),
      });
      const j = (await r.json().catch(() => ({}))) as ApiRes<Ann>;
      if (!r.ok || (j as any).ok !== true) {
        setErr((j as any)?.error || `Create failed (${r.status})`);
        return;
      }
      setTitle("");
      setBody("");
      setPinned(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Create failed");
    }
  }

  async function togglePinned(a: Ann) {
    setErr("");
    try {
      const r = await fetch(`/api/church/ministry-announcements`, {
        method: "PATCH",
        headers,
        cache: "no-store",
        body: JSON.stringify({ id: a.id, pinned: !a.pinned }),
      });
      const j = (await r.json().catch(() => ({}))) as ApiRes<Ann>;
      if (!r.ok || (j as any).ok !== true) {
        setErr((j as any)?.error || `Patch failed (${r.status})`);
        return;
      }
      await load();
    } catch (e: any) {
      setErr(e?.message || "Patch failed");
    }
  }

  async function remove(a: Ann) {
    if (!confirm("Delete this announcement?")) return;
    setErr("");
    try {
      const r = await fetch(`/api/church/ministry-announcements?id=${encodeURIComponent(a.id)}`, {
        method: "DELETE",
        headers,
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as ApiRes<any>;
      if (!r.ok || (j as any).ok !== true) {
        setErr((j as any)?.error || `Delete failed (${r.status})`);
        return;
      }
      await load();
    } catch (e: any) {
      setErr(e?.message || "Delete failed");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId]);

  return (
    <div style={pageWrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Announcements (Leader)</h1>
        <button style={btn} onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Create announcement</div>
        <div style={row}>
          <div style={{ flex: "1 1 320px" }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Title</div>
            <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Meeting today" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              <span style={{ fontWeight: 800 }}>Pinned</span>
            </label>
            <button style={btn} onClick={create}>Send</button>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Body</div>
          <textarea style={textarea} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write message to members..." />
        </div>

        {err ? <div style={{ marginTop: 10, color: "#ffb3b3", fontWeight: 800 }}>{err}</div> : null}
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {items.length === 0 ? (
          <div style={{ opacity: 0.85 }}>No announcements yet.</div>
        ) : (
          items.map((a) => (
            <div key={a.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>{a.title}</div>
                  {a.pinned ? <span style={chip}>PINNED</span> : null}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={btn} onClick={() => togglePinned(a)}>{a.pinned ? "Unpin" : "Pin"}</button>
                  <button style={dangerBtn} onClick={() => remove(a)}>Delete</button>
                </div>
              </div>

              <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{a.body}</div>

              <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
                {fmt(a.createdAt)} • by {a.createdBy?.role} ({a.createdBy?.userId})
                {a.updatedAt ? ` • updated ${fmt(a.updatedAt)}` : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
