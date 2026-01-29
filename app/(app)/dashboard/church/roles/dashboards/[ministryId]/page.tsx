// app/(app)/dashboard/church/roles/dashboards/[ministryId]/page.tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import type { RoleAssignment, RoleId } from "@/app/(app)/dashboard/church/roles/_lib/roles.types";

/* =========================
   TYPES
   ========================= */

type MinistryStatus = "Active" | "Paused";

type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

/* =========================
   HELPERS
   ========================= */

function fmt(x?: string) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString();
}

function pickErrorMessage(x: any) {
  if (!x) return "Unknown error";
  if (typeof x === "string") return x;
  if (typeof x?.error === "string") return x.error;
  return "Request failed";
}

function roleLabel(roleId: RoleId) {
  switch (roleId) {
    case "youth_leader":
      return "Youth Leader";
    case "choir_leader":
      return "Choir Leader";
    case "women_leader":
      return "Women Leader";
    case "prayer_leader":
      return "Prayer Leader";
    case "usher_leader":
      return "Usher Leader";
    case "media_leader":
      return "Media Leader";
    case "evangelism_leader":
      return "Evangelism Leader";
    case "secretary":
      return "Secretary";
    case "treasurer":
      return "Treasurer";
    default:
      return roleId;
  }
}

/* =========================
   DEMO AUTH HEADERS
   (IMPORTANT: match auth.ts defaults)
   ========================= */

const DEMO_USER_ID = "demo_user_1";
const DEMO_USER_ROLE = "Pastor";
const DEMO_CHURCH_ID = "church_demo"; // ✅ align with auth.ts default + other pages

function demoHeaders(): HeadersInit {
  return {
    "x-user-id": DEMO_USER_ID,
    "x-user-role": DEMO_USER_ROLE,
    "x-church-id": DEMO_CHURCH_ID,
    "x-user-name": "Pastor Demo",
  };
}

/* =========================
   API PATHS
   ========================= */

const MINISTRIES_API = "/api/church/ministries";
const ASSIGNMENTS_API = "/api/church/roles/assignments";

/* =========================
   PAGE
   ========================= */

export default function MinistryDashboardPage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "").trim();

  const [ministry, setMinistry] = useState<Ministry | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function loadAll() {
    if (!ministryId) return;

    setLoading(true);
    setErr("");

    try {
      // Fetch both in parallel
      const [resM, resA] = await Promise.all([
        fetch(MINISTRIES_API, { method: "GET", headers: demoHeaders(), cache: "no-store" }),
        fetch(`${ASSIGNMENTS_API}?ministryId=${encodeURIComponent(ministryId)}`, {
          method: "GET",
          headers: demoHeaders(),
          cache: "no-store",
        }),
      ]);

      const jsonM = (await resM.json().catch(() => null)) as ApiRes<Ministry[]> | null;
      const jsonA = (await resA.json().catch(() => null)) as ApiRes<RoleAssignment[]> | null;

      if (!resM.ok) {
        setErr(pickErrorMessage(jsonM) || `HTTP ${resM.status} (ministries)`);
        setMinistry(null);
      } else if (!jsonM || jsonM.ok !== true) {
        setErr(pickErrorMessage(jsonM) || "Invalid response (ministries)");
        setMinistry(null);
      } else {
        const ministries = Array.isArray(jsonM.data) ? jsonM.data : [];
        const found = ministries.find((m) => m.id === ministryId) || null;
        setMinistry(found);
      }

      if (!resA.ok) {
        setErr((prev) => prev || pickErrorMessage(jsonA) || `HTTP ${resA.status} (assignments)`);
        setAssignments([]);
      } else if (!jsonA || jsonA.ok !== true) {
        setErr((prev) => prev || pickErrorMessage(jsonA) || "Invalid response (assignments)");
        setAssignments([]);
      } else {
        const rows = Array.isArray(jsonA.data) ? jsonA.data : [];
        setAssignments(rows);
      }
    } catch (e: any) {
      setErr(e?.message || "Network error");
      setMinistry(null);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId]);

  const active = useMemo(() => assignments.filter((a) => a.status === "Active"), [assignments]);
  const ended = useMemo(() => assignments.filter((a) => a.status !== "Active"), [assignments]);

  const leaders = useMemo(() => active, [active]);

  return (
    <div style={page}>
      <div style={hero}>
        <div>
          <h1 style={title}>📊 Ministry Dashboard</h1>
          <div style={subtitle}>
            Ministry ID: <b>{ministryId || "—"}</b>
            <div style={{ marginTop: 8, opacity: 0.82, fontSize: 13 }}>
              User: <b>{DEMO_USER_ID}</b> • Scope: <b>{DEMO_CHURCH_ID}</b> • Role: <b>{DEMO_USER_ROLE}</b>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/dashboard/church/ministries" style={btnGhost as any}>
            ← Back to Ministries
          </Link>
          <Link href="/dashboard/church/roles" style={btnGold as any}>
            🛡️ Roles & Assignments
          </Link>
          <button style={btnGhost as any} onClick={loadAll} disabled={loading}>
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {err ? (
        <div style={errorBox}>
          <b>⚠️ Error:</b> <span style={{ opacity: 0.95 }}>{err}</span>
          <div style={{ marginTop: 8 }}>
            <button style={btnGhost} onClick={loadAll} disabled={loading}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {/* Ministry Summary */}
      <section style={card}>
        <div style={cardTitle}>Ministry Overview</div>

        {loading ? <div style={{ opacity: 0.8 }}>Loading...</div> : null}

        {!loading && !ministry ? (
          <div style={{ opacity: 0.78, lineHeight: 1.6 }}>
            Ministry haijapatikana kwa ID hii. (Angalia kama ministry ime-create kwenye Ministries page.)
          </div>
        ) : ministry ? (
          <div style={grid3}>
            <div style={miniCard}>
              <div style={miniTitle}>
                {ministry.name}{" "}
                <span style={ministry.status === "Active" ? pillOk : pillWarn}>{ministry.status}</span>
              </div>
              <div style={miniMeta}>{ministry.description || "—"}</div>
              <div style={miniFoot}>
                Created: {fmt(ministry.createdAt)}
                {ministry.updatedAt ? ` • Updated: ${fmt(ministry.updatedAt)}` : ""}
              </div>
            </div>

            <div style={miniCard}>
              <div style={miniTitle}>Active Leaders / Assignments</div>
              <div style={bigNumber}>{leaders.length}</div>
              <div style={miniFoot}>From {ASSIGNMENTS_API}?ministryId=...</div>
            </div>

            <div style={miniCard}>
              <div style={miniTitle}>Ended / Suspended</div>
              <div style={bigNumber}>{ended.length}</div>
              <div style={miniFoot}>History (non-active)</div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Leaders List */}
      <section style={card}>
        <div style={cardTitle}>Leadership (Active)</div>

        {loading ? <div style={{ opacity: 0.8 }}>Loading...</div> : null}

        {!loading && leaders.length === 0 ? (
          <div style={{ opacity: 0.78, lineHeight: 1.6 }}>
            Hakuna viongozi/assignments bado kwenye ministry hii. <br />
            Nenda <b>Roles</b> page u-assign roles kwa ministry hii.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {leaders.map((a) => (
              <div key={a.id} style={row}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={rowTitle}>
                      {a.memberName} <span style={pill}>{roleLabel(a.roleId)}</span>{" "}
                      <span style={a.status === "Active" ? pillOk : pillMuted}>{a.status}</span>
                    </div>
                    <div style={rowMeta}>
                      <span style={{ opacity: 0.85 }}>Assigned:</span> <b>{fmt(a.assignedAt)}</b>
                      {a.endsAt ? (
                        <>
                          {" "}
                          • <span style={{ opacity: 0.85 }}>Ends:</span> <b>{fmt(a.endsAt)}</b>
                        </>
                      ) : null}
                    </div>
                    <div style={rowFoot}>
                      By: <b>{a.assignedByPastorName}</b> • MemberId: {a.memberId}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Link href="/dashboard/church/roles" style={btnGoldSm as any}>
                      Manage Roles →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section style={card}>
        <div style={cardTitle}>History (Ended / Suspended)</div>

        {loading ? <div style={{ opacity: 0.8 }}>Loading...</div> : null}

        {!loading && ended.length === 0 ? <div style={{ opacity: 0.75 }}>Hakuna history bado.</div> : null}

        {!loading && ended.length > 0 ? (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {ended.map((a) => (
              <div key={a.id} style={row}>
                <div style={rowTitle}>
                  {a.memberName} <span style={pillMuted}>{roleLabel(a.roleId)}</span>{" "}
                  <span style={pillMuted}>{a.status}</span>
                </div>
                <div style={rowFoot}>
                  Assigned: {fmt(a.assignedAt)}
                  {a.endsAt ? ` • Ends: ${fmt(a.endsAt)}` : ""}
                  {" • "}
                  By: <b>{a.assignedByPastorName}</b>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div style={tip}>
        ✅ Dashboard hii inasoma <b>ministryId</b> kutoka URL na inavuta data kutoka <b>{ASSIGNMENTS_API}</b> kwa query{" "}
        <b>?ministryId=...</b>.
      </div>
    </div>
  );
}

/* =========================
   STYLES
   ========================= */

const page: CSSProperties = { padding: 16 };

const hero: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "flex-start",
  marginBottom: 14,
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const title: CSSProperties = { fontSize: 26, fontWeight: 950, margin: 0, color: "rgba(255,236,190,0.98)" };
const subtitle: CSSProperties = { opacity: 0.82, marginTop: 6, lineHeight: 1.6, maxWidth: 900 };

const card: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
  marginBottom: 14,
};

const cardTitle: CSSProperties = { fontWeight: 950, marginBottom: 10, color: "rgba(255,236,190,0.98)" };

const grid3: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 10,
};

const miniCard: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.20)",
  padding: 12,
};

const miniTitle: CSSProperties = { fontWeight: 950, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const miniMeta: CSSProperties = { opacity: 0.8, marginTop: 6, lineHeight: 1.5 };
const miniFoot: CSSProperties = { opacity: 0.65, marginTop: 8, fontSize: 12 };

const bigNumber: CSSProperties = { fontSize: 34, fontWeight: 950, marginTop: 8 };

const row: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.20)",
  padding: 12,
};

const rowTitle: CSSProperties = { fontWeight: 950, fontSize: 14 };
const rowMeta: CSSProperties = { opacity: 0.8, marginTop: 6, lineHeight: 1.55 };
const rowFoot: CSSProperties = { opacity: 0.65, fontSize: 12, marginTop: 6 };

const pillBase: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  fontSize: 12,
  display: "inline-block",
};

const pill: CSSProperties = { ...pillBase };
const pillMuted: CSSProperties = {
  ...pillBase,
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.82)",
};

const pillOk: CSSProperties = {
  ...pillBase,
  border: "1px solid rgba(34,197,94,0.22)",
  background: "rgba(34,197,94,0.12)",
  color: "rgba(187,247,208,0.95)",
};

const pillWarn: CSSProperties = {
  ...pillBase,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.95)",
};

const btnBase: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.20)",
  cursor: "pointer",
  textDecoration: "none",
  color: "inherit",
  fontWeight: 950,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

const btnGold: CSSProperties = {
  ...btnBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.14)",
  color: "rgba(255,236,190,0.98)",
};

const btnGhost: CSSProperties = { ...btnBase, opacity: 0.9 };
const btnGoldSm: CSSProperties = { ...btnGold, padding: "8px 10px", borderRadius: 12, fontSize: 13 };

const tip: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(34,197,94,0.22)",
  background: "rgba(34,197,94,0.10)",
  padding: 12,
  lineHeight: 1.6,
  color: "rgba(187,247,208,0.95)",
};

const errorBox: CSSProperties = {
  marginBottom: 12,
  borderRadius: 14,
  border: "1px solid rgba(239,68,68,0.28)",
  background: "rgba(239,68,68,0.10)",
  padding: "12px 14px",
  lineHeight: 1.6,
  color: "rgba(254,226,226,0.95)",
};
