import {
  readCoreJsonFile as readJsonFile,
  updateCoreJsonFile as updateJsonFile,
} from "@/app/api/_lib/store/coreDb";
import { resolveActorIdentity } from "@/app/api/_lib/notificationActor";

export type ChurchFollowEdge = {
  id: string;
  userId: string;
  churchId: string;
  createdAt: string;
};

export const CHURCH_FOLLOWS_STORE = "church-follows.json";

export function normalizeChurchId(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function readChurchFollowEdges(raw: unknown): ChurchFollowEdge[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((row: any) => ({
      id: String(row?.id || "").trim(),
      userId: String(row?.userId || "").trim(),
      churchId: normalizeChurchId(row?.churchId),
      createdAt: String(row?.createdAt || "").trim(),
    }))
    .filter((row) => row.userId && row.churchId);
}

export async function loadChurchFollowEdges(): Promise<ChurchFollowEdge[]> {
  return readChurchFollowEdges(await readJsonFile(CHURCH_FOLLOWS_STORE, []));
}

export function countChurchFollowers(churchId: string, edges: ChurchFollowEdge[]) {
  const cid = normalizeChurchId(churchId);
  if (!cid) return 0;
  return edges.filter((row) => row.churchId === cid).length;
}

export async function getChurchFollowerCount(churchId: string) {
  const edges = await loadChurchFollowEdges();
  return countChurchFollowers(churchId, edges);
}

export function isUserFollowingChurch(
  userId: string,
  churchId: string,
  edges: ChurchFollowEdge[]
) {
  const uid = String(userId || "").trim();
  const cid = normalizeChurchId(churchId);
  if (!uid || !cid) return false;
  return edges.some((row) => row.userId === uid && row.churchId === cid);
}

export async function getViewerFollowingChurch(userId: string, churchId: string) {
  const uid = String(userId || "").trim();
  const cid = normalizeChurchId(churchId);
  if (!uid || !cid) return false;
  const edges = await loadChurchFollowEdges();
  return isUserFollowingChurch(uid, cid, edges);
}

export async function upsertChurchFollow(userId: string, churchId: string) {
  const uid = String(userId || "").trim();
  const cid = normalizeChurchId(churchId);
  if (!uid || !cid) return loadChurchFollowEdges();

  const next = await updateJsonFile<ChurchFollowEdge[]>(
    CHURCH_FOLLOWS_STORE,
    (current) => {
      const edges = readChurchFollowEdges(current);
      if (edges.some((row) => row.userId === uid && row.churchId === cid)) {
        return edges;
      }
      return [
        {
          id: `church_follow_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
          userId: uid,
          churchId: cid,
          createdAt: new Date().toISOString(),
        },
        ...edges,
      ];
    },
    []
  );

  return readChurchFollowEdges(next);
}

export async function removeChurchFollow(userId: string, churchId: string) {
  const uid = String(userId || "").trim();
  const cid = normalizeChurchId(churchId);
  if (!uid || !cid) return loadChurchFollowEdges();

  const next = await updateJsonFile<ChurchFollowEdge[]>(
    CHURCH_FOLLOWS_STORE,
    (current) => {
      const edges = readChurchFollowEdges(current);
      return edges.filter((row) => !(row.userId === uid && row.churchId === cid));
    },
    []
  );

  return readChurchFollowEdges(next);
}

export type ChurchFollowerRow = {
  userId: string;
  displayName: string;
  avatarUri: string;
  followedAt: string;
};

export async function listChurchFollowers(churchId: string): Promise<ChurchFollowerRow[]> {
  const cid = normalizeChurchId(churchId);
  if (!cid) return [];

  const edges = (await loadChurchFollowEdges())
    .filter((row) => row.churchId === cid)
    .sort((a, b) => {
      const aMs = Date.parse(a.createdAt) || 0;
      const bMs = Date.parse(b.createdAt) || 0;
      return bMs - aMs;
    });

  const rows = await Promise.all(
    edges.map(async (edge) => {
      const identity = await resolveActorIdentity(edge.userId);
      return {
        userId: edge.userId,
        displayName: String(identity.name || edge.userId).trim() || edge.userId,
        avatarUri: String(identity.avatar || "").trim(),
        followedAt: edge.createdAt || new Date().toISOString(),
      } satisfies ChurchFollowerRow;
    })
  );

  return rows;
}
