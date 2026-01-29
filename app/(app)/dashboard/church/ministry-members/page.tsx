"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/* =========================
   TYPES
   ========================= */

type MinistryMemberRole = "Member" | "Leader";

type MinistryMember = {
  id: string;
  ministryId: string;
  churchId: string;
  userId: string;
  name: string;
  role: MinistryMemberRole;
  joinedAt: string;
};

type ChurchMember = {
  id: string;
  churchId: string;
  userId: string;
  name: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiRes<T> = ApiOk<T> | { ok: false; error: string };

/* =========================
   PAGE
   ========================= */

export default function MinistryMembersPage() {
  const sp = useSearchParams();
  const urlMinistryId = (sp.get("ministryId") || "").trim();

  const [ministryId, setMinistryId] = useState("");
  const [members, setMembers] = useState<MinistryMember[]>([]);
  const [churchMembers, setChurchMembers] = useState<ChurchMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState<MinistryMemberRole>("Member");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* =========================
     LOADERS
     ========================= */

  useEffect(() => {
    if (urlMinistryId) setMinistryId(urlMinistryId);
  }, [urlMinistryId]);

  useEffect(() => {
    loadChurchMembers();
  }, []);

  useEffect(() => {
    if (ministryId) loadMembers();
    else setMembers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId]);

  async function loadChurchMembers() {
    try {
      const res = await fetch("/api/church/members", { cache: "no-store" });
      const json = (await res.json()) as ApiRes<ChurchMember[]>;
      if (res.ok && json.ok) setChurchMembers(json.data);
    } catch {}
  }

  async function loadMembers() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`);
      const json = (await res.json()) as ApiRes<MinistryMember[]>;

      if (!res.ok || !json.ok) {
        setError("Failed to load members");
        setMembers([]);
        return;
      }

      setMembers(json.data);
    } catch {
      setError("Network error");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  async function addMember() {
    if (!ministryId || !selectedUserId) {
      alert("Chagua member");
      return;
    }

    const cm = churchMembers.find((m) => m.userId === selectedUserId);
    if (!cm) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/church/ministry-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ministryId,
          userId: cm.userId,
          name: cm.name,
          role,
        }),
      });

      const json = (await res.json()) as ApiRes<MinistryMember>;
      if (!res.ok || !json.ok) {
        setError("Failed to add member");
        return;
      }

      setSelectedUserId("");
      await loadMembers();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function setRoleOf(memberId: string, next: MinistryMemberRole) {
    setLoading(true);
    try {
      await fetch(`/api/church/ministry-members?id=${memberId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      await loadMembers();
    } finally {
      setLoading(false);
    }
  }

  async function removeMember(id: string) {
    if (!confirm("Ondoa member huyu?")) return;
    setLoading(true);
    try {
      await fetch(`/api/church/ministry-members?id=${id}`, { method: "DELETE" });
      await loadMembers();
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     UI
     ========================= */

  return (
    <div style={{ padding: 20, maxWidth: 800 }}>
      <h1>👥 Ministry Members</h1>

      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Ministry ID"
          value={ministryId}
          onChange={(e) => setMinistryId(e.target.value)}
          style={{ padding: 10, borderRadius: 10, minWidth: 300 }}
        />
      </div>

      {error && <div style={{ color: "red", marginBottom: 10 }}>{error}</div>}

      <h3>Add from Church Members</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          style={{ padding: 10, borderRadius: 10, minWidth: 260 }}
        >
          <option value="">-- Select member --</option>
          {churchMembers.map((m) => (
            <option key={m.id} value={m.userId}>
              {m.name} ({m.userId})
            </option>
          ))}
        </select>

        <select value={role} onChange={(e) => setRole(e.target.value as MinistryMemberRole)} style={{ padding: 10 }}>
          <option value="Member">Member</option>
          <option value="Leader">Leader</option>
        </select>

        <button onClick={addMember} disabled={loading}>
          ➕ Add
        </button>
      </div>

      <h3>Members List</h3>
      {members.length === 0 ? (
        <div>No members</div>
      ) : (
        <ul style={{ display: "grid", gap: 8 }}>
          {members.map((m) => {
            const isLeader = m.role === "Leader";
            return (
              <li key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <b>{m.name}</b> — {m.role}
                <button onClick={() => setRoleOf(m.id, isLeader ? "Member" : "Leader")} disabled={loading}>
                  {isLeader ? "Remove Leader" : "Make Leader"}
                </button>
                <button onClick={() => removeMember(m.id)} disabled={loading}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
