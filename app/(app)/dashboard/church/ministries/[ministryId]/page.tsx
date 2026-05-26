"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, useRef } from "react";
import { useParams } from "next/navigation";

const DEV_USER_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_USER_ID || "";
const DEV_ROLE = process.env.NEXT_PUBLIC_KRISTO_DEV_ROLE || "";
const DEV_CHURCH_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_CHURCH_ID || "";

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

type ChurchMember = {
  membershipId: string;
  churchId: string;
  userId: string;
  name: string;
  roleLabel?: string;
  joinedAt: string;
  updatedAt?: string;
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

function withDevQuery(path: string) {
  if (typeof window === "undefined") return path;
  try {
    const enabled = String(localStorage.getItem("kristo_dev_header_auth") || "").trim() === "1";
    const sp = new URLSearchParams(window.location.search);
    const q = new URLSearchParams();

    for (const [k, v] of sp.entries()) q.set(k, v);
    if (enabled && !q.get("devHeaderAuth")) q.set("devHeaderAuth", "1");

    const qs = q.toString();
    if (!qs) return path;
    return path + (path.includes("?") ? "&" : "?") + qs;
  } catch {
    return path;
  }
}

export default function MinistryProfilePage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "");
  const [devReady, setDevReady] = useState(false);


  const loadInFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ministry, setMinistry] = useState<Ministry | null>(null);

  // Stats
  const [membersCount, setMembersCount] = useState<number>(0);
  const [leadersCount, setLeadersCount] = useState<number>(0);
  const [assistantsCount, setAssistantsCount] = useState<number>(0);
  const [members, setMembers] = useState<MinistryMember[]>([]);
  const [lastChatAt, setLastChatAt] = useState<string>("");

  const [churchMembers, setChurchMembers] = useState<ChurchMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<MinistryMemberRole>("Member");
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [addMemberMessage, setAddMemberMessage] = useState("");
  const [addMemberError, setAddMemberError] = useState("");
  const [memberActionMessage, setMemberActionMessage] = useState("");
  const [memberActionError, setMemberActionError] = useState("");
  const [memberActionId, setMemberActionId] = useState("");
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, MinistryMemberRole>>({});
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; userId: string } | null>(null);

  async function load() {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError("");
    try {
      const res = await fetch(withDevQuery("/api/church/ministries?id=" + encodeURIComponent(ministryId)), {
        cache: "no-store",
        headers: {
  "accept": "application/json",
  "x-kristo-user-id": "u-demo-1",
  "x-kristo-role": "System_Admin",
  "x-kristo-church-id": "c-demo-1"
},
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const v = String(sp.get("devHeaderAuth") || "").trim();
      if (v == "1" || v == "0") {
        localStorage.setItem("kristo_dev_header_auth", v);
      } else if (!localStorage.getItem("kristo_dev_header_auth")) {
        localStorage.setItem("kristo_dev_header_auth", "0");
      }

      if (DEV_USER_ID && !localStorage.getItem("kristo_dev_user_id")) {
        localStorage.setItem("kristo_dev_user_id", DEV_USER_ID);
      }
      if (DEV_ROLE && !localStorage.getItem("kristo_dev_role")) {
        localStorage.setItem("kristo_dev_role", DEV_ROLE);
      }
      if (DEV_CHURCH_ID && !localStorage.getItem("kristo_dev_church_id")) {
        localStorage.setItem("kristo_dev_church_id", DEV_CHURCH_ID);
      }
    } catch {}
    setDevReady(true);
  }, []);

  async function loadChurchMembers() {
    try {
      const res = await fetch(withDevQuery("/api/church/members"), {
        method: "GET",
        cache: "no-store",
        headers: {
          "accept": "application/json",
          "x-kristo-user-id": "u-demo-1",
          "x-kristo-role": "System_Admin",
          "x-kristo-church-id": "c-demo-1",
        },
      });

      const j = (await res.json().catch(() => null)) as ApiRes<ChurchMember[]> | null;
      const arr: ChurchMember[] = res.ok && j && j.ok && Array.isArray(j.data) ? (j.data as ChurchMember[]) : [];
      setChurchMembers(arr);
    } catch {
      setChurchMembers([]);
    }
  }

  async function loadStats() {
    try {
      // 1) members for THIS ministry
      const mres = await fetch(withDevQuery(`/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`), {
        method: "GET",
        cache: "no-store",
        headers: {
  "accept": "application/json",
  "x-kristo-user-id": "u-demo-1",
  "x-kristo-role": "System_Admin",
  "x-kristo-church-id": "c-demo-1"
},
      });

      const mj = (await mres.json().catch(() => null)) as ApiRes<MinistryMember[]> | null;
      const arr: MinistryMember[] =
        mres.ok && mj && mj.ok && Array.isArray(mj.data) ? (mj.data as MinistryMember[]) : [];

      setMembers(arr);

      const total = arr.length;
      const leaders = arr.filter((x) => String(x.role || "").toLowerCase() === "leader").length;
      const assistants = arr.filter((x) => String(x.role || "").toLowerCase() === "assistant").length;

      setMembersCount(total);
      setLeadersCount(leaders);
      setAssistantsCount(assistants);

      // 2) last chat message time
      const cres = await fetch(withDevQuery(`/api/church/ministry-chat?ministryId=${encodeURIComponent(ministryId)}`), {
        method: "GET",
        cache: "no-store",
        headers: {
  "accept": "application/json",
  "x-kristo-user-id": "u-demo-1",
  "x-kristo-role": "System_Admin",
  "x-kristo-church-id": "c-demo-1"
},
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
    if (!ministryId || !devReady) return;
    load();
    loadStats();
    loadChurchMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId, devReady]);

  useEffect(() => {
    setMemberRoleDrafts((prev) => {
      const next: Record<string, MinistryMemberRole> = {};
      for (const m of members) next[m.id] = prev[m.id] || m.role;
      return next;
    });
  }, [members]);

  async function changeMemberRole(memberId: string, nextRole: MinistryMemberRole) {
    if (!memberId) return;
    setMemberActionId(memberId);
    setMemberActionError("");
    setMemberActionMessage("");

    try {
      const res = await fetch(`/api/church/ministry-members?id=${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-kristo-user-id": "u-demo-1",
          "x-kristo-role": "System_Admin",
          "x-kristo-church-id": "c-demo-1",
        },
        body: JSON.stringify({ role: nextRole }),
      });

      const j = (await res.json().catch(() => null)) as ApiRes<MinistryMember> | null;

      if (!res.ok || !j || !j.ok) {
        setMemberActionError((j as ApiErr | null)?.error || "Failed to update role");
        setMemberRoleDrafts((prev) => {
          const current = members.find((x) => x.id === memberId)?.role || "Member";
          return { ...prev, [memberId]: current };
        });
        return;
      }

      setMemberActionMessage(`Updated ${j.data.userId} to ${j.data.role}`);
      setMemberRoleDrafts((prev) => ({ ...prev, [memberId]: j.data.role }));
      await load();
      await loadStats();
    } catch {
      setMemberActionError("Network error");
      setMemberRoleDrafts((prev) => {
        const current = members.find((x) => x.id === memberId)?.role || "Member";
        return { ...prev, [memberId]: current };
      });
    } finally {
      setMemberActionId("");
    }
  }

  async function removeMember(memberId: string) {
    if (!memberId) return;
    const row = members.find((x) => x.id === memberId);
    const label = row?.userId || "this member";

    setRemoveConfirm(null);
    setMemberActionId(memberId);
    setMemberActionError("");
    setMemberActionMessage("");

    try {
      const res = await fetch(`/api/church/ministry-members?id=${encodeURIComponent(memberId)}`, {
        method: "DELETE",
        headers: {
          "accept": "application/json",
          "x-kristo-user-id": "u-demo-1",
          "x-kristo-role": "System_Admin",
          "x-kristo-church-id": "c-demo-1",
        },
      });

      const j = (await res.json().catch(() => null)) as ApiRes<{ id?: string }> | null;

      if (!res.ok || !j || !j.ok) {
        setMemberActionError((j as ApiErr | null)?.error || "Failed to remove member");
        return;
      }

      setMemberActionMessage(`Removed ${label}`);
      setMemberRoleDrafts((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      await load();
      await loadStats();
    } catch {
      setMemberActionError("Network error");
    } finally {
      setMemberActionId("");
    }
  }

  async function addMember() {
    const uid = memberUserId.trim();
    if (!uid) {
      setAddMemberError("Enter userId");
      setAddMemberMessage("");
      return;
    }

    setMemberSubmitting(true);
    setAddMemberError("");
    setAddMemberMessage("");
    setMemberActionError("");
    setMemberActionMessage("");

    try {
      const res = await fetch("/api/church/ministry-members", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-kristo-user-id": "u-demo-1",
          "x-kristo-role": "System_Admin",
          "x-kristo-church-id": "c-demo-1",
        },
        body: JSON.stringify({
          ministryId,
          userId: uid,
          role: memberRole,
        }),
      });

      const j = (await res.json().catch(() => null)) as ApiRes<MinistryMember> | null;

      if (!res.ok || !j || !j.ok) {
        setAddMemberError((j as ApiErr | null)?.error || "Failed to add member");
        setAddMemberMessage("");
        return;
      }

      setAddMemberMessage(`Added ${uid} as ${memberRole}`);
      setAddMemberError("");
      setMemberUserId("");
      setMemberRole("Member");
      await load();
      await loadStats();
      await loadChurchMembers();
    } catch {
      setAddMemberError("Network error");
      setAddMemberMessage("");
    } finally {
      setMemberSubmitting(false);
    }
  }

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
              await loadChurchMembers();
            }}
            disabled={loading}
            style={btn}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {!devReady ? (
        <div style={{ opacity: 0.8, marginBottom: 12 }}>Preparing ministry view...</div>
      ) : error ? (
        <div style={{ color: "tomato", marginBottom: 12, whiteSpace: "pre-wrap" }}>{error}</div>
      ) : null}

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
                <Link href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}/chat`} style={btn}>
                  💬 Jump to Chat
                </Link>
              </div>
            </div>

          </div>

          <div style={card}>
            <div style={{ fontWeight: 1000, marginBottom: 10 }}>➕ Add Member</div>

            <div style={{ display: "grid", gap: 10 }}>
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search church member..."
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "inherit",
                  outline: "none",
                }}
              />

              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: 6,
                  background: "rgba(0,0,0,0.25)",
                }}
              >
                {churchMembers
                  .filter((cm) => !members.some((mm) => mm.userId === cm.userId))
                  .filter((cm) =>
                    (cm.name || "").toLowerCase().includes(memberSearch.toLowerCase()) ||
                    cm.userId.toLowerCase().includes(memberSearch.toLowerCase())
                  )
                  .slice(0, 20)
                  .map((cm) => {
                    const selected = memberUserId === cm.userId;
                    const initials = (cm.name || cm.userId)
                      .split(" ")
                      .map((x) => x[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();

                    return (
                      <div
                        key={cm.userId}
                        onClick={() => setMemberUserId(cm.userId)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "translateY(-2px)";
                          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "translateY(0px)";
                          e.currentTarget.style.background = selected
                            ? "rgba(46,204,113,0.12)"
                            : "rgba(255,255,255,0.02)";
                        }}
                        style={{
                          padding: "12px",
                          borderRadius: 12,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          border: selected
                            ? "1px solid rgba(46,204,113,0.6)"
                            : "1px solid transparent",
                          background: selected
                            ? "rgba(46,204,113,0.12)"
                            : "rgba(255,255,255,0.02)",
                          transition: "all 0.2s ease",
                          boxShadow: selected
                            ? "0 0 0 1px rgba(46,204,113,0.4), 0 6px 18px rgba(46,204,113,0.15)"
                            : "0 2px 10px rgba(0,0,0,0.25)",
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 900,
                            background: "rgba(255,255,255,0.08)",
                          }}
                        >
                          {initials}
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 900 }}>
                            {cm.name || cm.userId}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.6 }}>
                            {cm.userId}
                          </div>
                        </div>

                        {selected ? (
                          <div style={{ fontSize: 14 }}>✔</div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>

              {memberUserId ? (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    fontSize: 13,
                    opacity: 0.92,
                  }}
                >
                  👤 Selected:{" "}
                  <b>
                    {churchMembers.find((cm) => cm.userId === memberUserId)?.name || memberUserId}
                  </b>
                  <span style={{ opacity: 0.72 }}>
                    {" "}
                    • {memberUserId}
                  </span>
                </div>
              ) : null}

              <select
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as MinistryMemberRole)}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "inherit",
                  outline: "none",
                }}
              >
                <option value="Member">Member</option>
                <option value="Assistant">Assistant</option>
                <option value="Leader">Leader</option>
              </select>

              <button
                onClick={addMember}
                disabled={memberSubmitting}
                style={btn}
              >
                {memberSubmitting ? "Adding..." : "Add Member"}
              </button>

              {addMemberError ? (
                <div style={{ color: "tomato", fontSize: 13 }}>{addMemberError}</div>
              ) : null}

              {addMemberMessage ? (
                <div style={{ color: "#7CFC98", fontSize: 13 }}>{addMemberMessage}</div>
              ) : null}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontWeight: 1000, marginBottom: 10 }}>
              👥 Members ({members.length})
            </div>

            {memberActionError ? (
              <div
                style={{
                  marginBottom: 10,
                  color: "tomato",
                  fontSize: 13,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,99,99,0.18)",
                  background: "rgba(255,99,99,0.08)",
                }}
              >
                {memberActionError}
              </div>
            ) : null}

            {memberActionMessage ? (
              <div
                style={{
                  marginBottom: 10,
                  color: "#7CFC98",
                  fontSize: 13,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(124,252,152,0.18)",
                  background: "rgba(124,252,152,0.08)",
                }}
              >
                {memberActionMessage}
              </div>
            ) : null}

            {removeConfirm ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(255,99,99,0.22)",
                  background: "rgba(255,99,99,0.08)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 900 }}>Remove member?</div>
                <div style={{ opacity: 0.82, fontSize: 13 }}>
                  Are you sure you want to remove <b>{removeConfirm.userId}</b> from this ministry?
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => setRemoveConfirm(null)}
                    style={btn}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => removeMember(removeConfirm.id)}
                    style={{
                      ...btn,
                      border: "1px solid rgba(255,99,99,0.28)",
                      background: "rgba(255,99,99,0.12)",
                    }}
                  >
                    Confirm remove
                  </button>
                </div>
              </div>
            ) : null}

            {members.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No ministry members yet</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {members.map((m) => {
                  const currentDraft = memberRoleDrafts[m.id] || m.role;
                  const roleBusy = memberActionId === m.id;

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 180 }}>
                        <div style={{ fontWeight: 900 }}>{m.userId}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          Joined: {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "-"}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background:
                              m.role === "Leader"
                                ? "rgba(241,196,15,0.18)"
                                : m.role === "Assistant"
                                ? "rgba(52,152,219,0.18)"
                                : "rgba(255,255,255,0.08)",
                          }}
                        >
                          {m.role}
                        </div>

                        <select
                          value={currentDraft}
                          disabled={roleBusy}
                          onChange={(e) => {
                            const nextRole = e.target.value as MinistryMemberRole;
                            setMemberRoleDrafts((prev) => ({ ...prev, [m.id]: nextRole }));
                          }}
                          style={{
                            minWidth: 150,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "rgba(255,255,255,0.04)",
                            color: "inherit",
                            outline: "none",
                          }}
                        >
                          <option value="Member">Member</option>
                          <option value="Assistant">Assistant</option>
                          <option value="Leader">Leader</option>
                        </select>

                        <button
                          onClick={() => changeMemberRole(m.id, currentDraft)}
                          disabled={roleBusy || currentDraft === m.role}
                          style={{
                            ...btn,
                            opacity: roleBusy || currentDraft === m.role ? 0.55 : 1,
                          }}
                        >
                          {roleBusy ? "Saving..." : "Update"}
                        </button>

                        <button
                          onClick={() => setRemoveConfirm({ id: m.id, userId: m.userId })}
                          disabled={roleBusy}
                          style={{
                            ...btn,
                            border: "1px solid rgba(255,99,99,0.28)",
                            background: "rgba(255,99,99,0.10)",
                            opacity: roleBusy ? 0.55 : 1,
                          }}
                        >
                          {roleBusy ? "Working..." : "Remove"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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

          </div>
        </div>
      </div>
    </div>
  );
}
