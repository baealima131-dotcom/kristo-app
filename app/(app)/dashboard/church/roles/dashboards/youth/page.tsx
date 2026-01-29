// app/(app)/dashboard/church/roles/dashboards/youth/page.tsx
"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import type { RoleKpi } from "../../_lib/roles.types";

/**
 * ✅ VIP GOLD Youth Dashboard (DEMO UI)
 * Next steps: connect to API (church members, tasks, attendance, events).
 *
 * ✅ FIX NOTE:
 * - default export lazima iwe page ya Next.js (tunaiita Page)
 * - na pia tunatoa named export `YouthDashboard` ili router a-import component safi
 */

type YouthMember = {
  id: string;
  name: string;
  phone?: string;
  status: "Active" | "Inactive";
  lastSeen?: string;
  role?: string;
};

type Task = {
  id: string;
  title: string;
  status: "Open" | "InProgress" | "Done";
  assignedTo?: string;
};

const DEMO_MEMBERS: YouthMember[] = [
  { id: "m1", name: "John K.", status: "Active", lastSeen: "Today", role: "Assistant" },
  { id: "m2", name: "Amina S.", status: "Active", lastSeen: "Yesterday", role: "Secretary" },
  { id: "m3", name: "Peter M.", status: "Inactive", lastSeen: "2 weeks ago" },
  { id: "m4", name: "Neema J.", status: "Active", lastSeen: "Today", role: "Choir Support" },
];

const DEMO_TASKS: Task[] = [
  { id: "t1", title: "Prepare Youth Sunday Program", status: "InProgress", assignedTo: "Amina S." },
  { id: "t2", title: "Create WhatsApp announcement", status: "Open", assignedTo: "John K." },
  { id: "t3", title: "Attendance list for this week", status: "Done", assignedTo: "Neema J." },
];

function pill(status: string) {
  const s = status.toLowerCase();
  if (s.includes("done")) return { label: status, style: { ...pillBase, ...pillGreen } };
  if (s.includes("progress")) return { label: status, style: { ...pillBase, ...pillGold } };
  if (s.includes("open")) return { label: status, style: { ...pillBase, ...pillSoft } };
  if (s.includes("active")) return { label: status, style: { ...pillBase, ...pillGreen } };
  if (s.includes("inactive")) return { label: status, style: { ...pillBase, ...pillRed } };
  return { label: status, style: { ...pillBase, ...pillSoft } };
}

/** ✅ Component halisi (router anaweza ku-import hii) */
export function YouthDashboard() {
  const [q, setQ] = useState("");

  const members = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return DEMO_MEMBERS;
    return DEMO_MEMBERS.filter((m) => m.name.toLowerCase().includes(t));
  }, [q]);

  const kpis: RoleKpi[] = useMemo(() => {
    const total = DEMO_MEMBERS.length;
    const active = DEMO_MEMBERS.filter((m) => m.status === "Active").length;
    const open = DEMO_TASKS.filter((t) => t.status === "Open").length;
    const inProg = DEMO_TASKS.filter((t) => t.status === "InProgress").length;

    return [
      { label: "Total Youth Members", value: total, hint: "all youth under this role" },
      { label: "Active", value: active, hint: "currently active" },
      { label: "Open Tasks", value: open, hint: "need action" },
      { label: "In Progress", value: inProg, hint: "being worked on" },
    ];
  }, []);

  return (
    <div style={wrap}>
      {/* Top bar */}
      <div style={topRow}>
        <div>
          <div style={crumbs}>
            <Link href="/dashboard/church/roles" style={crumbLink}>
              ← Church Roles
            </Link>
            <span style={{ opacity: 0.6 }}> / </span>
            <span style={{ fontWeight: 950 }}>Youth Dashboard</span>
          </div>

          <div style={titleRow}>
            <h1 style={title}>👑 Youth Leader</h1>
            <span style={vipPill}>VIP • Gold Pure</span>
          </div>

          <div style={sub}>
            Hapa kiongozi wa vijana ata-manage vijana, tasks, attendance, events, na announcements.
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              Next: tutaunganisha na API ya Church Members + Role Assignments.
            </div>
          </div>
        </div>

        <div style={actions}>
          <button style={btnGold} onClick={() => alert("✅ Coming next: Create Task modal + API")} title="create a new task">
            + New Task
          </button>
          <button style={btnGhost} onClick={() => alert("✅ Coming next: Announcement composer + API")} title="post announcement">
            📣 Announce
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={kpiGrid}>
        {kpis.map((k) => (
          <div key={k.label} style={kpiCard}>
            <div style={{ opacity: 0.75, fontWeight: 900, fontSize: 12 }}>{k.label}</div>
            <div style={{ fontWeight: 980, fontSize: 28, marginTop: 8, color: "rgba(255,236,190,0.98)" }}>
              {k.value}
            </div>
            {k.hint ? <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>{k.hint}</div> : null}
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div style={grid2}>
        {/* Members */}
        <section style={card}>
          <div style={cardHead}>
            <div>
              <div style={cardTitle}>Youth Members</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Search, track activity, assign tasks</div>
            </div>

            <input style={search} placeholder="Search member..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {members.map((m) => {
              const p = pill(m.status);
              return (
                <div key={m.id} style={row}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontWeight: 950 }}>{m.name}</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Last seen: {m.lastSeen || "—"} {m.role ? `• Role: ${m.role}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={p.style}>{p.label}</span>

                    <Link
                      href={`/dashboard/church/roles?memberId=${encodeURIComponent(m.id)}`}
                      style={miniGold as any}
                      title="Assign role for this member"
                    >
                      🛡️ Assign Role
                    </Link>

                    <button style={miniGold} onClick={() => alert(`Assign Task → ${m.name} (next step: API)`)} title="assign a task">
                      Assign Task
                    </button>

                    <button style={miniGhost} onClick={() => alert(`Open profile → ${m.name} (next step)`)} title="view profile">
                      View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {members.length === 0 ? <div style={{ marginTop: 12, opacity: 0.8 }}>No members found.</div> : null}
        </section>

        {/* Tasks */}
        <section style={card}>
          <div style={cardHead}>
            <div>
              <div style={cardTitle}>Tasks Board</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Daily execution for youth department</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btnGhost} onClick={() => alert("Filter coming next")}>
                Filter
              </button>
              <button style={btnGold} onClick={() => alert("Reports coming next")}>
                Reports
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {DEMO_TASKS.map((t) => {
              const p = pill(t.status);
              return (
                <div key={t.id} style={row}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontWeight: 950 }}>{t.title}</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Assigned: {t.assignedTo || "—"}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={p.style}>{p.label}</span>
                    <button style={miniGold} onClick={() => alert(`Edit task ${t.id} (next step)`)}>
                      Edit
                    </button>
                    <button style={miniGhost} onClick={() => alert(`Mark done ${t.id} (next step)`)}>
                      Done
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={hintBox}>
            ✅ Next step: tutafanya API endpoints: <b>role_tasks, role_members, announcements, attendance</b>
          </div>
        </section>
      </div>
    </div>
  );
}

/** ✅ Next.js page default export */
export default function Page() {
  return <YouthDashboard />;
}

/* =========================
   STYLES (VIP GOLD)
   ========================= */

const wrap: CSSProperties = { width: "100%", paddingBottom: 26 };

const topRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
  alignItems: "flex-start",
  marginBottom: 14,
};

const crumbs: CSSProperties = { marginBottom: 8, fontSize: 13, opacity: 0.9 };
const crumbLink: CSSProperties = {
  color: "rgba(255,236,190,0.98)",
  textDecoration: "none",
  fontWeight: 900,
};

const titleRow: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };

const title: CSSProperties = { fontSize: 34, fontWeight: 980, margin: 0, color: "rgba(255,236,190,0.98)" };

const vipPill: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.32)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  fontSize: 12,
};

const sub: CSSProperties = { marginTop: 8, opacity: 0.82, lineHeight: 1.6, maxWidth: 900 };

const actions: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };

const btnBase: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const btnGold: CSSProperties = {
  ...btnBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background:
    "radial-gradient(130px 60px at 30% 0%, rgba(212,175,55,0.22), transparent 70%), linear-gradient(180deg, rgba(212,175,55,0.14), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
};

const btnGhost: CSSProperties = { ...btnBase, opacity: 0.9 };

const kpiGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginTop: 10,
  marginBottom: 12,
};

const kpiCard: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const grid2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
  gap: 12,
};

const card: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const cardHead: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const cardTitle: CSSProperties = { fontWeight: 980, color: "rgba(255,236,190,0.98)" };

const search: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 850,
  outline: "none",
  minWidth: 220,
};

const row: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.18)",
  padding: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const hintBox: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(34,197,94,0.22)",
  background: "rgba(34,197,94,0.10)",
  color: "rgba(187,247,208,0.95)",
  lineHeight: 1.6,
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
};

/* Pills */
const pillBase: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 900,
  border: "1px solid rgba(255,255,255,0.12)",
};

const pillGreen: CSSProperties = {
  border: "1px solid rgba(34,197,94,0.22)",
  background: "rgba(34,197,94,0.10)",
  color: "rgba(187,247,208,0.95)",
};

const pillGold: CSSProperties = {
  border: "1px solid rgba(212,175,55,0.30)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
};

const pillRed: CSSProperties = {
  border: "1px solid rgba(239,68,68,0.22)",
  background: "rgba(239,68,68,0.10)",
  color: "rgba(254,226,226,0.95)",
};

const pillSoft: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  color: "rgba(255,255,255,0.85)",
};

const miniBase: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

const miniGold: CSSProperties = {
  ...miniBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
};

const miniGhost: CSSProperties = { ...miniBase, opacity: 0.9 };
