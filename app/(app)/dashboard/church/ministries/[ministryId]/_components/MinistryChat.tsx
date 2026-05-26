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

  const myUserId =
    typeof window !== "undefined"
      ? String(localStorage.getItem("kristo_dev_user_id") || "").trim()
      : "";

  const wrap: CSSProperties = {
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.22)",
    padding: 14,
    height: "calc(100vh - 150px)",
    minHeight: 640,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const btn: CSSProperties = {
    padding: "13px 18px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "inherit",
    fontWeight: 1000,
    cursor: "pointer",
  };

  const input: CSSProperties = {
    width: "100%",
    padding: "16px 18px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(15,15,15,0.96)",
    color: "inherit",
    outline: "none",
    fontSize: 16,
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
        headers: {
          ...devHeaders(),
          "content-type": "application/json",
          accept: "application/json",
        },
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

  useEffect(() => {
    setTimeout(scrollToBottom, 50);
  }, [sorted.length]);

  return (
    <div id="chat" style={wrap}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 1000, fontSize: 16 }}>{title}</div>
          <div style={{ opacity: 0.62, fontSize: 12, marginTop: 2 }}>
            ministryId: <span style={{ opacity: 0.9 }}>{ministryId}</span>
          </div>
        </div>

        <button onClick={load} disabled={loading} style={btn}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 10,
            color: "salmon",
            fontWeight: 1000,
            whiteSpace: "pre-wrap",
          }}
        >
          ⛔ {error}
        </div>
      ) : null}

      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingRight: 6,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.14)",
          padding: "14px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {sorted.length === 0 ? (
          <div style={{ opacity: 0.75 }}>
            {loading ? "Loading messages..." : "No messages yet. Andika message ya kwanza ✅"}
          </div>
        ) : (
          sorted.map((m) => {
            const mine = !!myUserId && m.userId === myUserId;
            const author = m.userName || m.userId || "Member";
            const when = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: mine ? "flex-end" : "flex-start",
                  width: "100%",
                  marginTop: 2,
                }}
              >
                <div
                  style={{
                    maxWidth: mine ? "72%" : "74%",
                    padding: "10px 14px 12px",
                    borderRadius: mine ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                    border: mine
                      ? "1px solid rgba(46,204,113,0.28)"
                      : "1px solid rgba(255,255,255,0.08)",
                    background: mine
                      ? "linear-gradient(180deg, #1f8f58, #176b42)"
                      : "rgba(32,32,32,0.96)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        opacity: mine ? 0.96 : 0.82,
                      }}
                    >
                      {mine ? "You" : author}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        opacity: 0.62,
                        whiteSpace: "nowrap",
                        marginLeft: 10,
                      }}
                    >
                      {when}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 15,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 10,
          alignItems: "center",
          position: "sticky",
          bottom: 0,
          background: "rgba(5,5,5,0.96)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 12,
          paddingBottom: 2,
        }}
      >
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

      <div style={{ marginTop: 8, opacity: 0.56, fontSize: 11 }}>
        Press <b>Enter</b> kutuma • <b>Shift+Enter</b> new line
      </div>
    </div>
  );
}
