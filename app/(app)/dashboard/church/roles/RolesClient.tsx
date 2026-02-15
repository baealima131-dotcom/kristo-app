"use client";


import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { RoleAssignment, RoleDefinition, RoleId, Permission } from "./_lib/roles.types";



/* =========================
   MINISTRY (match ministries API basics)
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
   MEMBER (still demo for now)
   ========================= */

type Member = {
  id: string;
  fullName: string;
};

/* =========================
   DEMO DATA
   ========================= */

const DEMO_MEMBERS: Member[] = [
  { id: "m1", fullName: "Prince Fariji" },
  { id: "m2", fullName: "Mama Asha" },
  { id: "m3", fullName: "John Paul" },
  { id: "m4", fullName: "Neema Grace" },
];

/**
 * Role definitions = fixed list (RoleId union)
 * Hapa ndipo “truth” ya roles list inakaa kwa UI.
 */
const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: "youth_leader",
    name: "Youth Leader",
    tier: "Leader",
    description: "Kiongozi wa vijana (Youth).",
    icon: "🔥",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "MANAGE_MEMBERS", "POST_ANNOUNCEMENTS"],
  },
  {
    id: "choir_leader",
    name: "Choir Leader",
    tier: "Leader",
    description: "Kiongozi wa waimbaji (Choir).",
    icon: "🎶",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "MANAGE_MEMBERS", "POST_ANNOUNCEMENTS"],
  },
  {
    id: "women_leader",
    name: "Women Leader",
    tier: "Leader",
    description: "Kiongozi wa Women ministry.",
    icon: "🌸",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "MANAGE_MEMBERS", "POST_ANNOUNCEMENTS"],
  },
  {
    id: "prayer_leader",
    name: "Prayer Leader",
    tier: "Leader",
    description: "Kiongozi wa maombi.",
    icon: "🙏",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "POST_ANNOUNCEMENTS"],
  },
  {
    id: "usher_leader",
    name: "Usher Leader",
    tier: "Leader",
    description: "Kiongozi wa ushers.",
    icon: "🧍",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "MANAGE_ATTENDANCE"],
  },
  {
    id: "media_leader",
    name: "Media Leader",
    tier: "Leader",
    description: "Kiongozi wa media / tech.",
    icon: "📷",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "POST_ANNOUNCEMENTS"],
  },
  {
    id: "evangelism_leader",
    name: "Evangelism Leader",
    tier: "Leader",
    description: "Kiongozi wa evangelism/outreach.",
    icon: "📣",
    dashboardPath: "/dashboard/church/roles/dashboards/:ministryId",
    permissions: ["VIEW_DASHBOARD", "MANAGE_EVENTS", "POST_ANNOUNCEMENTS"],
  },

  // Church-scope (still “soon” dashboard)
  {
    id: "secretary",
    name: "Church Secretary",
    tier: "Admin",
    description: "Handles documentation & reporting.",
    icon: "🗂️",
    dashboardPath: "/dashboard/church/roles",
    permissions: ["VIEW_REPORTS", "POST_ANNOUNCEMENTS", "VIEW_DASHBOARD"],
  },
  {
    id: "treasurer",
    name: "Treasurer",
    tier: "Admin",
    description: "Manages church/ministry finances.",
    icon: "💰",
    dashboardPath: "/dashboard/church/roles",
    permissions: ["MANAGE_FINANCE", "VIEW_REPORTS", "VIEW_DASHBOARD"],
  },
];

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

function byId<T extends { id: string }>(arr: T[]) {
  const m = new Map<string, T>();
  for (const x of arr) m.set(x.id, x);
  return m;
}

function permBadge(p: Permission) {
  switch (p) {
    case "VIEW_DASHBOARD":
      return "Dashboard";
    case "MANAGE_MEMBERS":
      return "Members";
    case "ASSIGN_TASKS":
      return "Tasks";
    case "VIEW_REPORTS":
      return "Reports";
    case "POST_ANNOUNCEMENTS":
      return "Posts";
    case "MANAGE_EVENTS":
      return "Events";
    case "MANAGE_ATTENDANCE":
      return "Attendance";
    case "MANAGE_FINANCE":
      return "Finance";
    default:
      return p;
  }
}

function normalize(s?: string) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function safeIncludes(hay?: string, needle?: string) {
  const h = normalize(hay);
  const n = normalize(needle);
  if (!n) return true;
  return h.includes(n);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ministry-scoped roles (leaders)
 */
const MINISTRY_ROLE_IDS = new Set<RoleId>([
  "youth_leader",
  "choir_leader",
  "women_leader",
  "prayer_leader",
  "usher_leader",
  "media_leader",
  "evangelism_leader",
]);

function isMinistryRole(roleId: RoleId) {
  return MINISTRY_ROLE_IDS.has(roleId);
}

function getDashboardHref(roleId: RoleId, ministryId?: string) {
  if (!isMinistryRole(roleId)) return null;
  const mid = String(ministryId || "").trim();
  if (!mid) return null;
  return `/dashboard/church/roles/dashboards/${mid}`;
}

async function fetchApi<T>(url: string, init: RequestInit): Promise<{ res: Response; json: ApiRes<T> | null }> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as ApiRes<T> | null;
  return { res, json };
}

/* =========================
   DEMO AUTH HEADERS (match auth.ts)
   ========================= */

const DEMO_USER_ID = "demo_user_1";
const DEMO_USER_ROLE = "Pastor";
const DEMO_CHURCH_ID = "demo_church_1";
const DEMO_USER_NAME = "Demo Pastor";

function demoHeaders(): HeadersInit {
  return {
    "x-user-id": DEMO_USER_ID,
    "x-user-role": DEMO_USER_ROLE,
    "x-church-id": DEMO_CHURCH_ID,
    "x-user-name": DEMO_USER_NAME,
  };
}

/* =========================
   API PATHS
   ========================= */

const ASSIGNMENTS_API = "/api/church/roles/assignments";

/* =========================
   UI UTIL (toast + confirm)
   ========================= */

type Toast = { id: string; kind: "success" | "error" | "info"; title: string; message?: string };
type ConfirmAction = "end" | "reset" | "suspend" | "resume";

function uid(prefix = "t") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* =========================
   PAGE
   ========================= */

export default function ChurchRolesPage() {
  const sp = useSearchParams();
  const preselectMemberId = sp.get("memberId") || "";

  const [members, setMembers] = useState<Member[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);

  // ministries fetch state
  const [loadingMinistries, setLoadingMinistries] = useState(false);
  const [errorMinistries, setErrorMinistries] = useState("");

  // assignments fetch state
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [errorAssignments, setErrorAssignments] = useState("");

  // actions
  const [busyAssign, setBusyAssign] = useState(false);
  const [busyActionId, setBusyActionId] = useState(""); // for end/suspend/resume/reset

  // assign form
  const [assignRoleId, setAssignRoleId] = useState<RoleId | "">("");
  const [assignMemberId, setAssignMemberId] = useState("");
  const [assignMinistryId, setAssignMinistryId] = useState("");

  // advanced UI filters
  const [activeTab, setActiveTab] = useState<"overview" | "assign" | "assignments" | "leadership">("overview");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Suspended" | "Ended">("All");
  const [roleFilter, setRoleFilter] = useState<RoleId | "All">("All");
  const [scopeFilter, setScopeFilter] = useState<"All" | "Ministry" | "Church">("All");
  const [ministryFilter, setMinistryFilter] = useState<string | "All">("All");
  const [sortMode, setSortMode] = useState<"Newest" | "Oldest">("Newest");

  // leadership expand/collapse
  const [openMinistryId, setOpenMinistryId] = useState<string>("");

  // toast + confirm
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<null | { title: string; message: string; action: ConfirmAction; id?: string }>(
    null
  );

  // refs
  const assignSectionRef = useRef<HTMLDivElement | null>(null);
  const roleSelectRef = useRef<HTMLSelectElement | null>(null);

  function pushToast(kind: Toast["kind"], title: string, message?: string) {
    const id = uid("toast");
    setToasts((prev) => [{ id, kind, title, message }, ...prev].slice(0, 3));
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }

  // ESC closes confirm modal
  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmState(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmState]);

  // initial members demo
  useEffect(() => {
    setMembers(DEMO_MEMBERS);
  }, []);

  // preselect member from URL
  useEffect(() => {
    if (!preselectMemberId) return;
    setAssignMemberId(preselectMemberId);
  }, [preselectMemberId]);

  // auto-scroll when coming with memberId
  useEffect(() => {
    if (!preselectMemberId) return;
    const t = window.setTimeout(() => {
      setActiveTab("assign");
      assignSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      roleSelectRef.current?.focus();
    }, 150);
    return () => window.clearTimeout(t);
  }, [preselectMemberId]);

  const memberMap = useMemo(() => byId(members), [members]);
  const ministryMap = useMemo(() => byId(ministries), [ministries]);

  const selectedRoleDef = useMemo(() => {
    if (!assignRoleId) return null;
    return ROLE_DEFINITIONS.find((r) => r.id === assignRoleId) || null;
  }, [assignRoleId]);

  const mustPickMinistry = useMemo(() => {
    if (!assignRoleId) return false;
    return isMinistryRole(assignRoleId);
  }, [assignRoleId]);

  const preselectedMemberName = useMemo(() => {
    if (!preselectMemberId) return "";
    return memberMap.get(preselectMemberId)?.fullName || "";
  }, [preselectMemberId, memberMap]);

  const counts = useMemo(() => {
    let active = 0,
      ended = 0,
      suspended = 0;
    for (const a of assignments) {
      if (a.status === "Active") active++;
      else if (a.status === "Ended") ended++;
      else if (a.status === "Suspended") suspended++;
    }
    return { total: assignments.length, active, ended, suspended };
  }, [assignments]);

  async function loadMinistries() {
    setLoadingMinistries(true);
    setErrorMinistries("");

    try {
      const { res, json } = await fetchApi<Ministry[]>(`/api/church/ministries`, {
        method: "GET",
        headers: demoHeaders(),
        cache: "no-store",
      });

      if (!res.ok) {
        const msg = pickErrorMessage(json) || `HTTP ${res.status}`;
        setErrorMinistries(msg);
        setMinistries([]);
        pushToast("error", "Ministries failed", msg);
        return;
      }

      if (!json || json.ok !== true) {
        const msg = pickErrorMessage(json) || "Invalid response";
        setErrorMinistries(msg);
        setMinistries([]);
        pushToast("error", "Ministries invalid response", msg);
        return;
      }

      const data = Array.isArray(json.data) ? json.data : [];
      setMinistries(data);

      setMinistryFilter((prev) => {
        if (prev === "All") return prev;
        if (data.some((m) => m.id === prev)) return prev;
        return "All";
      });

      // if assign role is ministry-scope, auto pick first ministry when empty
      setAssignMinistryId((prev) => {
        if (!isMinistryRole((assignRoleId || "") as any)) return prev;
        if (String(prev || "").trim()) return prev;
        return data?.[0]?.id || "";
      });

    } catch (e: any) {
      const msg = e?.message || "Network error";
      setErrorMinistries(msg);
      setMinistries([]);
      pushToast("error", "Ministries network error", msg);
    } finally {
      setLoadingMinistries(false);
    }
  }

  async function loadAssignments() {
    setLoadingAssignments(true);
    setErrorAssignments("");

    try {
      const { res, json } = await fetchApi<RoleAssignment[]>(`${ASSIGNMENTS_API}`, {
        method: "GET",
        headers: demoHeaders(),
        cache: "no-store",
      });

      if (!res.ok) {
        const msg = pickErrorMessage(json) || `HTTP ${res.status}`;
        setErrorAssignments(msg);
        setAssignments([]);
        pushToast("error", "Assignments failed", msg);
        return;
      }

      if (!json || json.ok !== true) {
        const msg = pickErrorMessage(json) || "Invalid response";
        setErrorAssignments(msg);
        setAssignments([]);
        pushToast("error", "Assignments invalid response", msg);
        return;
      }

      const data = Array.isArray(json.data) ? json.data : [];
      setAssignments(data);
    } catch (e: any) {
      const msg = e?.message || "Network error";
      setErrorAssignments(msg);
      setAssignments([]);
      pushToast("error", "Assignments network error", msg);
    } finally {
      setLoadingAssignments(false);
    }
  }

  // mount: load both
  useEffect(() => {
    loadMinistries();
    loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If role changes away from ministry role, clear ministryId.
  // If role changes into ministry role and ministry not selected yet, auto-pick first ministry (better UX).
  useEffect(() => {
    if (!assignRoleId) return;

    if (!isMinistryRole(assignRoleId)) {
      setAssignMinistryId("");
      return;
    }

    setAssignMinistryId((prev) => {
      if (String(prev || "").trim()) return prev;
      return ministries?.[0]?.id || "";
    });
  }, [assignRoleId, ministries]);

  // group active assignments by ministry
  const ministryAssignments = useMemo(() => {
    const out: Record<string, RoleAssignment[]> = {};
    for (const a of assignments) {
      if (a.status !== "Active") continue;
      if (!a.ministryId) continue;
      if (!out[a.ministryId]) out[a.ministryId] = [];
      out[a.ministryId].push(a);
    }
    return out;
  }, [assignments]);

  const activeAssignmentsForRole = useMemo(() => {
    const out: Record<string, RoleAssignment[]> = {};
    for (const a of assignments) {
      if (a.status !== "Active") continue;
      if (!out[a.roleId]) out[a.roleId] = [];
      out[a.roleId].push(a);
    }
    return out;
  }, [assignments]);

  const filteredAssignments = useMemo(() => {
    const needle = q.trim();
    let rows = assignments.slice();

    if (statusFilter !== "All") rows = rows.filter((a) => a.status === statusFilter);
    if (roleFilter !== "All") rows = rows.filter((a) => a.roleId === roleFilter);

    if (scopeFilter !== "All") {
      rows = rows.filter((a) => (scopeFilter === "Ministry" ? !!a.ministryId : !a.ministryId));
    }

    if (ministryFilter !== "All") rows = rows.filter((a) => String(a.ministryId || "") === String(ministryFilter));

    if (needle) {
      rows = rows.filter((a) => {
        const role = ROLE_DEFINITIONS.find((r) => r.id === a.roleId);
        const ministryName = a.ministryName || (a.ministryId ? ministryMap.get(a.ministryId)?.name : "") || "";
        return (
          safeIncludes(a.memberName, needle) ||
          safeIncludes(a.memberId, needle) ||
          safeIncludes(a.roleId, needle) ||
          safeIncludes(role?.name, needle) ||
          safeIncludes(ministryName, needle) ||
          safeIncludes(a.assignedByPastorName, needle)
        );
      });
    }

    rows.sort((a, b) => {
      if (sortMode === "Newest") return a.assignedAt < b.assignedAt ? 1 : -1;
      return a.assignedAt > b.assignedAt ? 1 : -1;
    });

    return rows;
  }, [assignments, q, statusFilter, roleFilter, scopeFilter, ministryFilter, sortMode, ministryMap]);

  const firstMinistryId = ministries?.[0]?.id || "";
  const firstDashHref = firstMinistryId ? `/dashboard/church/roles/dashboards/${firstMinistryId}` : null;

  function quickAssign(roleId: RoleId, ministryId?: string) {
    setActiveTab("assign");
    setAssignRoleId(roleId);
    setAssignMinistryId(ministryId || (isMinistryRole(roleId) ? ministries?.[0]?.id || "" : ""));
    window.setTimeout(() => {
      assignSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      roleSelectRef.current?.focus();
    }, 60);
  }

  async function assignRole() {
    if (busyAssign) return;

    if (!assignRoleId || !assignMemberId) {
      pushToast("error", "Missing fields", "Chagua role na member.");
      return;
    }

    const r = ROLE_DEFINITIONS.find((x) => x.id === assignRoleId);
    if (!r) {
      pushToast("error", "Invalid role", "Role haipo.");
      return;
    }

    if (mustPickMinistry && !assignMinistryId) {
      pushToast("error", "Missing ministry", "Kwa role ya MINISTRY lazima uchague ministry.");
      return;
    }

    const memberName = memberMap.get(assignMemberId)?.fullName || assignMemberId;

    const ministryId = mustPickMinistry ? assignMinistryId : undefined;
    const ministryName = ministryId ? ministryMap.get(ministryId)?.name || ministryId : undefined;

    // client-side duplicate guard (server also checks)
    const exists = assignments.some(
      (a) =>
        a.churchId === DEMO_CHURCH_ID &&
        a.roleId === assignRoleId &&
        a.memberId === assignMemberId &&
        String(a.ministryId || "") === String(ministryId || "") &&
        a.status === "Active"
    );

    if (exists) {
      pushToast("info", "Already assigned", "Member tayari ana hii role kwenye scope hiyo.");
      return;
    }

    setBusyAssign(true);
    setErrorAssignments("");

    try {
      const { res, json } = await fetchApi<RoleAssignment>(`${ASSIGNMENTS_API}`, {
        method: "POST",
        headers: { ...demoHeaders(), "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          roleId: assignRoleId,
          memberId: assignMemberId,
          memberName,
          ministryId,
          ministryName,
        }),
      });

      if (!res.ok) {
        pushToast("error", "Assign failed", pickErrorMessage(json) || `HTTP ${res.status}`);
        return;
      }

      if (!json || json.ok !== true) {
        pushToast("error", "Assign invalid response", pickErrorMessage(json) || "Invalid response");
        return;
      }

      setAssignments((prev) => [json.data, ...prev]);
      pushToast("success", "Assigned", `${memberName} → ${r.name}${ministryName ? ` • ${ministryName}` : ""}`);

      // reset (keep member if from URL)
      setAssignRoleId("");
      setAssignMinistryId("");
      if (!preselectMemberId) setAssignMemberId("");
      setActiveTab("assignments");
    } catch (e: any) {
      pushToast("error", "Assign network error", e?.message || "Network error");
    } finally {
      setBusyAssign(false);
    }
  }

  function requestAction(action: ConfirmAction, assignId?: string) {
    if (action === "reset") {
      setConfirmState({
        title: "Reset demo?",
        message: "Clear ALL demo assignments for THIS church? (1 request • in-memory store • demo only).",
        action: "reset",
      });
      return;
    }

    const title =
      action === "end" ? "End assignment?" : action === "suspend" ? "Suspend assignment?" : "Resume assignment?";

    const message =
      action === "end"
        ? "Unataka ku-end hii assignment? (Itabaki kwenye history kama Ended.)"
        : action === "suspend"
          ? "Unataka ku-suspend? (Member atabaki kwenye history lakini status itakuwa Suspended.)"
          : "Unataka ku-resume? (Status itarudi Active.)";

    setConfirmState({ title, message, action, id: assignId });
  }

  async function patchAssignment(assignId: string, action: "end" | "suspend" | "resume") {
    if (busyActionId) return;
    setBusyActionId(assignId);
    setErrorAssignments("");

    try {
      const { res, json } = await fetchApi<RoleAssignment>(`${ASSIGNMENTS_API}`, {
        method: "PATCH",
        headers: { ...demoHeaders(), "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: assignId, action }),
      });

      if (!res.ok) {
        pushToast("error", "Action failed", pickErrorMessage(json) || `HTTP ${res.status}`);
        return;
      }

      if (!json || json.ok !== true) {
        pushToast("error", "Invalid response", pickErrorMessage(json) || "Invalid response");
        return;
      }

      setAssignments((prev) => prev.map((a) => (a.id === assignId ? json.data : a)));
      pushToast("success", "Updated", `Assignment ${action} done.`);
    } catch (e: any) {
      pushToast("error", "Network error", e?.message || "Network error");
    } finally {
      setBusyActionId("");
    }
  }

  // ✅ COMPLETE: 1-request bulk reset (no per-id deletes)
  async function resetDemo() {
    if (busyAssign || busyActionId) return;

    if (assignments.length === 0) {
      pushToast("info", "Nothing to reset", "Hakuna assignments.");
      return;
    }

    setBusyAssign(true);
    setBusyActionId("__reset__");
    setErrorAssignments("");

    try {
      const { res, json } = await fetchApi<{ deleted: true; count: number; mode: string }>(`${ASSIGNMENTS_API}`, {
        method: "DELETE",
        headers: { ...demoHeaders(), "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "reset" }),
      });

      if (!res.ok) {
        const msg = pickErrorMessage(json) || `HTTP ${res.status}`;
        pushToast("error", "Reset failed", msg);
        return;
      }

      if (!json || json.ok !== true) {
        const msg = pickErrorMessage(json) || "Invalid response";
        pushToast("error", "Reset invalid response", msg);
        return;
      }

      setAssignments([]);
      pushToast("success", "Reset done", `✅ Cleared ${json.data.count} assignments.`);
    } catch (e: any) {
      pushToast("error", "Reset network error", e?.message || "Network error");
    } finally {
      setBusyAssign(false);
      setBusyActionId("");
    }
  }

  async function handleConfirm() {
    const c = confirmState;
    setConfirmState(null);
    if (!c) return;

    if (c.action === "reset") {
      await resetDemo();
      return;
    }

    if (!c.id) return;

    if (c.action === "end") await patchAssignment(c.id, "end");
    if (c.action === "suspend") await patchAssignment(c.id, "suspend");
    if (c.action === "resume") await patchAssignment(c.id, "resume");
  }

  const topLoading = loadingMinistries || loadingAssignments;

  function statusPillStyle(status: RoleAssignment["status"]) {
    if (status === "Active") return pillOk;
    if (status === "Suspended") return pillWarn;
    return pillMuted;
  }

  return (
    <div style={page}>
      {/* TOASTS */}
      <div style={toastWrap}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{ ...toast, ...(t.kind === "success" ? toastOk : t.kind === "error" ? toastErr : toastInfo) }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 950 }}>{t.title}</div>
                {t.message ? <div style={{ opacity: 0.85, marginTop: 4, lineHeight: 1.45 }}>{t.message}</div> : null}
              </div>
              <button style={toastX} onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} aria-label="Close">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* CONFIRM MODAL */}
      {confirmState ? (
        <div style={modalOverlay} role="dialog" aria-modal="true" onMouseDown={() => setConfirmState(null)}>
          <div style={modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 1000, fontSize: 16 }}>{confirmState.title}</div>
            <div style={{ marginTop: 10, opacity: 0.82, lineHeight: 1.55 }}>{confirmState.message}</div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button style={btnGhost} onClick={() => setConfirmState(null)}>
                Cancel
              </button>
              <button style={btnDanger} onClick={handleConfirm}>
                Yes, continue
              </button>
            </div>

            <div style={{ marginTop: 10, opacity: 0.65, fontSize: 12 }}>
              Tip: press <b>ESC</b> to close.
            </div>
          </div>
        </div>
      ) : null}

      {/* HERO */}
      <div style={hero}>
        <div style={{ minWidth: 260 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={title}>🛡️ Church Roles ↔ Ministries</h1>
            {topLoading ? <span style={pillWarn}>Syncing…</span> : <span style={pillOk}>Live</span>}
          </div>

          <div style={subtitle}>
            Assign vyeo kwa <b>members</b> ndani ya <b>ministry</b>. <span style={{ opacity: 0.75 }}>(Demo headers)</span>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={chip}>
                👤 <b>{DEMO_USER_ID}</b> • {DEMO_USER_ROLE}
              </span>
              <span style={chip}>
                🏛️ Church: <b>{DEMO_CHURCH_ID}</b>
              </span>
              <span style={chip}>
                📌 Assignments: <b>{counts.active}</b> Active • <b>{counts.suspended}</b> Suspended • <b>{counts.ended}</b> Ended
              </span>
            </div>

            {preselectMemberId ? (
              <div style={{ marginTop: 12 }}>
                <div style={preselectBox}>
                  🎯 Preselected member:{" "}
                  <b>{preselectedMemberName ? `${preselectedMemberName} (${preselectMemberId})` : preselectMemberId}</b>
                  <div style={{ marginTop: 6, opacity: 0.85 }}>
                    Tip: chagua <b>Role</b> → (kama ni Ministry role) chagua <b>Ministry</b> → Assign.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "flex-end" }}>
          <Link href="/dashboard/church" style={btnGhost as any}>
            ← Back to Church
          </Link>

          {firstDashHref ? (
            <Link href={firstDashHref} style={btnGold as any}>
              🔥 Open First Ministry Dashboard
            </Link>
          ) : (
            <button style={btnDisabled as any} onClick={() => pushToast("info", "No ministries", "Create ministries first.")}>
              Dashboard (needs ministries)
            </button>
          )}

          <button style={btnGhost as any} onClick={() => requestAction("reset")} disabled={busyAssign || busyActionId === "__reset__"}>
            ♻️ Reset Demo
          </button>
        </div>
      </div>

      {/* NAV TABS */}
      <div style={tabsBar}>
        <button style={{ ...tabBtn, ...(activeTab === "overview" ? tabBtnActive : null) }} onClick={() => setActiveTab("overview")}>
          ✨ Overview
        </button>
        <button style={{ ...tabBtn, ...(activeTab === "assign" ? tabBtnActive : null) }} onClick={() => setActiveTab("assign")}>
          ✅ Assign
        </button>
        <button
          style={{ ...tabBtn, ...(activeTab === "assignments" ? tabBtnActive : null) }}
          onClick={() => setActiveTab("assignments")}
        >
          📚 Assignments
        </button>
        <button
          style={{ ...tabBtn, ...(activeTab === "leadership" ? tabBtnActive : null) }}
          onClick={() => setActiveTab("leadership")}
        >
          🧭 Leadership
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button style={btnGhostSm} onClick={loadMinistries} disabled={loadingMinistries}>
            {loadingMinistries ? "Ministries…" : "↻ Ministries"}
          </button>
          <button style={btnGhostSm} onClick={loadAssignments} disabled={loadingAssignments}>
            {loadingAssignments ? "Assignments…" : "↻ Assignments"}
          </button>
        </div>
      </div>

      {/* Errors */}
      {errorMinistries ? (
        <div style={errorBox}>
          <b>⚠️ Ministries Error:</b> <span style={{ opacity: 0.95 }}>{errorMinistries}</span>
          <div style={{ marginTop: 8 }}>
            <button style={btnGhost} onClick={loadMinistries}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {errorAssignments ? (
        <div style={errorBox}>
          <b>⚠️ Assignments Error:</b> <span style={{ opacity: 0.95 }}>{errorAssignments}</span>
          <div style={{ marginTop: 8 }}>
            <button style={btnGhost} onClick={loadAssignments}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {/* OVERVIEW */}
      {activeTab === "overview" ? (
        <>
          {/* KPI STRIP */}
          <section style={kpiStrip}>
            <div style={kpiCard}>
              <div style={kpiLabel}>Ministries</div>
              <div style={kpiValue}>{ministries.length}</div>
              <div style={kpiMeta}>Active: {ministries.filter((m) => m.status === "Active").length}</div>
            </div>
            <div style={kpiCard}>
              <div style={kpiLabel}>Role Definitions</div>
              <div style={kpiValue}>{ROLE_DEFINITIONS.length}</div>
              <div style={kpiMeta}>Ministry roles: {ROLE_DEFINITIONS.filter((r) => isMinistryRole(r.id)).length}</div>
            </div>
            <div style={kpiCard}>
              <div style={kpiLabel}>Assignments</div>
              <div style={kpiValue}>{counts.total}</div>
              <div style={kpiMeta}>
                Active: {counts.active} • Suspended: {counts.suspended} • Ended: {counts.ended}
              </div>
            </div>
            <div style={kpiCard}>
              <div style={kpiLabel}>Quick Actions</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button style={btnGoldSm} onClick={() => setActiveTab("assign")}>
                  Assign now →
                </button>
                <button
                  style={btnGhostSm}
                  onClick={async () => {
                    const ok = await copyText(DEMO_CHURCH_ID);
                    pushToast(ok ? "success" : "error", "Copied", ok ? "Church ID copied" : "Clipboard blocked");
                  }}
                >
                  Copy Church ID
                </button>
              </div>
            </div>
          </section>

          {/* MINISTRIES OVERVIEW */}
          <section style={card}>
            <div style={sectionHead}>
              <div style={sectionTitle}>🏷️ Ministries</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href="/dashboard/church/ministries" style={btnGhostSm as any}>
                  Go to Ministries →
                </Link>
              </div>
            </div>

            {loadingMinistries ? <div style={{ opacity: 0.8, marginTop: 10 }}>Loading ministries…</div> : null}

            {!loadingMinistries && ministries.length === 0 ? (
              <div style={empty}>
                <div style={{ fontWeight: 950 }}>No ministries yet</div>
                <div style={{ opacity: 0.8, marginTop: 6 }}>Nenda Ministries page u-create kwanza.</div>
              </div>
            ) : (
              <div style={grid3}>
                {ministries.map((m) => {
                  const act = (ministryAssignments[m.id] || []).length;
                  return (
                    <div key={m.id} style={miniCard}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={miniTitle}>
                          {m.name}{" "}
                          <span style={m.status === "Active" ? pillOk : pillWarn}>
                            {m.status === "Active" ? "Active" : "Paused"}
                          </span>
                        </div>
                        <button
                          style={btnGhostSm}
                          onClick={async () => {
                            const ok = await copyText(m.id);
                            pushToast(ok ? "success" : "error", "Copy ID", ok ? "Ministry ID copied" : "Clipboard blocked");
                          }}
                          title="Copy ministry id"
                        >
                          Copy ID
                        </button>
                      </div>

                      <div style={miniMeta}>{m.description || "—"}</div>

                      <div style={miniFoot}>
                        <span style={{ opacity: 0.8 }}>ID:</span> {m.id}
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={chip}>
                          👥 Active leaders: <b>{act}</b>
                        </span>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Link href={`/dashboard/church/roles/dashboards/${m.id}`} style={btnGoldSm as any} title="Open ministry dashboard">
                          Open Dashboard →
                        </Link>
                        <button
                          style={btnGhostSm}
                          onClick={() => {
                            quickAssign("youth_leader", m.id);
                            pushToast("info", "Quick assign", `Selected Youth Leader • ${m.name}`);
                          }}
                        >
                          Quick Assign →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ROLES OVERVIEW */}
          <section style={card}>
            <div style={sectionHead}>
              <div style={sectionTitle}>🧩 Roles (Definitions)</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={btnGhostSm}
                  onClick={() => {
                    setActiveTab("assign");
                    pushToast("info", "Assign", "Go assign role now.");
                  }}
                >
                  Assign role →
                </button>
              </div>
            </div>

            <div style={grid3}>
              {ROLE_DEFINITIONS.map((r) => {
                const active = (activeAssignmentsForRole[r.id] || []).length;
                return (
                  <div key={r.id} style={miniCard}>
                    <div style={miniTitle}>
                      <span style={{ marginRight: 8 }}>{r.icon}</span>
                      {r.name} <span style={pillMuted}>{r.tier}</span>{" "}
                      <span style={isMinistryRole(r.id) ? pill : pillMuted}>{isMinistryRole(r.id) ? "Ministry" : "Church"}</span>
                    </div>

                    <div style={miniMeta}>{r.description}</div>

                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={chip}>
                        ✅ Active assigned: <b>{active}</b>
                      </span>
                      <button
                        style={btnGhostSm}
                        onClick={() => {
                          setRoleFilter(r.id);
                          setActiveTab("assignments");
                          pushToast("info", "Filter applied", `Assignments filtered by ${r.name}`);
                        }}
                      >
                        View assignments →
                      </button>
                    </div>

                    <div style={{ marginTop: 10, opacity: 0.85 }}>
                      <b>Permissions:</b>{" "}
                      {r.permissions.length === 0 ? (
                        <span style={{ opacity: 0.75 }}>—</span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                          {r.permissions.map((p) => (
                            <span key={p} style={pillMuted}>
                              {permBadge(p)}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>

                    <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        style={btnGoldSm}
                        onClick={() => {
                          quickAssign(r.id);
                          pushToast("info", "Selected role", `${r.icon} ${r.name}`);
                        }}
                      >
                        Assign this →
                      </button>
                      {isMinistryRole(r.id) ? <span style={pillWarn}>Needs ministry</span> : <span style={pillMuted}>Church scope</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {/* ASSIGN */}
      {activeTab === "assign" ? (
        <section style={card} ref={assignSectionRef}>
          <div style={sectionHead}>
            <div style={sectionTitle}>✅ Assign Role</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                style={btnGhostSm}
                onClick={() => {
                  setAssignRoleId("");
                  setAssignMinistryId("");
                  if (!preselectMemberId) setAssignMemberId("");
                  pushToast("info", "Cleared", "Form reset.");
                }}
              >
                Clear
              </button>
              <button style={btnGhostSm} onClick={() => setActiveTab("assignments")}>
                Go to Assignments →
              </button>
            </div>
          </div>

          <div style={grid3}>
            <div>
              <div style={label}>Role</div>
              <select
                ref={roleSelectRef}
                style={input}
                value={assignRoleId}
                onChange={(e) => {
                  const rid = (e.target.value || "") as RoleId | "";
                  setAssignRoleId(rid);
                  if (!rid || !isMinistryRole(rid)) setAssignMinistryId("");
                }}
              >
                <option value="">— Select Role —</option>
                {ROLE_DEFINITIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.icon} {r.name} ({isMinistryRole(r.id) ? "Ministry" : "Church"})
                  </option>
                ))}
              </select>

              {selectedRoleDef ? (
                <div style={hint}>
                  Tier: <b>{selectedRoleDef.tier}</b> • Scope: <b>{isMinistryRole(selectedRoleDef.id) ? "Ministry" : "Church"}</b>{" "}
                  {isMinistryRole(selectedRoleDef.id) ? "→ lazima uchague ministry" : ""}
                </div>
              ) : (
                <div style={hint}>Tip: Chagua role kwanza, halafu member, halafu ministry (ikiwa inahitajika).</div>
              )}
            </div>

            <div>
              <div style={label}>Member</div>
              <select style={input} value={assignMemberId} onChange={(e) => setAssignMemberId(e.target.value)}>
                <option value="">— Select Member —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName} ({m.id})
                  </option>
                ))}
              </select>

              {preselectMemberId ? (
                <div style={hint}>
                  ✅ From URL: <b>{preselectedMemberName || preselectMemberId}</b>
                </div>
              ) : (
                <div style={hint}>Demo members for now (later: API).</div>
              )}
            </div>

            <div>
              <div style={label}>
                Ministry{" "}
                {mustPickMinistry ? <span style={{ opacity: 0.8 }}>(required)</span> : <span style={{ opacity: 0.6 }}>(optional)</span>}
              </div>

              <select
                style={{
                  ...input,
                  opacity: mustPickMinistry ? 1 : 0.7,
                  cursor: mustPickMinistry ? "pointer" : "not-allowed",
                }}
                disabled={!mustPickMinistry}
                value={assignMinistryId}
                onChange={(e) => setAssignMinistryId(e.target.value)}
              >
                <option value="">— Select Ministry —</option>
                {ministries.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>

              {mustPickMinistry && ministries.length === 0 ? (
                <div style={hint}>⚠️ Hakuna ministries bado. Create ministries kwanza.</div>
              ) : null}

              {mustPickMinistry && ministries.length > 0 ? (
                <div style={hint}>
                  Selected: <b>{assignMinistryId ? ministryMap.get(assignMinistryId)?.name || assignMinistryId : "—"}</b>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            <button style={{ ...btnGold, opacity: busyAssign ? 0.7 : 1 }} onClick={assignRole} disabled={busyAssign}>
              {busyAssign ? "Saving…" : "✅ Assign"}
            </button>

            <div style={{ opacity: 0.8 }}>
              {assignRoleId ? (
                <>
                  Preview:{" "}
                  <b>
                    {ROLE_DEFINITIONS.find((r) => r.id === assignRoleId)?.name || assignRoleId}
                    {mustPickMinistry && assignMinistryId ? ` • ${ministryMap.get(assignMinistryId)?.name || assignMinistryId}` : ""}
                  </b>
                </>
              ) : (
                "Pick a role to preview."
              )}
            </div>
          </div>

          <div style={{ marginTop: 12, ...softTip }}>
            🚀 Upgrade note: Reset sasa ni <b>1 request</b> (bulk), hakuna tena delete moja moja.
          </div>
        </section>
      ) : null}

      {/* ASSIGNMENTS */}
      {activeTab === "assignments" ? (
        <section style={card}>
          <div style={sectionHead}>
            <div style={sectionTitle}>📚 Assignments</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={btnGhostSm} onClick={() => setActiveTab("assign")}>
                Assign →
              </button>
            </div>
          </div>

          {/* FILTER BAR */}
          <div style={filterBar}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Search</div>
              <input style={input} placeholder="Search member / role / ministry / pastor…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Status</div>
              <select style={input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                <option value="All">All</option>
                <option value="Active">Active</option>
                <option value="Suspended">Suspended</option>
                <option value="Ended">Ended</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Scope</div>
              <select style={input} value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as any)}>
                <option value="All">All</option>
                <option value="Ministry">Ministry</option>
                <option value="Church">Church</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Role</div>
              <select style={input} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
                <option value="All">All</option>
                {ROLE_DEFINITIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.icon} {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Ministry</div>
              <select style={input} value={ministryFilter} onChange={(e) => setMinistryFilter(e.target.value as any)}>
                <option value="All">All</option>
                {ministries.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Sort</div>
              <select style={input} value={sortMode} onChange={(e) => setSortMode(e.target.value as any)}>
                <option value="Newest">Newest</option>
                <option value="Oldest">Oldest</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <button
                style={btnGhostSm}
                onClick={() => {
                  setQ("");
                  setStatusFilter("All");
                  setRoleFilter("All");
                  setScopeFilter("All");
                  setMinistryFilter("All");
                  setSortMode("Newest");
                  pushToast("info", "Filters cleared", "Back to default list.");
                }}
              >
                Clear filters
              </button>
              <span style={chip}>
                Showing: <b>{filteredAssignments.length}</b>
              </span>
            </div>
          </div>

          {loadingAssignments ? <div style={{ opacity: 0.8, marginTop: 10 }}>Loading assignments…</div> : null}

          {!loadingAssignments && filteredAssignments.length === 0 ? (
            <div style={empty}>
              <div style={{ fontWeight: 950 }}>No assignments found</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>Try changing filters, or assign a new role.</div>
              <div style={{ marginTop: 10 }}>
                <button style={btnGoldSm} onClick={() => setActiveTab("assign")}>
                  Assign now →
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {filteredAssignments.map((a) => {
                const role = ROLE_DEFINITIONS.find((r) => r.id === a.roleId) || null;
                const dashHref = getDashboardHref(a.roleId, a.ministryId);
                const actingThis = busyActionId === a.id;

                const ministryLabel =
                  a.ministryName ||
                  (a.ministryId ? ministryMap.get(a.ministryId)?.name : "") ||
                  (a.ministryId ? a.ministryId : "") ||
                  "";

                return (
                  <div key={a.id} style={row}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div style={{ minWidth: 240 }}>
                        <div style={rowTitle}>
                          {a.memberName}{" "}
                          <span style={pill}>
                            {role ? `${role.icon} ${role.name}` : a.roleId}
                            {isMinistryRole(a.roleId) ? "" : " • Church"}
                          </span>{" "}
                          <span style={statusPillStyle(a.status)}>{a.status}</span>
                        </div>

                        <div style={rowMeta}>
                          {isMinistryRole(a.roleId) ? (
                            <>
                              <span style={{ opacity: 0.85 }}>Ministry:</span> <b>{ministryLabel || "—"}</b>
                            </>
                          ) : (
                            <span style={{ opacity: 0.85 }}>Church-scope role</span>
                          )}
                        </div>

                        <div style={rowFoot}>
                          Assigned: {fmt(a.assignedAt)}
                          {a.endsAt ? ` • Ends: ${fmt(a.endsAt)}` : ""}
                          <span style={{ opacity: 0.8 }}> • By: </span>
                          <b>{a.assignedByPastorName}</b>
                        </div>

                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            style={btnGhostSm}
                            onClick={async () => {
                              const ok = await copyText(a.id);
                              pushToast(ok ? "success" : "error", "Copy assignment ID", ok ? "Copied" : "Clipboard blocked");
                            }}
                          >
                            Copy ID
                          </button>

                          <button
                            style={btnGhostSm}
                            onClick={() => {
                              setActiveTab("assign");
                              setAssignMemberId(a.memberId);
                              pushToast("info", "Member selected", a.memberName);
                            }}
                          >
                            Assign more →
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {dashHref ? (
                          <Link href={dashHref} style={btnGoldSm as any}>
                            Open Dashboard →
                          </Link>
                        ) : (
                          <button
                            style={btnDisabledSm}
                            onClick={() => pushToast("info", "Dashboard soon", "Dashboard ya role hii (church-scope) bado haijawekwa.")}
                          >
                            Dashboard (soon)
                          </button>
                        )}

                        {a.status === "Active" ? (
                          <>
                            <button style={{ ...btnGhostSm, opacity: actingThis ? 0.7 : 1 }} disabled={!!busyActionId} onClick={() => requestAction("suspend", a.id)}>
                              {actingThis ? "Working…" : "Suspend"}
                            </button>
                            <button style={{ ...btnDangerSm, opacity: actingThis ? 0.7 : 1 }} onClick={() => requestAction("end", a.id)} disabled={actingThis || !!busyActionId}>
                              {actingThis ? "Working…" : "End"}
                            </button>
                          </>
                        ) : null}

                        {a.status === "Suspended" ? (
                          <>
                            <button style={{ ...btnGoldSm, opacity: actingThis ? 0.7 : 1 }} disabled={!!busyActionId} onClick={() => requestAction("resume", a.id)}>
                              {actingThis ? "Working…" : "Resume"}
                            </button>
                            <button style={{ ...btnDangerSm, opacity: actingThis ? 0.7 : 1 }} onClick={() => requestAction("end", a.id)} disabled={actingThis || !!busyActionId}>
                              {actingThis ? "Working…" : "End"}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 12, ...softTip }}>🔎 Pro tip: Tumia search + filters kuona “leaders” wa ministry fulani au role fulani haraka.</div>
        </section>
      ) : null}

      {/* LEADERSHIP */}
      {activeTab === "leadership" ? (
        <section style={card}>
          <div style={sectionHead}>
            <div style={sectionTitle}>🧭 Ministry Leadership View</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={btnGhostSm} onClick={() => setOpenMinistryId("")}>
                Collapse all
              </button>
              <button
                style={btnGhostSm}
                onClick={() => {
                  const first = ministries?.[0]?.id || "";
                  if (first) setOpenMinistryId(first);
                }}
              >
                Open first
              </button>
            </div>
          </div>

          {ministries.length === 0 ? (
            <div style={empty}>
              <div style={{ fontWeight: 950 }}>No ministries yet</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>Create ministries kwanza, halafu assign viongozi.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {ministries.map((m) => {
                const items = (ministryAssignments[m.id] || []).slice();
                const isOpen = openMinistryId === m.id;

                return (
                  <div key={m.id} style={row}>
                    <button style={accordionTop} onClick={() => setOpenMinistryId((prev) => (prev === m.id ? "" : m.id))} aria-expanded={isOpen}>
                      <div>
                        <div style={rowTitle}>
                          {m.name} <span style={m.status === "Active" ? pillOk : pillWarn}>{m.status}</span>{" "}
                          <span style={pillMuted}>Active leaders: {items.length}</span>
                        </div>
                        <div style={rowMeta}>{m.description || "—"}</div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <Link href={`/dashboard/church/roles/dashboards/${m.id}`} style={btnGoldSm as any} onClick={(e) => e.stopPropagation()}>
                          Dashboard →
                        </Link>
                        <span style={{ opacity: 0.7, fontWeight: 950 }}>{isOpen ? "▾" : "▸"}</span>
                      </div>
                    </button>

                    {isOpen ? (
                      <div style={{ marginTop: 10 }}>
                        {items.length === 0 ? (
                          <div style={{ opacity: 0.8 }}>Hakuna viongozi bado. Assign roles za ministry kwenye tab “Assign”.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {items.map((a) => {
                              const rr = ROLE_DEFINITIONS.find((r) => r.id === a.roleId) || null;
                              const actingThis = busyActionId === a.id;

                              return (
                                <div key={a.id} style={miniLine}>
                                  <div>
                                    <b>{a.memberName}</b> — <span style={pill}>{rr ? `${rr.icon} ${rr.name}` : a.roleId}</span>{" "}
                                    <span style={statusPillStyle(a.status)}>{a.status}</span>
                                    <div style={{ opacity: 0.75, fontSize: 12 }}>Assigned: {fmt(a.assignedAt)}</div>
                                  </div>

                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <button
                                      style={btnGhostSm}
                                      onClick={async () => {
                                        const ok = await copyText(a.id);
                                        pushToast(ok ? "success" : "error", "Copy assignment ID", ok ? "Copied" : "Clipboard blocked");
                                      }}
                                    >
                                      Copy ID
                                    </button>

                                    {a.status === "Active" ? (
                                      <>
                                        <button style={{ ...btnGhostSm, opacity: actingThis ? 0.7 : 1 }} disabled={!!busyActionId} onClick={() => requestAction("suspend", a.id)}>
                                          {actingThis ? "Working…" : "Suspend"}
                                        </button>
                                        <button style={{ ...btnDangerSm, opacity: actingThis ? 0.7 : 1 }} disabled={actingThis || !!busyActionId} onClick={() => requestAction("end", a.id)}>
                                          {actingThis ? "Working…" : "End"}
                                        </button>
                                      </>
                                    ) : null}

                                    {a.status === "Suspended" ? (
                                      <>
                                        <button style={{ ...btnGoldSm, opacity: actingThis ? 0.7 : 1 }} disabled={!!busyActionId} onClick={() => requestAction("resume", a.id)}>
                                          {actingThis ? "Working…" : "Resume"}
                                        </button>
                                        <button style={{ ...btnDangerSm, opacity: actingThis ? 0.7 : 1 }} disabled={actingThis || !!busyActionId} onClick={() => requestAction("end", a.id)}>
                                          {actingThis ? "Working…" : "End"}
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            style={btnGoldSm}
                            onClick={() => {
                              quickAssign("youth_leader", m.id);
                              pushToast("info", "Assign flow ready", `Selected Youth Leader • ${m.name}`);
                            }}
                          >
                            Assign leader →
                          </button>
                          <button
                            style={btnGhostSm}
                            onClick={() => {
                              setActiveTab("assignments");
                              setMinistryFilter(m.id);
                              setScopeFilter("Ministry");
                              pushToast("info", "Filtered", `Assignments filtered by ${m.name}`);
                            }}
                          >
                            View all assignments →
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 12, ...softTip }}>
            🧠 Upgrade note: Hapa ni “accordion view” ya kila ministry + viongozi wake.
          </div>
        </section>
      ) : null}

      <div style={tip}>
        ✅ Roles page sasa inatumia <b>API</b> (GET/POST/PATCH/DELETE) kwenye <b>{ASSIGNMENTS_API}</b>. Reset ni bulk (1 request).
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
  marginBottom: 12,
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.12), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const title: CSSProperties = { fontSize: 26, fontWeight: 1000, margin: 0, color: "rgba(255,236,190,0.98)" };
const subtitle: CSSProperties = { opacity: 0.86, marginTop: 8, lineHeight: 1.6, maxWidth: 980 };

const preselectBox: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(34,197,94,0.22)",
  background: "rgba(34,197,94,0.10)",
  padding: "10px 12px",
  color: "rgba(187,247,208,0.95)",
  lineHeight: 1.6,
};

const card: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
  marginBottom: 14,
};

const sectionHead: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const sectionTitle: CSSProperties = { fontWeight: 1000, color: "rgba(255,236,190,0.98)", fontSize: 14 };

const grid3: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 10,
};

const label: CSSProperties = { fontSize: 12, fontWeight: 950, opacity: 0.85, marginBottom: 6 };

const input: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.22)",
  color: "inherit",
  width: "100%",
  outline: "none",
  fontWeight: 850,
};

const hint: CSSProperties = { marginTop: 6, opacity: 0.78, fontSize: 12, lineHeight: 1.5 };

const row: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.20)",
  padding: 12,
};

const rowTitle: CSSProperties = { fontWeight: 1000, fontSize: 14 };
const rowMeta: CSSProperties = { opacity: 0.82, marginTop: 6, lineHeight: 1.55 };
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
  border: "1px solid rgba(212,175,55,0.24)",
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
  border: "1px solid rgba(212,175,55,0.36)",
  background: "rgba(212,175,55,0.15)",
  color: "rgba(255,236,190,0.98)",
};

const btnGhost: CSSProperties = { ...btnBase, opacity: 0.92 };

const btnDisabled: CSSProperties = { ...btnBase, opacity: 0.55, cursor: "not-allowed" };

const btnGoldSm: CSSProperties = { ...btnGold, padding: "8px 10px", borderRadius: 12, fontSize: 13 };
const btnGhostSm: CSSProperties = { ...btnGhost, padding: "8px 10px", borderRadius: 12, fontSize: 13 };
const btnDisabledSm: CSSProperties = { ...btnGhostSm, opacity: 0.55, cursor: "not-allowed" };

const btnDangerSm: CSSProperties = {
  ...btnBase,
  padding: "8px 10px",
  borderRadius: 12,
  fontSize: 13,
  border: "1px solid rgba(239,68,68,0.30)",
  background: "rgba(239,68,68,0.12)",
  color: "rgba(254,226,226,0.95)",
};

const btnDanger: CSSProperties = {
  ...btnBase,
  border: "1px solid rgba(239,68,68,0.32)",
  background: "rgba(239,68,68,0.12)",
  color: "rgba(254,226,226,0.95)",
};

const tip: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(34,197,94,0.22)",
  background: "rgba(34,197,94,0.10)",
  padding: 12,
  lineHeight: 1.6,
  color: "rgba(187,247,208,0.95)",
};

const softTip: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  padding: 12,
  lineHeight: 1.6,
  color: "rgba(255,255,255,0.90)",
};

const miniCard: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.20)",
  padding: 12,
};

const miniTitle: CSSProperties = { fontWeight: 1000, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const miniMeta: CSSProperties = { opacity: 0.82, marginTop: 6, lineHeight: 1.5 };
const miniFoot: CSSProperties = { opacity: 0.65, marginTop: 8, fontSize: 12 };

const miniLine: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.18)",
  padding: 10,
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

const chip: CSSProperties = {
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 900,
  opacity: 0.95,
  display: "inline-flex",
  gap: 6,
  alignItems: "center",
};

const empty: CSSProperties = {
  borderRadius: 14,
  border: "1px dashed rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.14)",
  padding: 14,
  marginTop: 10,
  lineHeight: 1.6,
};

const tabsBar: CSSProperties = {
  position: "sticky",
  top: 10,
  zIndex: 5,
  marginBottom: 12,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.26)",
  backdropFilter: "blur(8px)",
  padding: 10,
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const tabBtn: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  cursor: "pointer",
  fontWeight: 950,
  color: "inherit",
};

const tabBtnActive: CSSProperties = {
  border: "1px solid rgba(212,175,55,0.38)",
  background: "rgba(212,175,55,0.16)",
  color: "rgba(255,236,190,0.98)",
};

const kpiStrip: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
  marginBottom: 14,
};

const kpiCard: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
};

const kpiLabel: CSSProperties = { opacity: 0.8, fontWeight: 950, fontSize: 12 };
const kpiValue: CSSProperties = { fontSize: 28, fontWeight: 1000, marginTop: 8, color: "rgba(255,236,190,0.98)" };
const kpiMeta: CSSProperties = { opacity: 0.75, marginTop: 6, fontSize: 12 };

const filterBar: CSSProperties = {
  marginTop: 10,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  padding: 12,
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  alignItems: "end",
};

const accordionTop: CSSProperties = {
  width: "100%",
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  textAlign: "left",
};

const toastWrap: CSSProperties = {
  position: "fixed",
  top: 14,
  right: 14,
  zIndex: 50,
  display: "grid",
  gap: 10,
  width: "min(420px, calc(100vw - 28px))",
};

const toast: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.62)",
  padding: 12,
  boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
};

const toastOk: CSSProperties = { border: "1px solid rgba(34,197,94,0.26)" };
const toastErr: CSSProperties = { border: "1px solid rgba(239,68,68,0.30)" };
const toastInfo: CSSProperties = { border: "1px solid rgba(212,175,55,0.26)" };

const toastX: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.25)",
  color: "inherit",
  borderRadius: 10,
  padding: "6px 9px",
  cursor: "pointer",
  fontWeight: 950,
  height: 32,
};

const modalOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 14,
};

const modalCard: CSSProperties = {
  width: "min(560px, 100%)",
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.68)",
  padding: 14,
  boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
};
