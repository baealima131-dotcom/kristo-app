import { getSessionSync } from "@/src/lib/kristoSession";

export type MinistryItem = {
  id: string;
  name: string;
  description?: string;
  churchId?: string;
  memberCount?: number;
  avatarUri?: string;
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
      x?.profileImage ||
      x?.profilePhoto ||
      x?.photo ||
      x?.image ||
      x?.avatar ||
      ""
    ),
    churchId: String(x?.churchId || ""),
    memberCount: Number(x?.memberCount ?? x?.membersCount ?? x?.ministryMembersCount ?? 0),
    createdAt: String(x?.createdAt || ""),
    updatedAt: String(x?.updatedAt || ""),
  }));
}

export async function fetchMinistryById(ministryId: string): Promise<MinistryItem | null> {
  const list = await fetchMinistries();
  return list.find((x) => x.id === ministryId) || null;
}

export async function createMinistry(payload: {
  name: string;
  description?: string;
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
