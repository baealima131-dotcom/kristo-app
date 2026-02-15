"use client";


import { listMinistries, createMinistry, updateMinistry, deleteMinistry, type Ministry, type MinistryStatus } from "@/lib/api/church";
import { listMinistryMembers, addMinistryMember, removeMinistryMember, updateMinistryMemberRole, type MinistryMember, type MinistryMemberRole } from "@/lib/api/ministryMembers";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const DEV_USER_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_USER_ID || "";
const DEV_ROLE = process.env.NEXT_PUBLIC_KRISTO_DEV_ROLE || "";
const DEV_CHURCH_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_CHURCH_ID || "";

/* =========================
   TYPES
   ========================= */

type ChurchMember = {
  id: string;
  churchId: string;
  userId: string;
  name: string;
  roleLabel?: string;
  joinedAt: string;
  updatedAt?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: unknown };
type ApiRes<T> = ApiOk<T> | ApiErr;

/* =========================
   HELPERS (UI)
   ========================= */

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
      "Forbidden. Role/church scope haikuruhusu. Hakikisha role ni Pastor au Church_Admin (au tumia KRISTO_DEV_ROLE + KRISTO_DEV_CHURCH_ID kwa dev)."
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

function prettyMemberLabel(m: ChurchMember) {
  const name = (m.name || "Member").trim();
  const role = (m.roleLabel || "").trim();
  return role ? `${name} • ${m.userId} • ${role}` : `${name} • ${m.userId}`;
}

function profileHref(id: string) {
  return "/dashboard/church/ministries/" + encodeURIComponent(id);
}

/* =========================
   DEV HEADERS (client-only)
   If user stores these keys in localStorage, client will attach headers
   to match KRISTO_DEV_HEADER_AUTH=1 server setting.
   ========================= */

function devHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    // Opt-in only: set localStorage.kristo_dev_header_auth = "1" to force header auth
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
export default function MinistriesPage() {
  const sp = useSearchParams();
  const openFromUrl = String(sp.get("open") || "").trim();
  const [items, setItems] = useState<Ministry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<MinistryStatus>("Active");

  // VIP UX: expanded ministry panel
  const [openId, setOpenId] = useState<string | null>(null);

  // Auto-open ministry panel from URL: ?open=ministryId
  useEffect(() => {
    if (!openFromUrl) return;
    setOpenId(openFromUrl);
  }, [openFromUrl]);

  // DEV: toggle header-auth via URL (terminal-friendly)
  // Example: /dashboard/church/ministries?devHeaderAuth=1  OR  ?devHeaderAuth=0
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = String(sp.get("devHeaderAuth") || "").trim();
      if (v === "1" || v === "0") localStorage.setItem("kristo_dev_header_auth", v);
    } catch {}
  }, [sp]);

  // DEV: auto-seed localStorage headers from NEXT_PUBLIC_* env (client-only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!localStorage.getItem("kristo_dev_header_auth")) localStorage.setItem("kristo_dev_header_auth","0");
      if (DEV_USER_ID && !localStorage.getItem("kristo_dev_user_id")) localStorage.setItem("kristo_dev_user_id", DEV_USER_ID);
      if (DEV_ROLE && !localStorage.getItem("kristo_dev_role")) localStorage.setItem("kristo_dev_role", DEV_ROLE);
      if (DEV_CHURCH_ID && !localStorage.getItem("kristo_dev_church_id")) localStorage.setItem("kristo_dev_church_id", DEV_CHURCH_ID);
    } catch {}
  }, []);

  // Members cache per ministry
  const [membersByMinistry, setMembersByMinistry] = useState<Record<string, MinistryMember[]>>({});
  const [membersLoadingByMinistry, setMembersLoadingByMinistry] = useState<Record<string, boolean>>({});
  const [membersErrorByMinistry, setMembersErrorByMinistry] = useState<Record<string, string>>({});

  // Church members (for dropdown)
  const [churchMembers, setChurchMembers] = useState<ChurchMember[]>([]);
  const [churchMembersLoading, setChurchMembersLoading] = useState(false);
  const [churchMembersError, setChurchMembersError] = useState("");
  const [churchMemberSearchByMinistry, setChurchMemberSearchByMinistry] = useState<Record<string, string>>({});

  // per-ministry add form state
  const [addUserIdByMinistry, setAddUserIdByMinistry] = useState<Record<string, string>>({});
  const [addRoleByMinistry, setAddRoleByMinistry] = useState<Record<string, MinistryMemberRole>>({});

  // small guard to prevent rapid double clicks
  const busyRef = useRef(false);

const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const at = +new Date(a.createdAt || "");
      const bt = +new Date(b.createdAt || "");
      return bt - at;
    });
  }, [items]);

  async function loadChurchMembers() {
    setChurchMembersLoading(true);
    setChurchMembersError("");
    try {
      const res = await fetch("/api/church/members", {
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });

      const json = await readApi<ChurchMember[]>(res);

      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setChurchMembersError(explainAuthProblem(res.status, msg || "Failed to load church members"));
        setChurchMembers([]);
        return;
      }

      const list = Array.isArray(json.data) ? json.data : [];
      // Sort by name (nice UX)
      list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      setChurchMembers(list);
    } catch {
      setChurchMembersError("Network error");
      setChurchMembers([]);
    } finally {
      setChurchMembersLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const json = await listMinistries();
      if (!json.ok) {
        setError(json.error || "Failed to load ministries");
        setItems([]);
        return;
      }

      const next = Array.isArray(json.data) ? json.data : [];
      setItems(next);

      // cleanup members caches for removed ministries (keep memory clean)
      const ids = new Set(next.map((x) => x.id));
      setMembersByMinistry((cur) => {
        const out: Record<string, MinistryMember[]> = {};
        for (const k of Object.keys(cur)) if (ids.has(k)) out[k] = cur[k];
        return out;
      });
      setMembersLoadingByMinistry((cur) => {
        const out: Record<string, boolean> = {};
        for (const k of Object.keys(cur)) if (ids.has(k)) out[k] = cur[k];
        return out;
      });
      setMembersErrorByMinistry((cur) => {
        const out: Record<string, string> = {};
        for (const k of Object.keys(cur)) if (ids.has(k)) out[k] = cur[k];
        return out;
      });
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    const n = String(name ?? "").trim();
    if (!n) {
      setError("Ministry name is required");
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) return alert("Weka jina la ministry");

    setLoading(true);
    setError("");
    try {
      const cleanDesc = description.trim() ? description.trim() : undefined;
      const json = await createMinistry({ name: cleanName, description: cleanDesc });
      if (!json.ok) {
        setError(json.error || "Failed to create ministry");
        return;
      }

      setName("");
      setDescription("");
      setOpenId(json.data.id);
      await load();
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function update(
    m: Ministry,
    patch: Partial<Pick<Ministry, "name" | "description" | "status">>
  ) {
    setLoading(true);
    setError("");
    try {
      const json = await updateMinistry({ id: m.id, ...patch });
      if (!json.ok) {
        setError(json.error || "Failed to update ministry");
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function removeMinistry(id: string) {
    const ok = confirm("Unafuta ministry hii?");
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      const json = await deleteMinistry(id);
      if (!json.ok) {
        setError(json.error || "Failed to delete ministry");
        return;
      }

      if (openId === id) setOpenId(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // MEMBERS (VIP Gold)
  // =========================

  function setMembersLoading(mid: string, v: boolean) {
    setMembersLoadingByMinistry((cur) => ({ ...cur, [mid]: v }));
  }
  function setMembersError(mid: string, msg: string) {
    setMembersErrorByMinistry((cur) => ({ ...cur, [mid]: msg }));
  }

  async function loadMembers(mid: string) {
    setMembersLoading(mid, true);
    setMembersError(mid, "");
    try {
      const json = await listMinistryMembers(mid);
      if (!json.ok) {
        setMembersError(mid, json.error || "Failed to load members");
        setMembersByMinistry((cur) => ({ ...cur, [mid]: [] }));
        return;
      }
      const list = Array.isArray(json.data) ? json.data : [];
      setMembersByMinistry((cur) => ({ ...cur, [mid]: list }));
    } catch (e: any) {
      setMembersError(mid, e?.message || "Network error");
    } finally {
      setMembersLoading(mid, false);
    }
  }
  async function addMember(mid: string) {
    const userId = String(addUserIdByMinistry[mid] || "").trim();
    const role = (addRoleByMinistry[mid] || "Member") as MinistryMemberRole;

    if (!userId) return;

    // Prevent duplicates (client side)
    const existing = (membersByMinistry[mid] || []).some((m) => m.userId === userId);
    if (existing) {
      setMembersError(mid, "⚠️ Member tayari yupo kwenye ministry hii.");
      return;
    }

    setMembersLoading(mid, true);
    setMembersError(mid, "");
    try {
      const json = await addMinistryMember({ ministryId: mid, userId, role });
      if (!json.ok) {
        setMembersError(mid, json.error || "Failed to add member");
        return;
      }

      setAddUserIdByMinistry((cur) => ({ ...cur, [mid]: "" }));
      setMembersByMinistry((cur) => ({ ...cur, [mid]: [json.data, ...(cur[mid] || [])] }));
    } catch (e: any) {
      setMembersError(mid, e?.message || "Network error");
    } finally {
      setMembersLoading(mid, false);
    }
  }


  async function changeMemberRole(mid: string, mm: MinistryMember, nextRole: MinistryMemberRole) {
    if (busyRef.current) return;
    busyRef.current = true;

    setMembersLoading(mid, true);
    setMembersError(mid, "");
    try {
      const json = await updateMinistryMemberRole({ id: mm.id, role: nextRole });
      if (!json.ok) {
        setMembersError(mid, json.error || "Failed to update role");
        return;
      }
      await loadMembers(mid);
    } catch (e: any) {
      setMembersError(mid, e?.message || "Network error");
    } finally {
      setMembersLoading(mid, false);
      busyRef.current = false;
    }
  }

  async function removeMember(mid: string, mm: MinistryMember) {
    const ok = confirm(`Remove user ${mm.userId} from this ministry?`);
    if (!ok) return;

    if (busyRef.current) return;
    busyRef.current = true;

    setMembersLoading(mid, true);
    setMembersError(mid, "");
    try {
      const json = await removeMinistryMember(mm.id);
      if (!json.ok) {
        setMembersError(mid, json.error || "Failed to remove member");
        return;
      }
      await loadMembers(mid);
    } catch (e: any) {
      setMembersError(mid, e?.message || "Network error");
    } finally {
      setMembersLoading(mid, false);
      busyRef.current = false;
    }
  }

  async function toggleOpen(mid: string) {
    const next = openId === mid ? null : mid;
    setOpenId(next);

    // Clear search when closing a ministry panel (per-ministry UX)
    if (!next) {
      setChurchMemberSearchByMinistry((cur) => ({ ...cur, [mid]: "" }));
      return;
    }

    // Load members when opening
    const cached = membersByMinistry[next];
    if (!cached) await loadMembers(next);

    // Ensure church members loaded so dropdown is useful
    if (!churchMembersLoading && churchMembers.length === 0) {
      await loadChurchMembers();
    }
  }



  // initial load
  useEffect(() => {
    load().catch(() => {});
    loadChurchMembers().catch(() => {});
  }, []);

  // =========================
  // VIP STYLES (simple + cinematic)
  // =========================

  const shellWrap: React.CSSProperties = { padding: 20, maxWidth: 980 };
  const glass: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 16,
    background:
      "radial-gradient(800px 300px at 12% 0%, rgba(212,175,55,0.14), transparent 55%), rgba(0,0,0,0.15)",
    boxShadow: "0 18px 45px rgba(0,0,0,0.45)",
  };
  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    color: "inherit",
    fontWeight: 900,
    cursor: "pointer",
  };
  const btnGold: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(212,175,55,0.34)",
    background: "rgba(212,175,55,0.10)",
    color: "rgba(255,236,190,0.98)",
    fontWeight: 950,
    cursor: "pointer",
  };
  const btnDanger: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,120,120,0.28)",
    background: "rgba(255,120,120,0.10)",
    color: "rgba(255,210,210,0.95)",
    fontWeight: 950,
    cursor: "pointer",
  };
  const input: React.CSSProperties = {
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.2)",
    color: "inherit",
    fontWeight: 850,
    width: "100%",
  };
  const select: React.CSSProperties = { ...input, cursor: "pointer" };

  return (
    <div style={shellWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>🏛️ Ministries</h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            API: <b>/api/church/ministries</b>
          </div>
          <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
            VIP Gold: manage ministries + members (API: <b>/api/church/ministry-members</b>)
          </div>
          <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
            Auth note: In prod, API uses Kristo session cookie. In dev, set <b>KRISTO_DEV_AUTO_LOGIN=1</b> in{" "}
            <b>.env.local</b> then restart dev server. Optional: set <b>KRISTO_DEV_HEADER_AUTH=1</b> and send headers{" "}
            <b>x-kristo-user-id</b>, <b>x-kristo-role</b>, <b>x-kristo-church-id</b>.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={load} disabled={loading} style={btnGold}>
            {loading ? "Working..." : "Refresh"}
          </button>

          <button onClick={loadChurchMembers} disabled={churchMembersLoading} style={btn}>
            {churchMembersLoading ? "Loading members..." : "Refresh Church Members"}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, color: "salmon", fontWeight: 900, whiteSpace: "pre-wrap" }}>⛔ {error}</div>
      
                  ) : null
                  }

      {churchMembersError ? (
        <div style={{ marginTop: 10, color: "salmon", fontWeight: 900, whiteSpace: "pre-wrap" }}>
          ⛔ Church Members: {churchMembersError}
        </div>
      ) : null}

      {/* Create */}
      <div style={{ ...glass, marginTop: 16, padding: 14 }}>
        <h3 style={{ marginTop: 0, marginBottom: 10 }}>Create Ministry</h3>

        <div style={{ display: "grid", gap: 10 }}>
          <input placeholder="Ministry name" value={name} onChange={(e) => setName(e.target.value)} style={input} />

          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={input}
          />

          <select value={status} onChange={(e) => setStatus(e.target.value as MinistryStatus)} style={select}>
            <option value="Active">Active</option>
            <option value="Paused">Paused</option>
          </select>

          <button onClick={create} disabled={loading} style={btnGold}>
            {loading ? "Working..." : "Create"}
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 10 }}>List</h3>

        {sorted.length === 0 ? (
          <div style={{ opacity: 0.8 }}>{loading ? "Loading..." : "No ministries yet"}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {sorted.map((m) => {
              const isOpen = openId === m.id;
              const mMembers = membersByMinistry[m.id];
              const mLoading = !!membersLoadingByMinistry[m.id];
              const mErr = membersErrorByMinistry[m.id] || "";

              const addUserId = addUserIdByMinistry[m.id] || "";
              const addRole = (addRoleByMinistry[m.id] || "Member") as MinistryMemberRole;

              const alreadyInThisMinistry =
                !!addUserId && Array.isArray(mMembers) && mMembers.some((x) => x.userId === addUserId);

              const search = String(churchMemberSearchByMinistry[m.id] || "").trim().toLowerCase();
              const filteredChurchMembers = !search
                ? churchMembers
                : churchMembers.filter((cm) => {const a = String(cm.name || "").toLowerCase();
                    const b = String(cm.userId || "").toLowerCase();
                    const c = String(cm.roleLabel || "").toLowerCase();
                    return a.includes(search) || b.includes(search) || c.includes(search);
                  });

              return (
                <div key={m.id} style={{ ...glass, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 260 }}>
                      <div style={{ fontWeight: 950, fontSize: 16 }}>{m.name}</div>
                      <div style={{ opacity: 0.85, marginTop: 6 }}>{m.description || "—"}</div>
                      <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
                        {m.status} • created {new Date(m.createdAt).toLocaleString()}
                        {m.updatedAt ? ` • updated ${new Date(m.updatedAt).toLocaleString()}` : ""}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => update(m, { status: m.status === "Active" ? "Paused" : "Active" })}
                        disabled={loading}
                        style={btn}
                      >
                        Toggle Status
                      </button>

                      <button
                        onClick={() => {
                          const next = prompt("New name", m.name);
                          if (next === null) return;
                          const clean = next.trim();
                          if (!clean) return alert("Name haiwezi kuwa empty");
                          update(m, { name: clean }).catch(() => {});
                        }}
                        disabled={loading}
                        style={btn}
                      >
                        Rename
                      </button>

                      <button
                        onClick={() => {
                          const next = prompt("New description (empty = clear)", m.description || "");
                          if (next === null) return;
                          const clean = next.trim();
                          update(m, { description: clean ? clean : undefined }).catch(() => {});
                        }}
                        disabled={loading}
                        style={btn}
                      >
                        Edit Desc
                      </button>

                      <button onClick={() => removeMinistry(m.id)} disabled={loading} style={btnDanger}>
                        Delete
                      </button>

                      <button
                        onClick={() => toggleOpen(m.id)}
                        disabled={loading}
                        style={isOpen ? btnGold : btn}
                        title="VIP: Manage members"
                      >
                        {isOpen ? "Close Members" : "Manage Members"}
                      </button>
                      <Link href={profileHref(m.id)} style={{ textDecoration: "none" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(46, 204, 113, 0.14)", fontWeight: 950 }}>
                          🏷️ Profile
                        </span>
                      </Link>

                      <Link href={profileHref(m.id) + "#chat"} scroll style={{ textDecoration: "none" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(52, 152, 219, 0.14)", fontWeight: 950 }}>
                          💬 Chat
                        </span>
                      </Link>

                      <Link href={profileHref(m.id) + "/leader"} style={{ textDecoration: "none" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(155, 89, 182, 0.14)", fontWeight: 950 }}>
                          🛡️ Leader
                        </span>
                      </Link>

                      <Link href={profileHref(m.id) + "/member"} style={{ textDecoration: "none" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(241, 196, 15, 0.14)", fontWeight: 950 }}>
                          👤 Member
                        </span>
                      </Link>

                    </div>
                  </div>

                  <div style={{ opacity: 0.6, fontSize: 12, marginTop: 10 }}>ID: {m.id}</div>

                  {/* Members Panel */}
                  {isOpen ? (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                        <Link href={profileHref(m.id)} style={{ textDecoration: "none" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.20)", fontWeight: 900 }}>
                            🏷️ Open Ministry Profile
                          </span>
                        </Link>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 950, fontSize: 14 }}>👥 Ministry Members</div>
                          <div style={{ opacity: 0.78, marginTop: 4, fontSize: 12 }}>
                            API: <b>/api/church/ministry-members</b>
                          </div>
                          <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
                            Dropdown source: <b>/api/church/members</b> (Church Members)
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <button onClick={() => loadMembers(m.id)} disabled={mLoading} style={btnGold}>
                            {mLoading ? "Loading..." : "Refresh Members"}
                          </button>
                          <button onClick={loadChurchMembers} disabled={churchMembersLoading} style={btn}>
                            {churchMembersLoading ? "..." : "Refresh Church Members"}
                          </button>
                        </div>
                      </div>

                      {mErr ? (
                        <div style={{ marginTop: 10, color: "salmon", fontWeight: 900, whiteSpace: "pre-wrap" }}>
                          ⛔ {mErr}
                        </div>
                      ) : null}

                      {/* Add member (Dropdown) */}
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        <input
                          style={input}
                          placeholder="Search member (name / userId / roleLabel)..."
                          value={churchMemberSearchByMinistry[m.id] || ""}
                          onChange={(e) =>
                            setChurchMemberSearchByMinistry((cur) => ({ ...cur, [m.id]: e.target.value }))
                          }
                        />
                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 190px 160px" }}>
                          <select
                            style={select}
                            value={addUserId}
                            onChange={(e) => setAddUserIdByMinistry((cur) => ({ ...cur, [m.id]: e.target.value }))}
                          >
                            <option value="">
                              {churchMembersLoading
                                ? "Loading church members..."
                                : churchMembers.length
                                ? `Select member... (${filteredChurchMembers.length})`
                                : "No church members found (go to Church → Members)"}
                            </option>
                            {filteredChurchMembers.map((cm) => (
                              <option key={cm.id} value={cm.userId}>
                                {prettyMemberLabel(cm)}
                              </option>
                            ))}
                          </select>

                          <select
                            style={select}
                            value={addRole}
                            onChange={(e) =>
                              setAddRoleByMinistry((cur) => ({ ...cur, [m.id]: e.target.value as MinistryMemberRole }))
                            }
                          >
                            <option value="Member">Member</option>
                            <option value="Assistant">Assistant</option>
                            <option value="Leader">Leader</option>
                          </select>

                          <button
                            onClick={() => addMember(m.id)}
                            disabled={mLoading || !mMembers || !addUserId || alreadyInThisMinistry}
                            style={btnGold}
                            title={
                              !addUserId
                                ? "Chagua member kwanza"
                                : alreadyInThisMinistry
                                ? "Member tayari yupo"
                                : "Add member"
                            }
                          >
                            Add Member
                          </button>
                        </div>

                        <div style={{ opacity: 0.72, fontSize: 12, lineHeight: 1.5 }}>
                          Tip: Chagua member kwenye dropdown → chagua role → Add Member. (No copy/paste)
                        </div>

                        {alreadyInThisMinistry ? (
                          <div style={{ color: "khaki", fontWeight: 900, fontSize: 12 }}>
                            ⚠️ Member tayari yupo kwenye ministry hii.
                          </div>
                        ) : null}
                      </div>

                      {/* Members list */}
                      <div style={{ marginTop: 14 }}>
                        {!mMembers ? (
                          <div style={{ opacity: 0.8 }}>{mLoading ? "Loading..." : "Click Refresh Members"}</div>
                        ) : mMembers.length === 0 ? (
                          <div style={{ opacity: 0.82 }}>No members in this ministry yet.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 10 }}>
                            {(() => {
                            // cache helpers
                            const hasLeader = mMembers.some((x) => x.role === "Leader");
                            const hasAssistant = mMembers.some((x) => x.role === "Assistant");

                            return mMembers.map((mm) => {
                              const created = mm.createdAt ? new Date(mm.createdAt).toLocaleString() : "—";
                              const updated = mm.updatedAt ? new Date(mm.updatedAt).toLocaleString() : "";
                              const cm = churchMembers.find((x) => x.userId === mm.userId);
                              const label = cm ? `${cm.name} • ${mm.userId}` : mm.userId;

                              const disableAssistant = mm.role === "Assistant" ? true : hasAssistant;
                              const disableLeader = mm.role === "Leader" ? true : hasLeader;
                                                            return (
                                <div
                                  key={mm.id}
                                  style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    borderRadius: 14,
                                    padding: 12,
                                    background: "rgba(0,0,0,0.12)",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div style={{ minWidth: 260 }}>
                                    <div style={{ fontWeight: 950 }}>{label}</div>
                                    <div style={{ opacity: 0.8, marginTop: 6, fontSize: 12 }}>
                                      Role: <b>{mm.role}</b> • added {created}
                                      {updated ? ` • updated ${updated}` : ""}
                                    </div>
                                    <div style={{ opacity: 0.55, fontSize: 12, marginTop: 6 }}>ID: {mm.id}</div>
                                  </div>

                                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <button
                                      style={btn}
                                      disabled={mLoading || mm.role === "Member"}
                                      onClick={() => changeMemberRole(m.id, mm, "Member")}
                                      title={mm.role === "Member" ? "Already Member" : "Set role to Member"}
                                    >
                                      Make Member
                                    </button>

                                    <button
                                      style={btn}
                                      disabled={mLoading || disableAssistant}
                                      onClick={() => changeMemberRole(m.id, mm, "Assistant")}
                                      title={
                                        mm.role === "Assistant"
                                          ? "Already Assistant"
                                          : disableAssistant
                                          ? "Assistant already exists in this ministry"
                                          : "Set role to Assistant"
                                      }
                                    >
                                      Make Assistant
                                    </button>

                                    <button
                                      style={btn}
                                      disabled={mLoading || disableLeader}
                                      onClick={() => changeMemberRole(m.id, mm, "Leader")}
                                      title={
                                        mm.role === "Leader"
                                          ? "Already Leader"
                                          : disableLeader
                                          ? "Leader already exists in this ministry"
                                          : "Set role to Leader"
                                      }
                                    >
                                      Make Leader
                                    </button>

                                    <button
                                      style={btnDanger}
                                      disabled={mLoading}
                                      onClick={() => removeMember(m.id, mm)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
