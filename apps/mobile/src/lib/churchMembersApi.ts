import { getSessionSync } from "./kristoSession";
import { getApiBase } from "./kristoApi";
import { buildKristoRequestHeaders } from "./kristoHeaders";
import { resolveActiveChurchFromProfileResponse } from "./churchMembershipSync";
import { resolvePlatformRoleFromAuthPayload } from "./platformRole";
import { clearResponseCacheForRequest } from "./kristoTraffic";
import {
  emitChurchInviteAccepted,
  emitChurchInviteSent,
  emitChurchMembershipChanged,
} from "./kristoChurchInviteEvents";
import { approveJoinRequest, deactivateChurchMember, getChurchJoinRequests, getChurchMembers, rejectJoinRequest } from "@/src/lib/churchRequestsStore";

export function isPendingJoinRequestRow(row: any): boolean {
  const status = String(row?.status || "").trim().toLowerCase();
  const isRequestStatus = status === "requested" || status === "pending" || status === "request";
  if (!isRequestStatus) return false;
  return String(row?.requestSource || "JoinRequest") !== "ChurchInvite";
}

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

function headers(path = "/api/church/members") {
  const { churchId, userId, role } = getAuthBits();
  const session = getSessionSync();
  return buildKristoRequestHeaders(
    path,
    {
      userId,
      role: role as any,
      churchId,
      sessionToken: session?.sessionToken,
    },
    {
      accept: "application/json",
      "content-type": "application/json",
    },
    "churchMembersApi"
  );
}

// =====================
// FETCH MEMBERS
// =====================
export async function fetchChurchMembers() {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) return getChurchMembers(getAuthBits().churchId);

  const h = headers("/api/church/members");
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
  const { churchId, userId, role } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) return getChurchJoinRequests(churchId);

  const r = await fetch(`${base}/api/church/join-requests`, {
    headers: headers("/api/church/join-requests"),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    console.log("KRISTO_JOIN_REQUESTS_FETCH_FAIL", {
      membersScreenChurchId: churchId,
      userId,
      role,
      status: r.status,
      error: j?.error || null,
    });
    throw new Error(String(j?.error || "Failed to fetch requests"));
  }

  const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];
  console.log("KRISTO_JOIN_REQUESTS_FETCH_OK", {
    membersScreenChurchId: churchId,
    responseChurchId: String(j?.churchId || churchId || ""),
    count: raw.length,
  });
  return raw;
}

// =====================
// APPROVE / REJECT
// =====================
export async function approveRequest(requestId: string) {
  const base = getBase();
  if (!base) return approveJoinRequest(requestId);

  const r = await fetch(`${base}/api/church/join-requests`, {
    method: "PATCH",
    headers: headers("/api/church/join-requests"),
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
    headers: headers("/api/church/join-requests"),
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

  const { churchId } = getAuthBits();
  emitChurchInviteSent({
    targetKristoId: privateKristoId,
    churchId,
    role,
  });

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

  const { churchId, userId } = getAuthBits();
  const membership = j?.data || j?.membership || j;
  const payload = {
    userId,
    churchId: String(membership?.churchId || churchId || ""),
    role: String(membership?.churchRole || membership?.role || ""),
    membershipId: String(membership?.id || membershipId || ""),
  };

  if (action === "accept") {
    emitChurchInviteAccepted({
      ...payload,
      targetUserId: userId,
    });
  } else {
    emitChurchMembershipChanged({
      ...payload,
      action: "rejected",
    });
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
    headers: headers("/api/church/join-requests"),
    body: JSON.stringify({ churchId, name }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Request failed"));
  }

  return j?.data || j?.membership || j;
}

export async function cancelJoinRequest(opts?: { requestId?: string; churchId?: string }) {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) throw new Error("API base missing");

  const r = await fetch(`${base}/api/church/join-requests`, {
    method: "PATCH",
    headers: headers("/api/church/join-requests"),
    body: JSON.stringify({
      action: "cancel",
      requestId: String(opts?.requestId || "").trim() || undefined,
      churchId: String(opts?.churchId || "").trim() || undefined,
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Could not cancel request"));
  }

  return j?.data || j?.membership || j;
}

export async function fetchMyActiveChurchMembership() {
  const base = getBase();
  const { userId } = getAuthBits();

  if (!userId) throw new Error("userId missing");
  if (!base) throw new Error("API base missing");

  clearResponseCacheForRequest("GET", "/api/auth/profile", userId);

  const session = getSessionSync();
  const r = await fetch(`${base}/api/auth/profile`, {
    headers: buildKristoRequestHeaders(
      "/api/auth/profile",
      {
        userId,
        role: "Member",
        churchId: "",
        sessionToken: session?.sessionToken,
      },
      { accept: "application/json" },
      "churchMembersApi.profile"
    ),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Failed to refresh profile"));
  }

  const resolved = resolveActiveChurchFromProfileResponse(j);

  return {
    profile: j.profile,
    membership: resolved.churchId ? j.activeMembership || resolved.membership : null,
    churchId: resolved.churchId,
    role: resolved.churchId ? resolved.role : "Member",
    platformRole: resolvePlatformRoleFromAuthPayload(j),
  };
}


export async function removeChurchMember(
  target: string | { userId?: string; membershipId?: string }
) {
  const targetUserId = typeof target === "string" ? String(target || "").trim() : String(target?.userId || "").trim();
  const membershipId = typeof target === "object" ? String(target?.membershipId || "").trim() : "";
  const base = getBase();
  const { churchId, role } = getAuthBits();

  if (!base) {
    return deactivateChurchMember(membershipId || targetUserId);
  }

  const url = `${base}/api/church/members`;
  const method = "PATCH";
  const requestBody = {
    userId: targetUserId,
    membershipId: membershipId || undefined,
    action: "deactivate",
  };

  console.log("[ChurchMembersRemove] request", {
    targetUserId,
    membershipId: membershipId || undefined,
    churchId,
    role,
    url,
    method,
  });

  const r = await fetch(url, {
    method,
    headers: headers(),
    body: JSON.stringify(requestBody),
  });

  const j = await r.json().catch(() => ({} as any));

  console.log("[ChurchMembersRemove] response", {
    status: r.status,
    ok: Boolean(r.ok && j?.ok),
    body: j,
  });

  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || "Remove failed"));
  }

  const removedUserId = String(j?.data?.userId || targetUserId || "").trim();
  emitChurchMembershipChanged({
    targetUserId: removedUserId,
    churchId,
    membershipId: String(j?.data?.id || membershipId || ""),
    action: "changed",
  });

  return j;
}
