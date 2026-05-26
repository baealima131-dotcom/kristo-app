"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const DEV_USER_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_USER_ID || "";
const DEV_ROLE = process.env.NEXT_PUBLIC_KRISTO_DEV_ROLE || "";
const DEV_CHURCH_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_CHURCH_ID || "";

type ChurchMember = {
  membershipId: string;
  churchId: string;
  userId: string;
  name: string;
  roleLabel?: string;
  joinedAt: string;
  updatedAt?: string;
};

type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: "Active" | "Paused";
  churchId: string;
  createdAt: string;
  updatedAt?: string;
};

type MinistryMemberRole = "Member" | "Assistant" | "Leader";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: unknown };
type ApiRes<T> = ApiOk<T> | ApiErr;

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

function explainAuthProblem(status: number, msg: string) {
  if (status === 401) {
    return (
      msg ||
      "Unauthorized. Login (Clerk) au tumia KRISTO_DEV_* kwenye .env.local kisha restart. Uki-test kwa headers, weka kristo_dev_header_auth=1."
    );
  }
  if (status === 403) {
    return (
      msg ||
      "Forbidden. Role/church scope haikuruhusu (unahitaji Pastor/Church_Admin/Leader)."
    );
  }
  if (status === 409) {
    return (
      msg ||
      "Conflict. This action is not allowed. Tip: each ministry must keep exactly one Senior Leader (Leader) and one Junior Assistant (Assistant)."
    );
  }
  return msg || "Request failed.";
}

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

export default function ChurchMembersPage() {
  const sp = useSearchParams();

  const [members, setMembers] = useState<ChurchMember[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");

  // add-to-ministry form
  const [pickedUserId, setPickedUserId] = useState<string>("");
  const [pickedMinistryId, setPickedMinistryId] = useState<string>("");
  const [pickedRole, setPickedRole] = useState<MinistryMemberRole>("Member");
  const [actionMsg, setActionMsg] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = String(sp.get("devHeaderAuth") || "").trim();
      if (v === "1" || v === "0") localStorage.setItem("kristo_dev_header_auth", v);
    } catch {}
  }, [sp]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!localStorage.getItem("kristo_dev_header_auth")) localStorage.setItem("kristo_dev_header_auth", "0");
      if (DEV_USER_ID && !localStorage.getItem("kristo_dev_user_id")) localStorage.setItem("kristo_dev_user_id", DEV_USER_ID);
      if (DEV_ROLE && !localStorage.getItem("kristo_dev_role")) localStorage.setItem("kristo_dev_role", DEV_ROLE);
      if (DEV_CHURCH_ID && !localStorage.getItem("kristo_dev_church_id")) localStorage.setItem("kristo_dev_church_id", DEV_CHURCH_ID);
    } catch {}
  }, []);

  async function setChurchRole(userId: string, role: "Member" | "Leader" | "Church_Admin" | "Pastor") {
    setActionMsg("");
    setError("");
    try {
      setLoading(true);

      const res = await fetch(`/api/church/memberships/role`, {
        method: "POST",
        credentials: "include",
        headers: { ...devHeaders(), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ userId, role }),
      });

      const json = await readApi<any>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        throw new Error(explainAuthProblem(res.status, msg || `Failed (HTTP ${res.status})`));
      }

      setActionMsg(`✅ Role updated: ${userId} → ${role}`);
      setTimeout(() => setActionMsg(""), 1200);

      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Failed to set role");
    } finally {
      setLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    setActionMsg("");
    try {
      const headers = { ...devHeaders(), accept: "application/json" };

      const [mr, minr] = await Promise.all([
        fetch("/api/church/members", { cache: "no-store", credentials: "include", headers }),
        fetch("/api/church/ministries", { cache: "no-store", credentials: "include", headers }),
      ]);

      const mj = await readApi<ChurchMember[]>(mr);
      if (!mr.ok || !okJson(mj)) {
        const msg = mj && !okJson(mj) ? (mj as ApiErr).error : "";
        setError(explainAuthProblem(mr.status, msg || "Failed to load members"));
        setMembers([]);
        setMinistries([]);
        return;
      }

      const minj = await readApi<Ministry[]>(minr);
      if (!minr.ok || !okJson(minj)) {
        const msg = minj && !okJson(minj) ? (minj as ApiErr).error : "";
        setError(explainAuthProblem(minr.status, msg || "Failed to load ministries"));
        setMembers(Array.isArray(mj.data) ? mj.data : []);
        setMinistries([]);
        return;
      }

      setMembers(Array.isArray(mj.data) ? mj.data : []);
      const mins = Array.isArray(minj.data) ? minj.data : [];
      mins.sort((a, b) => {
        if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      setMinistries(mins);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return members;
    return members.filter((m) => {
      return (
        (m.name || "").toLowerCase().includes(s) ||
        (m.userId || "").toLowerCase().includes(s) ||
        (m.roleLabel || "").toLowerCase().includes(s)
      );
    });
  }, [members, q]);

  async function alreadyInMinistry(ministryId: string, userId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`, {
        cache: "no-store",
        credentials: "include",
        headers: { ...devHeaders(), accept: "application/json" },
      });
      const json = await readApi<any[]>(res);
      if (!res.ok || !okJson(json)) return false;
      const list = Array.isArray(json.data) ? json.data : [];
      return list.some((mm: any) => String(mm.userId || "").trim() === userId);
    } catch {
      return false;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setActionMsg("✅ Copied to clipboard");
      setTimeout(() => setActionMsg(""), 900);
    } catch {
      setActionMsg("⚠️ Copy failed (browser permissions).");
      setTimeout(() => setActionMsg(""), 1200);
    }
  }

  async function addToMinistry() {
    const userId = pickedUserId.trim();
    const ministryId = pickedMinistryId.trim();
    if (!userId) return setActionMsg("⛔ Chagua member kwanza (userId).");
    if (!ministryId) return setActionMsg("⛔ Chagua ministry kwanza.");

    setLoading(true);
    setError("");
    setActionMsg("");

    try {
      const exists = await alreadyInMinistry(ministryId, userId);
      if (exists) {
        setActionMsg("⚠️ Member tayari yupo kwenye ministry hii.");
        return;
      }

      const res = await fetch("/api/church/ministry-members", {
        method: "POST",
        credentials: "include",
        headers: { ...devHeaders(), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ministryId, userId, role: pickedRole }),
      });

      const json = await readApi<any>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || "Failed to add member to ministry"));
        return;
      }

      setActionMsg("✅ Added to ministry!");
      await loadAll();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const shellWrap: React.CSSProperties = { padding: 20, maxWidth: 1100 };
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
          <h1 style={{ margin: 0 }}>👤 Church Members</h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            API: <b>/api/church/members</b> • Ministries: <b>/api/church/ministries</b>
          </div>
          <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
            Purpose: pata userId bila copy/paste random — halafu “Add to Ministry” hapa.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={loadAll} disabled={loading} style={btnGold}>
            {loading ? "Working..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, color: "salmon", fontWeight: 900, whiteSpace: "pre-wrap" }}>⛔ {error}</div>
      ) : null}

      {actionMsg ? (
        <div style={{ marginTop: 10, opacity: 0.92, fontWeight: 900, whiteSpace: "pre-wrap" }}>{actionMsg}</div>
      ) : null}

      <div style={{ ...glass, marginTop: 16, padding: 14 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 220px" }}>
          <input
            placeholder="Search name / userId / roleLabel..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={input}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btn} onClick={() => setQ("")} disabled={loading}>
              Clear
            </button>
            <button style={btnGold} onClick={loadAll} disabled={loading}>
              Reload
            </button>
          </div>
        </div>
      </div>

      <div style={{ ...glass, marginTop: 14, padding: 14 }}>
        <div style={{ fontWeight: 950, marginBottom: 10 }}>➕ Add selected member to a ministry</div>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 200px 180px" }}>
          <input style={input} value={pickedUserId} readOnly placeholder="Pick a member below (userId)..." />
          <select style={select} value={pickedMinistryId} onChange={(e) => setPickedMinistryId(e.target.value)}>
            <option value="">Select ministry...</option>
            {ministries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.status})
              </option>
            ))}
          </select>
          <select style={select} value={pickedRole} onChange={(e) => setPickedRole(e.target.value as MinistryMemberRole)}>
            <option value="Member">Member</option>
            <option value="Assistant">Assistant (Junior)</option>
            <option value="Leader">Leader (Senior)</option>
          </select>
          <button style={btnGold} onClick={addToMinistry} disabled={loading || !pickedUserId.trim() || !pickedMinistryId.trim()}>
            Add
          </button>
        </div>

        <div style={{ opacity: 0.72, fontSize: 12, marginTop: 10 }}>
          Tip: chagua member chini → itajaza userId juu → chagua ministry + role → Add.
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 10 }}>List ({filtered.length})</h3>

        {filtered.length === 0 ? (
          <div style={{ opacity: 0.8 }}>{loading ? "Loading..." : "No members yet (use /api/church/members?action=self_join or admin add)"}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((m) => (
              <div key={m.membershipId + "-" + m.userId} style={{ ...glass, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 320 }}>
                    <div style={{ fontWeight: 950, fontSize: 16 }}>{m.name}</div>
                    <div style={{ opacity: 0.8, marginTop: 6, fontSize: 12 }}>
                      userId: <b>{m.userId}</b> • roleLabel: <b>{m.roleLabel || "—"}</b>
                    </div>
                    <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>
                      joined {new Date(m.joinedAt).toLocaleString()}
                      {m.updatedAt ? ` • updated ${new Date(m.updatedAt).toLocaleString()}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      style={btn}
                      onClick={() => {
                        setPickedUserId(m.userId);
                        setActionMsg(`✅ Selected: ${m.userId}`);
                        setTimeout(() => setActionMsg(""), 900);
                      }}
                    >
                      Select
                    </button>

                    <button style={btn} onClick={() => copy(m.userId)}>Copy userId</button>

                    <button style={btn} onClick={() => setChurchRole(m.userId, "Member")} disabled={loading}>
                      Make Member
                    </button>
                    <button style={btn} onClick={() => setChurchRole(m.userId, "Leader")} disabled={loading}>
                      Make Leader
                    </button>
                    <button style={btn} onClick={() => setChurchRole(m.userId, "Church_Admin")} disabled={loading}>
                      Make Admin
                    </button>
                    <button style={btn} onClick={() => setChurchRole(m.userId, "Pastor")} disabled={loading}>
                      Make Pastor
                    </button>
                  </div>
                </div>

                <div style={{ opacity: 0.55, fontSize: 12, marginTop: 10 }}>ID: {m.membershipId}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
