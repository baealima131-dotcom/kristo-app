// app/(app)/dashboard/church/roles/[roleId]/page.tsx
"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

/**
 * ROLE DASHBOARD (Demo UI)
 * - Each role has its own premium dashboard
 * - Shows: overview, members under role, tasks, announcements, quick actions
 * - Works with URL:
 *   /dashboard/church/roles/r3?ministry=choir
 */

type RoleScope = "Church" | "Ministry";

type Role = {
  id: string;
  name: string;
  scope: RoleScope;
  description?: string;

  canManageMembers?: boolean;
  canManageMinistries?: boolean;
  canPostAnnouncements?: boolean;

  createdAt: string;
};

type Member = {
  id: string;
  fullName: string;
  phone?: string;
};

type Ministry = {
  id: string;
  name: string;
  description?: string;
};

type Assignment = {
  id: string;
  roleId: string;
  memberId: string;
  ministryId?: string;
  assignedAt: string;
};

type TaskStatus = "Todo" | "Doing" | "Done";

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  dueAt?: string;
};

type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

function isoNow() {
  return new Date().toISOString();
}
function fmt(x?: string) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString();
}
function byId<T extends { id: string }>(arr: T[]) {
  const m = new Map<string, T>();
  for (const x of arr) m.set(x.id, x);
  return m;
}

/* =========================
   DEMO DATA (same spirit as roles page)
   ========================= */

const DEMO_MEMBERS: Member[] = [
  { id: "m1", fullName: "Prince Fariji", phone: "+1 555 101" },
  { id: "m2", fullName: "Mama Asha", phone: "+1 555 202" },
  { id: "m3", fullName: "John Paul", phone: "+1 555 303" },
  { id: "m4", fullName: "Neema Grace", phone: "+1 555 404" },
];

const DEMO_MINISTRIES: Ministry[] = [
  { id: "choir", name: "Choir", description: "Waimbaji / Praise & Worship" },
  { id: "women", name: "Women Prayers", description: "Maombi ya wamama" },
  { id: "youth", name: "Youth", description: "Vijana" },
];

const DEMO_ROLES: Role[] = [
  {
    id: "r1",
    name: "Senior Pastor",
    scope: "Church",
    description: "Head of the church",
    canManageMembers: true,
    canManageMinistries: true,
    canPostAnnouncements: true,
    createdAt: "2024-08-01T10:00:00.000Z",
  },
  {
    id: "r2",
    name: "Church Secretary",
    scope: "Church",
    description: "Handles documentation & reporting",
    canPostAnnouncements: true,
    createdAt: "2024-08-02T10:00:00.000Z",
  },
  {
    id: "r3",
    name: "Ministry Leader",
    scope: "Ministry",
    description: "Kiongozi wa ministry husika",
    canPostAnnouncements: true,
    createdAt: "2024-08-03T10:00:00.000Z",
  },
  {
    id: "r4",
    name: "Ministry Assistant",
    scope: "Ministry",
    description: "Msaidizi wa kiongozi wa ministry",
    createdAt: "2024-08-03T10:30:00.000Z",
  },
  {
    id: "r5",
    name: "Ministry Treasurer",
    scope: "Ministry",
    description: "Mweka hazina wa ministry",
    createdAt: "2024-08-03T10:40:00.000Z",
  },
];

const DEMO_ASSIGNMENTS: Assignment[] = [
  { id: "a1", roleId: "r1", memberId: "m1", assignedAt: "2024-08-05T12:00:00.000Z" },
  { id: "a2", roleId: "r3", memberId: "m2", ministryId: "choir", assignedAt: "2024-08-06T12:00:00.000Z" },
  { id: "a3", roleId: "r5", memberId: "m3", ministryId: "women", assignedAt: "2024-08-06T12:05:00.000Z" },
];

export default function RoleDashboardPage() {
  const params = useParams();
  const sp = useSearchParams();

  const roleId = String((params as any)?.roleId || "").trim();
  const ministryId = String(sp.get("ministry") || "").trim();

  // tabs
  const [tab, setTab] = useState<"overview" | "members" | "tasks" | "announcements" | "settings">("overview");

  // local demo state
  const [tasks, setTasks] = useState<Task[]>([
    { id: "t1", title: "Panga ratiba ya wiki (rehearsal/meeting)", status: "Todo", createdAt: isoNow() },
    { id: "t2", title: "Kusanya majina ya washiriki wapya", status: "Doing", createdAt: isoNow() },
    { id: "t3", title: "Tuma ripoti kwa pastor", status: "Done", createdAt: isoNow() },
  ]);

  const [anns, setAnns] = useState<Announcement[]>([
    { id: "n1", title: "Kikao kesho", body: "Kila mtu afike saa 10 jioni. Tutapanga ratiba.", createdAt: isoNow() },
  ]);

  const role = useMemo(() => DEMO_ROLES.find((r) => r.id === roleId) || null, [roleId]);
  const roleScope = role?.scope || "Church";

  const memberMap = useMemo(() => byId(DEMO_MEMBERS), []);
  const ministryMap = useMemo(() => byId(DEMO_MINISTRIES), []);

  const assignments = useMemo(() => {
    // show assignments for this role; if role is ministry-scope, optionally filter by ministry query param
    const base = DEMO_ASSIGNMENTS.filter((a) => a.roleId === roleId);
    if (roleScope === "Ministry" && ministryId) return base.filter((a) => String(a.ministryId || "") === ministryId);
    return base;
  }, [roleId, roleScope, ministryId]);

  const scopeLabel = useMemo(() => {
    if (!role) return "—";
    if (role.scope === "Church") return "Church-wide";
    const min = ministryId ? ministryMap.get(ministryId) : null;
    return min ? `Ministry: ${min.name}` : "Ministry-specific";
  }, [role, ministryId, ministryMap]);

  const stats = useMemo(() => {
    const membersCount = assignments.length;
    const todo = tasks.filter((t) => t.status === "Todo").length;
    const doing = tasks.filter((t) => t.status === "Doing").length;
    const done = tasks.filter((t) => t.status === "Done").length;
    return { membersCount, todo, doing, done, announcements: anns.length };
  }, [assignments.length, tasks, anns.length]);

  const canPost = Boolean(role?.canPostAnnouncements);
  const canManageMembers = Boolean(role?.canManageMembers) || roleScope === "Ministry";
  const canManageMinistries = Boolean(role?.canManageMinistries);

  const headerTitle = role ? role.name : `Role: ${roleId || "—"}`;

  // create task
  const [taskTitle, setTaskTitle] = useState("");
  function addTask() {
    const t = taskTitle.trim();
    if (!t) return;
    setTasks((prev) => [{ id: `t_${Date.now()}`, title: t, status: "Todo", createdAt: isoNow() }, ...prev]);
    setTaskTitle("");
  }

  function setTaskStatus(id: string, status: TaskStatus) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  }

  // announcement
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  function postAnnouncement() {
    if (!canPost) return alert("Hii role haina permission ya announcements.");
    const t = annTitle.trim();
    const b = annBody.trim();
    if (!t || !b) return alert("Weka title na message.");
    setAnns((prev) => [{ id: `n_${Date.now()}`, title: t, body: b, createdAt: isoNow() }, ...prev]);
    setAnnTitle("");
    setAnnBody("");
  }

  if (!roleId) {
    return (
      <div style={wrap}>
        <div style={panel}>
          <div style={h1}>Role Dashboard</div>
          <div style={muted}>
            Hakuna roleId. Fungua kwa mfano:
            <div style={codeLine}>/dashboard/church/roles/r3?ministry=choir</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Link href="/dashboard/church/roles" style={btnGhostLink}>
              Back to Roles
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {/* Top Bar */}
      <div style={topBar}>
        <div>
          <div style={h1}>{headerTitle}</div>
          <div style={sub}>
            <span style={badgeGold}>VIP GOLD</span> <span style={badge}>{scopeLabel}</span>{" "}
            <span style={badge}>Created: {fmt(role?.createdAt)}</span>
          </div>
          {role?.description ? <div style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.6 }}>{role.description}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/dashboard/church/roles" style={btnGhostLink}>
            ← Roles
          </Link>
          <Link href="/dashboard/church" style={btnGhostLink}>
            Church Dashboard
          </Link>
        </div>
      </div>

      {/* KPI */}
      <section style={kpiRow}>
        <div style={kpiCard}>
          <div style={kpiLabel}>Members under role</div>
          <div style={kpiValue}>{stats.membersCount}</div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLabel}>Tasks</div>
          <div style={kpiValue}>
            {stats.todo}/{stats.doing}/{stats.done}
          </div>
          <div style={kpiFoot}>Todo / Doing / Done</div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLabel}>Announcements</div>
          <div style={kpiValue}>{stats.announcements}</div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLabel}>Permissions</div>
          <div style={kpiFoot}>
            {canManageMembers ? "✅ Members" : "⛔ Members"} • {canManageMinistries ? "✅ Ministries" : "⛔ Ministries"} •{" "}
            {canPost ? "✅ Post" : "⛔ Post"}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div style={tabsRow}>
        <button style={tab === "overview" ? tabActive : tabBtn} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button style={tab === "members" ? tabActive : tabBtn} onClick={() => setTab("members")}>
          Members
        </button>
        <button style={tab === "tasks" ? tabActive : tabBtn} onClick={() => setTab("tasks")}>
          Tasks
        </button>
        <button style={tab === "announcements" ? tabActive : tabBtn} onClick={() => setTab("announcements")}>
          Announcements
        </button>
        <button style={tab === "settings" ? tabActive : tabBtn} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {/* Overview */}
      {tab === "overview" ? (
        <section style={panel}>
          <div style={secTitle}>Role Overview</div>

          <div style={grid2}>
            <div style={card}>
              <div style={cardTitle}>Quick Actions</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <button
                  style={canManageMembers ? btnGold : btnDisabled}
                  disabled={!canManageMembers}
                  onClick={() => setTab("members")}
                >
                  👥 View Members under this Role
                </button>
                <button style={btnGold} onClick={() => setTab("tasks")}>
                  ✅ Manage Tasks
                </button>
                <button style={canPost ? btnGold : btnDisabled} disabled={!canPost} onClick={() => setTab("announcements")}>
                  📢 Post Announcement
                </button>
                <button style={btnGhost} onClick={() => alert("NEXT: connect to backend RBAC + churchId scoping ✅")}>
                  ⚙️ Connect to Backend (next step)
                </button>
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>What this dashboard will become (Real)</div>
              <div style={muted}>
                Hii ni demo UI. Next tutafanya:
                <ul style={{ marginTop: 10, lineHeight: 1.7 }}>
                  <li>RBAC: role-based permissions (churchId scoped)</li>
                  <li>Members list real kutoka DB</li>
                  <li>Ministry workflows: attendance, schedule, tasks, reports</li>
                  <li>Announcements to target group (youth/choir/women)</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Members */}
      {tab === "members" ? (
        <section style={panel}>
          <div style={secTitle}>Members under: {headerTitle}</div>

          {!canManageMembers ? (
            <div style={warn}>
              ⛔ This role cannot manage members (demo permission). (Later: permissions from backend)
            </div>
          ) : null}

          {assignments.length === 0 ? (
            <div style={muted}>Hakuna member assigned kwenye role hii (au filter ya ministry haijapatikana).</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {assignments.map((a) => {
                const m = memberMap.get(a.memberId);
                const min = a.ministryId ? ministryMap.get(a.ministryId) : null;

                return (
                  <div key={a.id} style={row}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={rowTitle}>{m?.fullName || a.memberId}</div>
                        <div style={rowMeta}>
                          {m?.phone ? <span>📞 {m.phone}</span> : <span>—</span>}
                          {min ? (
                            <>
                              <span style={{ opacity: 0.5 }}> • </span>
                              <span>
                                Ministry: <b>{min.name}</b>
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div style={rowFoot}>Assigned: {fmt(a.assignedAt)}</div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <button style={btnGhost} onClick={() => alert("NEXT: open member profile + report page")}>
                          Open Member
                        </button>
                        <button style={btnGold} onClick={() => alert("NEXT: send message / notification to member")}>
                          Message
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* Tasks */}
      {tab === "tasks" ? (
        <section style={panel}>
          <div style={secTitle}>Tasks</div>

          <div style={grid2}>
            <div style={card}>
              <div style={cardTitle}>Create Task</div>
              <div style={label}>Task title</div>
              <input style={input} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Example: Ratiba ya mazoezi" />
              <button style={{ ...btnGold, marginTop: 10 }} onClick={addTask}>
                ➕ Add Task
              </button>
            </div>

            <div style={card}>
              <div style={cardTitle}>Task Rules</div>
              <div style={muted}>
                Later tutakuwa na:
                <ul style={{ marginTop: 10, lineHeight: 1.7 }}>
                  <li>Assign task to member(s)</li>
                  <li>Due dates + reminders</li>
                  <li>Reports kwa pastor</li>
                </ul>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {tasks.map((t) => (
              <div key={t.id} style={row}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={rowTitle}>{t.title}</div>
                    <div style={rowFoot}>Created: {fmt(t.createdAt)}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button style={t.status === "Todo" ? btnGold : btnGhost} onClick={() => setTaskStatus(t.id, "Todo")}>
                      Todo
                    </button>
                    <button style={t.status === "Doing" ? btnGold : btnGhost} onClick={() => setTaskStatus(t.id, "Doing")}>
                      Doing
                    </button>
                    <button style={t.status === "Done" ? btnGold : btnGhost} onClick={() => setTaskStatus(t.id, "Done")}>
                      Done
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Announcements */}
      {tab === "announcements" ? (
        <section style={panel}>
          <div style={secTitle}>Announcements</div>

          {!canPost ? (
            <div style={warn}>⛔ This role cannot post announcements (demo permission).</div>
          ) : null}

          <div style={grid2}>
            <div style={card}>
              <div style={cardTitle}>Post Announcement</div>
              <div style={label}>Title</div>
              <input style={input} value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} placeholder="Example: Kikao cha vijana" />

              <div style={{ ...label, marginTop: 10 }}>Message</div>
              <textarea style={textarea} value={annBody} onChange={(e) => setAnnBody(e.target.value)} placeholder="Andika ujumbe..." />

              <button style={{ ...btnGold, marginTop: 10 }} onClick={postAnnouncement} disabled={!canPost}>
                📢 Post
              </button>
            </div>

            <div style={card}>
              <div style={cardTitle}>Recent Announcements</div>
              {anns.length === 0 ? (
                <div style={muted}>No announcements.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {anns.slice(0, 6).map((n) => (
                    <div key={n.id} style={mini}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 950 }}>{n.title}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>{fmt(n.createdAt)}</div>
                      </div>
                      <div style={{ marginTop: 6, opacity: 0.9, lineHeight: 1.6 }}>{n.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Settings */}
      {tab === "settings" ? (
        <section style={panel}>
          <div style={secTitle}>Role Settings</div>

          <div style={grid2}>
            <div style={card}>
              <div style={cardTitle}>Scope & Filters</div>
              <div style={muted}>
                Scope: <b>{roleScope}</b>
                <br />
                Ministry filter: <b>{ministryId || "—"}</b>
                <div style={{ marginTop: 10, opacity: 0.85 }}>
                  Hint: kwa Ministry role, unaweza kuongeza <span style={codeInline}>?ministry=choir</span>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Permissions (Demo)</div>
              <div style={muted}>
                Members: <b>{canManageMembers ? "YES" : "NO"}</b>
                <br />
                Ministries: <b>{canManageMinistries ? "YES" : "NO"}</b>
                <br />
                Announcements: <b>{canPost ? "YES" : "NO"}</b>
              </div>

              <button
                style={{ ...btnGhost, marginTop: 10 }}
                onClick={() => alert("NEXT: permissions ziwe driven na DB + Pastor/Admin controls")}
              >
                Upgrade to Real RBAC →
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div style={footerTip}>
        ✅ Next step: tukifunga backend, role dashboard hii itakuwa “real” kwa member aliye-assigniwa.
        <br />
        Mfano: Kiongozi wa Youth ataingia na akaunti yake → system itampeleka dashboard yake automatically.
      </div>
    </div>
  );
}

/* =========================
   STYLES (VIP GOLD)
   ========================= */

const wrap: CSSProperties = { padding: 16 };

const topBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
  alignItems: "flex-start",
  marginBottom: 12,
};

const h1: CSSProperties = {
  fontSize: 28,
  fontWeight: 950,
  color: "rgba(255,236,190,0.98)",
  margin: 0,
};

const sub: CSSProperties = { marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };

const badge: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.82)",
};

const badgeGold: CSSProperties = {
  ...badge,
  border: "1px solid rgba(212,175,55,0.32)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
};

const panel: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const muted: CSSProperties = { opacity: 0.85, lineHeight: 1.7 };

const codeLine: CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.20)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  display: "inline-block",
};

const codeInline: CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.20)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
};

const secTitle: CSSProperties = { fontWeight: 950, marginBottom: 10, color: "rgba(255,236,190,0.98)" };

const kpiRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginBottom: 12,
};

const kpiCard: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
};

const kpiLabel: CSSProperties = { opacity: 0.8, fontSize: 12, fontWeight: 900 };
const kpiValue: CSSProperties = { fontSize: 26, fontWeight: 950, marginTop: 6, color: "rgba(255,236,190,0.98)" };
const kpiFoot: CSSProperties = { opacity: 0.75, fontSize: 12, marginTop: 4 };

const tabsRow: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 };

const tabBtn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const tabActive: CSSProperties = {
  ...tabBtn,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
  boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
};

const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };

const card: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
};

const cardTitle: CSSProperties = { fontWeight: 950, color: "rgba(255,236,190,0.98)" };

const label: CSSProperties = { marginTop: 10, fontSize: 12, fontWeight: 900, opacity: 0.85, marginBottom: 6 };

const input: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.22)",
  color: "inherit",
  outline: "none",
  fontWeight: 800,
};

const textarea: CSSProperties = { ...input, minHeight: 110, resize: "vertical", lineHeight: 1.6, fontWeight: 700 };

const row: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.20)",
  padding: 12,
};

const rowTitle: CSSProperties = { fontWeight: 950, fontSize: 14 };
const rowMeta: CSSProperties = { opacity: 0.8, marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" };
const rowFoot: CSSProperties = { opacity: 0.65, fontSize: 12, marginTop: 6 };

const mini: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.16)",
  padding: 12,
};

const warn: CSSProperties = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,180,120,0.22)",
  background: "linear-gradient(180deg, rgba(255,180,120,0.10), rgba(255,255,255,0.03))",
  opacity: 0.95,
  lineHeight: 1.6,
};

const btnBase: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.20)",
  cursor: "pointer",
  fontWeight: 950,
  color: "inherit",
};

const btnGold: CSSProperties = {
  ...btnBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
};

const btnGhost: CSSProperties = { ...btnBase, opacity: 0.9 };

const btnDisabled: CSSProperties = { ...btnBase, opacity: 0.55, cursor: "not-allowed" };

const btnGhostLink: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const footerTip: CSSProperties = {
  marginTop: 14,
  borderRadius: 14,
  padding: "12px 16px",
  textAlign: "center",
  lineHeight: 1.6,
  backgroundColor: "rgba(34,197,94,0.10)",
  border: "1px solid rgba(34,197,94,0.22)",
  color: "rgba(187,247,208,0.95)",
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
};
