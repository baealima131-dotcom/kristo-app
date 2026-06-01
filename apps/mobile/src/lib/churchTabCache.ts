import AsyncStorage from "@react-native-async-storage/async-storage";
import { isScreenCacheFresh } from "@/src/lib/screenDataCache";

export const CHURCH_TAB_REFRESH_MS = 75000;

const MEMBERS_PREFIX = "kristo_church_tab_members_v1:";
const membersMemory = new Map<string, ChurchMembersCachePayload>();

export type ChurchMembersCachePayload = {
  churchId: string;
  userId: string;
  members: Record<string, unknown>[];
  requests: Record<string, unknown>[];
  updatedAt: number;
};

function membersKey(churchId: string, userId: string) {
  return `${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

export function peekChurchMembersCache(churchId: string, userId: string) {
  return membersMemory.get(membersKey(churchId, userId)) || null;
}

export async function getChurchMembersCache(churchId: string, userId: string) {
  const key = membersKey(churchId, userId);
  const mem = membersMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${MEMBERS_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChurchMembersCachePayload;
    if (!parsed?.churchId || !parsed?.userId) return null;
    membersMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveChurchMembersCache(payload: ChurchMembersCachePayload) {
  const key = membersKey(payload.churchId, payload.userId);
  const next = { ...payload, updatedAt: Date.now() };
  membersMemory.set(key, next);
  await AsyncStorage.setItem(`${MEMBERS_PREFIX}${key}`, JSON.stringify(next));
}

export function isChurchMembersCacheFresh(updatedAt?: number) {
  return isScreenCacheFresh(updatedAt, CHURCH_TAB_REFRESH_MS);
}

export function churchMembersRowsSignature(rows: any[]) {
  return rows
    .map(
      (r) =>
        `${String(r?.userId || r?.id || "")}|${String(r?.role || r?.churchRole || "")}|${String(r?.status || r?.membershipStatus || "")}|${Boolean(resolveMemberAvatarSig(r))}`
    )
    .sort()
    .join("\n");
}

function resolveMemberAvatarSig(row: any) {
  return Boolean(
    String(
      row?.avatarUrl ||
        row?.avatarUri ||
        row?.profileImage ||
        row?.photoURL ||
        row?.image ||
        ""
    ).trim()
  );
}
