"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties , useRef } from "react";
import { useParams } from "next/navigation";
import MinistryChat from "./_components/MinistryChat";

type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: "Active" | "Paused";
  churchId: string;
  createdAt: string;
};

type MinistryMemberRole = "Leader" | "Assistant" | "Member";

type MinistryMember = {
  id: string;
  churchId: string;
  ministryId: string;
  userId: string;
  role: MinistryMemberRole;
  createdAt: string;
  updatedAt?: string;
};

type ChatMessage = {
  id: string;
  churchId: string;
  ministryId: string;
  userId: string;
  userName?: string;
  text: string;
  createdAt: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

function devHeaders(): Record<string, string> {
  // client-only localStorage opt-in: localStorage.kristo_dev_header_auth="1"
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

export default function MinistryProfilePage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "");


  const loadInFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ministry, setMinistry] = useState<Ministry | null>(null);

  // Stats
  const [membersCount, setMembersCount] = useState<number>(0);
  const [leadersCount, setLeadersCount] = useState<number>(0);
  const [assistantsCount, setAssistantsCount] = useState<number>(0);
  const [lastChatAt, setLastChatAt] = useState<string>("");

  async function load() {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/church/ministries?id=" + encodeURIComponent(ministryId), {
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
        signal: ac.signal,
      });

      const json = (await res.json().catch(() => null)) as ApiRes<Ministry> | null;
      if (!res.ok || !json || !json.ok) {
        setError("Failed to load ministry");
        setMinistry(null);
        return;
      }

      const m = json.data || null;
      setMinistry(m);
      if (!m) setError("Ministry not found");
    } catch {
      setError("Network error");
      setMinistry(null);
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      // 1) members for THIS ministry
      const mres = await fetch(`/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const mj = (await mres.json().catch(() => null)) as ApiRes<MinistryMember[]> | null;
      const arr: MinistryMember[] =
        mres.ok && mj && mj.ok && Array.isArray(mj.data) ? (mj.data as MinistryMember[]) : [];

      const total = arr.length;
      const leaders = arr.filter((x) => String(x.role || "").toLowerCase() === "leader").length;
      const assistants = arr.filter((x) => String(x.role || "").toLowerCase() === "assistant").length;

      setMembersCount(total);
      setLeadersCount(leaders);
      setAssistantsCount(assistants);

      // 2) last chat message time
      const cres = await fetch(`/api/church/ministry-chat?ministryId=${encodeURIComponent(ministryId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const cj = (await cres.json().catch(() => null)) as ApiRes<ChatMessage[]> | null;
      const msgs: ChatMessage[] = cres.ok && cj && cj.ok && Array.isArray(cj.data) ? (cj.data as ChatMessage[]) : [];
      let lastAt = "";
      for (const m of msgs) {
        const t = String((m as any)?.createdAt || "");
        if (t && (!lastAt || t > lastAt)) lastAt = t;
      }
      setLastChatAt(String(lastAt || ""));
    } catch {
      // non-blocking stats
    }
  }

  useEffect(() => {
    if (!ministryId) return;
    load();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId]);

  const wrap: CSSProperties = { padding: 18, maxWidth: 1100, margin: "0 auto" };
  const grid: CSSProperties = { display: "grid", gridTemplateColumns: "1.35fr 0.65fr", gap: 14 };
  const card: CSSProperties = {
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
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  const statusChip = (s?: string) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.14)",
      background: s === "Active" ? "rgba(46, 204, 113, 0.14)" : "rgba(241, 196, 15, 0.14)",
      fontWeight: 950,
      fontSize: 12,
    } as const);

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 1000, marginBottom: 6 }}>🏷️ Ministry Profile</div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            ID: <span style={{ opacity: 0.95 }}>{ministryId}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/dashboard/church/ministries" style={btn}>
            ← Back to Ministries
          </Link>

          <button
            onClick={async () => {
              await load();
              await loadStats();
            }}
            disabled={loading}
            style={btn}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div style={{ color: "tomato", marginBottom: 12, whiteSpace: "pre-wrap" }}>{error}</div> : null}

      <div style={grid}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={card}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 1000 }}>{ministry?.name || "—"}</div>
                <div style={{ opacity: 0.82, marginTop: 6, lineHeight: 1.5 }}>
                  {ministry?.description || "No description"}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={statusChip(ministry?.status)}>{ministry?.status || "—"}</span>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>
                    created: {ministry?.createdAt ? new Date(ministry.createdAt).toLocaleString() : "—"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}/leader`} style={btn}>
                  🛡️ Leader Dashboard
                </Link>
                <Link href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}/member`} style={btn}>
                  👤 Member Dashboard
                </Link>
                <Link href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}#chat`} style={btn}>
                  💬 Jump to Chat
                </Link>
              </div>
            </div>

            <div style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>
              VIP next: tasks, announcements, schedule, requests…
            </div>
          </div>

          <div id="chat" style={{ scrollMarginTop: 90 }}>
            <MinistryChat ministryId={ministryId} title="💬 Ministry Group Chat" />
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={card}>
            <div style={{ fontWeight: 1000, marginBottom: 10 }}>⚡ Quick Actions (VIP)</div>
            <div style={{ display: "grid", gap: 10 }}>
              <Link href={`/dashboard/church/ministries`} style={btn}>
                📌 Manage ministries
              </Link>
              <Link href={`/dashboard/church/ministries?open=${encodeURIComponent(ministryId)}`} style={btn}>
                👥 Manage members
              </Link>
              <Link href={`/dashboard/church/notifications`} style={btn}>
                🔔 Church notifications
              </Link>
            </div>
            <div style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>
              Hapa baadaye tutaongeza: Rename, Toggle status, Delete (role-gated).
            </div>
          </div>

          <div style={card}>
            <div style={{ fontWeight: 1000, marginBottom: 10 }}>📊 Stats</div>
            <div style={{ display: "grid", gap: 8, opacity: 0.9, lineHeight: 1.6 }}>
              <div>
                <b>Members:</b> {membersCount}
              </div>
              <div>
                <b>Leaders:</b> {leadersCount}
              </div>
              <div>
                <b>Assistants:</b> {assistantsCount}
              </div>
              <div>
                <b>Last chat:</b> {lastChatAt ? new Date(lastChatAt).toLocaleString() : "—"}
              </div>
            </div>

            <div style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>
              (Stats zinatoka /api/church/ministry-members + /api/church/ministry-chat)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
