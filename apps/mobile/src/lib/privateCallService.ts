import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { fetchLiveKitToken } from "@/src/lib/liveKitTokenPrefetch";
import {
  fetchChurchPastorProfile,
  logChurchPastorResolution,
} from "@/src/lib/churchPastorResolver";
import { isPrivateCallApiUnavailable, sanitizePrivateCallApiFailure } from "@/src/lib/privateCallApiError";

const PRIVATE_CALL_API_PATH = "/api/church/private-call";

export type PrivateCallSession = {
  id: string;
  churchId: string;
  roomName: string;
  callerUserId: string;
  callerName: string;
  callerAvatarUrl?: string;
  pastorUserId: string;
  pastorName: string;
  pastorAvatarUrl?: string;
  pastorSourceField: string;
  status: "ringing" | "accepted" | "declined" | "ended" | "timeout" | "failed";
  createdAt: string;
  updatedAt: string;
  ringExpiresAt: string;
  acceptedAt?: string;
  endedAt?: string;
  endedReason?: string;
};

export type StartPastorPrivateCallResult =
  | { ok: true; session: PrivateCallSession }
  | { ok: false; code: string; message: string };

function authHeaders() {
  return {
    ...getKristoHeaders(),
    accept: "application/json",
    "content-type": "application/json",
  } as Record<string, string>;
}

export async function fetchPrivateCallSession(callId: string): Promise<PrivateCallSession | null> {
  const id = String(callId || "").trim();
  if (!id) return null;
  const res: any = await apiGet(
    `${PRIVATE_CALL_API_PATH}?callId=${encodeURIComponent(id)}`,
    {
    headers: authHeaders(),
    cache: "no-store" as RequestCache,
    }
  );
  if (isPrivateCallApiUnavailable(res, Number(res?.status || 0) || undefined)) {
    return null;
  }
  return res?.ok && res?.data ? (res.data as PrivateCallSession) : null;
}

export async function fetchIncomingPrivateCalls(): Promise<PrivateCallSession[]> {
  const res: any = await apiGet(`${PRIVATE_CALL_API_PATH}?incoming=1`, {
    headers: authHeaders(),
    cache: "no-store" as RequestCache,
  });
  if (isPrivateCallApiUnavailable(res, Number(res?.status || 0) || undefined)) {
    return [];
  }
  if (!res?.ok || !Array.isArray(res?.data)) return [];
  return res.data as PrivateCallSession[];
}

export async function createPastorPrivateCall(): Promise<StartPastorPrivateCallResult> {
  const res: any = await apiPost(PRIVATE_CALL_API_PATH, {}, { headers: authHeaders() });
  if (res?.ok && res?.data?.id) {
    return { ok: true, session: res.data as PrivateCallSession };
  }

  const failure = sanitizePrivateCallApiFailure(res, PRIVATE_CALL_API_PATH);
  return {
    ok: false,
    code: failure.code,
    message: failure.message,
  };
}

export async function acceptPrivateCall(callId: string) {
  return apiPatch(
    PRIVATE_CALL_API_PATH,
    { callId, action: "accept" },
    { headers: authHeaders() }
  );
}

export async function declinePrivateCall(callId: string) {
  return apiPatch(
    PRIVATE_CALL_API_PATH,
    { callId, action: "decline" },
    { headers: authHeaders() }
  );
}

export async function endPrivateCall(callId: string) {
  return apiPatch(
    PRIVATE_CALL_API_PATH,
    { callId, action: "end" },
    { headers: authHeaders() }
  );
}

export async function fetchPrivateCallLiveKitCredentials(input: {
  roomName: string;
  identity: string;
}) {
  const headers = {
    ...authHeaders(),
    "x-kristo-live-may-publish": "1",
    "x-kristo-role": "Host",
  };

  return fetchLiveKitToken({
    roomName: input.roomName,
    identity: input.identity,
    canPublish: true,
    headers,
    source: "private-call",
  });
}

export async function resolvePastorForMyWayCall(input: {
  churchId: string;
  currentUserId: string;
}) {
  const churchId = String(input.churchId || "").trim();
  const currentUserId = String(input.currentUserId || "").trim();

  console.log("KRISTO_MY_WAY_PASTOR_CALL_COMMAND", {
    churchId,
    currentUserId,
    code: "CRPT9",
  });

  if (!churchId) {
    console.log("KRISTO_MY_WAY_PASTOR_RESOLVE_FAILED", {
      churchId,
      currentUserId,
      reason: "missing-church-membership",
    });
    return {
      ok: false as const,
      message: "Join a church before calling your pastor.",
    };
  }

  const pastor = await fetchChurchPastorProfile(churchId, authHeaders());
  logChurchPastorResolution({
    churchId,
    actualChurchPastorUserId: pastor.actualChurchPastorUserId,
    sourceField: pastor.sourceField,
    currentUserId,
  });

  if (!pastor.actualChurchPastorUserId) {
    console.log("KRISTO_MY_WAY_PASTOR_RESOLVE_FAILED", {
      churchId,
      currentUserId,
      reason: "no-pastor",
    });
    return {
      ok: false as const,
      message: "Your church pastor is not available for calling right now.",
    };
  }

  if (pastor.actualChurchPastorUserId === currentUserId) {
    console.log("KRISTO_MY_WAY_PASTOR_RESOLVE_FAILED", {
      churchId,
      currentUserId,
      reason: "self-is-pastor",
      pastorUserId: pastor.actualChurchPastorUserId,
    });
    return {
      ok: false as const,
      message: "You are the church pastor. Use MY WAY to reach members another way.",
    };
  }

  console.log("KRISTO_MY_WAY_PASTOR_RESOLVED", {
    churchId,
    currentUserId,
    pastorUserId: pastor.actualChurchPastorUserId,
    pastorName: pastor.pastorName,
    sourceField: pastor.sourceField,
  });

  return { ok: true as const, pastor };
}

export async function startMyWayPastorPrivateCall(input: {
  churchId: string;
  currentUserId: string;
}): Promise<StartPastorPrivateCallResult> {
  const resolved = await resolvePastorForMyWayCall(input);
  if (!resolved.ok) {
    return { ok: false, code: "resolve_failed", message: resolved.message };
  }

  return createPastorPrivateCall();
}
