import { getSessionSync } from "@/src/lib/kristoSession";
import { getApiBase } from "@/src/lib/kristoApi";
import { approveJoinRequest, deactivateChurchMember, getChurchJoinRequests, getChurchMembers, rejectJoinRequest } from "@/src/lib/churchRequestsStore";

function getBase() {
  return getApiBase();
}

function getAuthBits() {
  const auth = getSessionSync();

  const churchId = String(auth?.churchId || "");
  const userId = String(auth?.userId || "");
  const role = String(auth?.role || "Member");

  return { churchId, userId, role };
}

function headers() {
  const { churchId, userId, role } = getAuthBits();
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-kristo-user-id": userId,
    "x-kristo-role": role,
    "x-kristo-church-id": churchId,
  };
}

// =====================
// FETCH MEMBERS
// =====================
export async function fetchChurchMembers() {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) return getChurchMembers(getAuthBits().churchId);

  const h = headers();
  const r = await fetch(`${base}/api/church/members`, {
    headers: h,
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Failed to fetch members"));
  }

  return Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];
}

// =====================
// FETCH REQUESTS
// =====================
export async function fetchJoinRequests() {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) return getChurchJoinRequests(getAuthBits().churchId);

  const r = await fetch(`${base}/api/church/join-requests`, {
    headers: headers(),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Failed to fetch requests"));
  }

  return Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];
}

// =====================
// APPROVE / REJECT
// =====================
export async function approveRequest(requestId: string) {
  const base = getBase();
  if (!base) return approveJoinRequest(requestId);

  const r = await fetch(`${base}/api/church/join-requests`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({
      requestId,
      action: "approve",
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Approve failed"));
  }

  return j;
}

export async function rejectRequest(requestId: string) {
  const base = getBase();
  if (!base) return rejectJoinRequest(requestId);

  const r = await fetch(`${base}/api/church/join-requests`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({
      requestId,
      action: "reject",
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Reject failed"));
  }

  return j;
}


export async function sendChurchInvite(targetUserId: string, role: "Member" | "Leader") {
  const base = getBase();
  const privateKristoId = String(targetUserId || "").trim().toUpperCase();

  if (!base) throw new Error("API base missing");

  const isValidKristoId =
    /^KR7-[A-Z0-9]{6,10}$/.test(privateKristoId) || /^U-DEMO-\d+$/i.test(privateKristoId);

  if (!isValidKristoId) {
    throw new Error("Use a valid Kristo ID like KR7-25023WY.");
  }

  const request = fetch(`${base}/api/church/invites`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      targetUserId: privateKristoId,
      role,
    }),
  });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("This Kristo ID was not found or the server took too long.")), 8000);
  });

  const r = await Promise.race([request, timeout]);
  const j = await r.json().catch(() => ({} as any));

  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "This Kristo ID was not found."));
  }

  return j;
}


export async function handleInviteAction(membershipId: string, action: "accept" | "reject") {
  const base = getBase();

  const r = await fetch(`${base}/api/church/invites/action`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ membershipId, action }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(j?.error || "Action failed");
  }

  return j;
}

export async function requestJoinChurch(churchId: string, name?: string) {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) throw new Error("API base missing");

  const r = await fetch(`${base}/api/church/join-requests`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ churchId, name }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Request failed"));
  }

  return j?.data || j?.membership || j;
}

export async function fetchMyActiveChurchMembership() {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) throw new Error("API base missing");

  const r = await fetch(`${base}/api/auth/profile`, {
    headers: {
      accept: "application/json",
      "x-kristo-user-id": userId,
      "x-kristo-role": getAuthBits().role,
      "x-kristo-church-id": getAuthBits().churchId,
    },
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Failed to refresh profile"));
  }

  return {
    profile: j.profile,
    membership: j.activeMembership || null,
    churchId: String(j.churchId || j.activeMembership?.churchId || ""),
    role: String(j.role || j.churchRole || j.activeMembership?.churchRole || "Member"),
  };
}


export async function removeChurchMember(userId: string) {
  const base = getBase();

  if (!base) {
    return deactivateChurchMember(userId);
  }

  const r = await fetch(`${base}/api/church/members`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({
      userId,
      action: "deactivate",
    }),
  });

  const j = await r.json().catch(() => ({} as any));

  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Remove failed"));
  }

  return j;
}
