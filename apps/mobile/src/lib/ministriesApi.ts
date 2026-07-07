import { getSessionSync } from "@/src/lib/kristoSession";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export type MinistryItem = {
  id: string;
  name: string;
  description?: string;
  churchId?: string;
  memberCount?: number;
  avatarUri?: string;
  mediaAccess?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function getBase() {
  return String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
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

export async function fetchMinistries(): Promise<MinistryItem[]> {
  const base = getBase();
  const { userId, churchId } = getAuthBits();
  if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
  if (!userId) throw new Error("userId missing");
  if (!churchId) return [];

  const r = await fetch(`${base}/api/church/ministries`, {
    headers: headers(),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    const msg = String(j?.error || `Request failed (${r.status})`);
    if (msg.toLowerCase().includes("no active church membership")) return [];
    throw new Error(msg);
  }

  const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];
  return raw.map((x: any) => ({
    id: String(x?.id || ""),
    name: String(x?.name || "Ministry"),
    description: String(x?.description || ""),
    avatarUri: String(
      x?.avatarUri ||
      x?.avatarUrl ||
      x?.ministryAvatarUrl ||
      x?.profileImage ||
      x?.profilePhoto ||
      x?.photo ||
      x?.image ||
      x?.avatar ||
      ""
    ),
    churchId: String(x?.churchId || ""),
    memberCount: Number(x?.memberCount ?? x?.membersCount ?? x?.ministryMembersCount ?? 0),
    mediaAccess: x?.mediaAccess === true,
    createdAt: String(x?.createdAt || ""),
    updatedAt: String(x?.updatedAt || ""),
  }));
}

export async function fetchMinistryById(ministryId: string): Promise<MinistryItem | null> {
  const list = await fetchMinistries();
  return list.find((x) => x.id === ministryId) || null;
}

export type MinistryAvatarUploadResult = {
  ok: boolean;
  url: string;
  avatar: string;
  avatarUri: string;
  ministryAvatarUrl: string;
  source: "ministries-upload" | "room-attachments-fallback";
  error?: string;
};

function normalizeMinistryAvatarUploadUrl(raw: unknown): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("file://")) return v;
  const base = getBase();
  if (base && v.startsWith("/")) return `${base}${v}`;
  return v;
}

function pickUploadedMinistryAvatarUrl(payload: any): string {
  const data = payload?.data || {};
  return normalizeMinistryAvatarUploadUrl(
    data.url || data.avatarUri || data.ministryAvatarUrl || data.avatar || data.avatarUrl
  );
}

function buildMinistryAvatarForm(input: {
  localUri: string;
  fileName: string;
  mimeType: string;
  ministryId?: string;
}) {
  const form = new FormData();
  form.append("file", {
    uri: input.localUri,
    name: input.fileName,
    type: input.mimeType,
  } as any);
  if (input.ministryId) form.append("ministryId", input.ministryId);
  return form;
}

type MinistryAvatarUploadHttpResult = {
  ok: boolean;
  status: number;
  error: string;
  body: any;
};

async function postMinistryAvatarMultipart(
  path: string,
  form: FormData,
  authHeaders: Record<string, string>
): Promise<MinistryAvatarUploadHttpResult> {
  const base = getBase();
  if (!base) {
    return { ok: false, status: 0, error: "EXPO_PUBLIC_API_BASE missing", body: null };
  }

  const auth = getKristoHeaders({
    userId: String(authHeaders["x-kristo-user-id"] || "").trim() || undefined,
    role: (String(authHeaders["x-kristo-role"] || "").trim() || undefined) as any,
    churchId: String(authHeaders["x-kristo-church-id"] || "").trim() || undefined,
  });

  const headers: Record<string, string> = {
    ...auth,
    accept: "application/json",
  };

  try {
    const res = await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
      method: "POST",
      headers,
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    const url = pickUploadedMinistryAvatarUrl(body);
    const providerError = String(body?.error || body?.message || "").trim();
    const httpOk = res.ok && url.length > 0;
    return {
      ok: httpOk,
      status: res.status,
      error: providerError || (httpOk ? "" : `Request failed (${res.status})`),
      body,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      error: String((error as any)?.message || error || "Network request failed"),
      body: null,
    };
  }
}

function needsMinistryAvatarUploadFallback(result: MinistryAvatarUploadHttpResult): boolean {
  if (result.ok) return false;
  const status = Number(result.status || 0);
  if (status === 404 || status === 405) return true;
  const error = String(result.error || result.body?.error || result.body?.message || "").toLowerCase();
  if (error.includes("not found") || error.includes("server action")) return true;
  return true;
}

export async function uploadMinistryAvatar(input: {
  localUri: string;
  fileName: string;
  mimeType: string;
  ministryId?: string;
  headers?: Record<string, string>;
}): Promise<MinistryAvatarUploadResult> {
  const authHeaders = input.headers || headers();
  const empty: MinistryAvatarUploadResult = {
    ok: false,
    url: "",
    avatar: "",
    avatarUri: "",
    ministryAvatarUrl: "",
    source: "ministries-upload",
  };

  console.log("KRISTO_MINISTRY_AVATAR_UPLOAD_START", {
    ministryId: String(input.ministryId || ""),
  });

  const primary = await postMinistryAvatarMultipart(
    "/api/church/ministries/upload",
    buildMinistryAvatarForm(input),
    authHeaders
  );

  let result = primary;
  let source: MinistryAvatarUploadResult["source"] = "ministries-upload";

  if (needsMinistryAvatarUploadFallback(primary)) {
    console.log("KRISTO_MINISTRY_AVATAR_UPLOAD_FALLBACK", {
      reason: "ministries-upload-missing",
      status: primary.status,
      error: primary.error,
    });
    result = await postMinistryAvatarMultipart(
      "/api/church/room-attachments/upload",
      buildMinistryAvatarForm(input),
      authHeaders
    );
    source = "room-attachments-fallback";
  }

  const url = pickUploadedMinistryAvatarUrl(result.body);
  if (!result.ok || !url) {
    return {
      ...empty,
      source,
      error: String(result.error || "Failed to upload ministry avatar"),
    };
  }

  console.log("KRISTO_MINISTRY_AVATAR_UPLOAD_OK", {
    source,
    status: result.status,
    url: url.slice(0, 160),
  });

  return {
    ok: true,
    url,
    avatar: url,
    avatarUri: url,
    ministryAvatarUrl: url,
    source,
  };
}

export async function createMinistry(payload: {
  name: string;
  description?: string;
  mediaAccess?: boolean;
}) {
  const base = getBase();
  const { userId } = getAuthBits();
  if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
  if (!userId) throw new Error("userId missing");

  const r = await fetch(`${base}/api/church/ministries`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: String(payload.name || "").trim(),
      description: String(payload.description || "").trim(),
      mediaAccess: payload.mediaAccess === true,
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || `Request failed (${r.status})`));
  }

  return j?.data || j;
}

export async function fetchMinistryMembers(ministryId: string) {
  const base = getBase();
  const { userId } = getAuthBits();
  if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
  if (!userId) throw new Error("userId missing");

  const r = await fetch(
    `${base}/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}&all=1`,
    { headers: headers() }
  );

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) {
    throw new Error(String(j?.error || `Request failed (${r.status})`));
  }

  return Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];
}
