"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type ChatMessage = {
  id: string;
  ministryId: string;
  churchId: string;
  userId: string;
  userName?: string;
  text: string;
  createdAt: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

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

export default function MinistryChat(props: { ministryId: string; title?: string }) {
  const { ministryId, title = "💬 Ministry Group Chat" } = props;

  const [items, setItems] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);

  const wrap: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.26)",
    padding: 14,
  };

  const btn: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.20)",
    color: "inherit",
    fontWeight: 900,
    cursor: "pointer",
  };

  const input: CSSProperties = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    outline: "none",
  };

  const sorted = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];
    arr.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    return arr;
  }, [items]);

  function scrollToBottom() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  async function load() {
    if (!ministryId) return;
    setLoading(true);
    setError("");
    try {
      const url = "/api/church/ministry-chat?ministryId=" + encodeURIComponent(ministryId);
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const json = await readApi<ChatMessage[]>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(msg || "Failed to load chat");
        setItems([]);
        return;
      }

      const data = Array.isArray(json.data) ? json.data : [];
      setItems(data);

      // slight delay to ensure DOM rendered
      setTimeout(scrollToBottom, 50);
    } catch {
      setError("Network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const clean = String(text || "").trim();
    if (!clean) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/church/ministry-chat", {
        method: "POST",
        credentials: "include",
        headers: { ...devHeaders(), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ministryId, text: clean }),
      });

      const json = await readApi<ChatMessage>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(msg || "Failed to send");
        return;
      }

      setText("");
      setItems((cur) => {
        const next = Array.isArray(cur) ? [...cur] : [];
        next.push(json.data);
        return next;
      });

      setTimeout(scrollToBottom, 50);
    } catch {
      setError("Network error");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId]);

  return (
    <div id="chat" style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 1000, fontSize: 15 }}>{title}</div>
          <div style={{ opacity: 0.72, fontSize: 12, marginTop: 4 }}>
            API: <b>/api/church/ministry-chat</b> • ministryId: <span style={{ opacity: 0.95 }}>{ministryId}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={load} disabled={loading} style={btn}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 10, color: "salmon", fontWeight: 900, whiteSpace: "pre-wrap" }}>
          ⛔ {error}
        </div>
      ) : null}

      <div
        ref={listRef}
        style={{
          marginTop: 12,
          height: 320,
          overflow: "auto",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(0,0,0,0.18)",
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        {sorted.length === 0 ? (
          <div style={{ opacity: 0.75 }}>
            {loading ? "Loading messages..." : "No messages yet. Andika message ya kwanza ✅"}
          </div>
        ) : (
          sorted.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 950 }}>
                  {m.userName || "Member"} <span style={{ opacity: 0.7, fontWeight: 800 }}>• {m.userId}</span>
                </div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                </div>
              </div>

              <div style={{ marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <input
          style={input}
          placeholder="Andika message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!sending) send();
            }
          }}
        />
        <button onClick={send} disabled={sending || !String(text).trim()} style={btn}>
          {sending ? "..." : "Send"}
        </button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
        Tip: Press <b>Enter</b> kutuma. (Shift+Enter = new line)
      </div>
    </div>
  );
}
