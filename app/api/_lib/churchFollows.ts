import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type ChurchFollowRow = {
  userId: string;
  churchId: string;
  viewerChurchId?: string;
  createdAt: string;
};

const STORE_FILE = "church-follows.json";

function cleanChurchId(value: unknown) {
  return String(value || "").trim();
}

function cleanUserId(value: unknown) {
  return String(value || "").trim();
}

async function readAll(): Promise<ChurchFollowRow[]> {
  const rows = await readJsonFile<ChurchFollowRow[]>(STORE_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

export async function isFollowingChurch(userId: string, churchId: string) {
  const uid = cleanUserId(userId);
  const cid = cleanChurchId(churchId);
  if (!uid || !cid) return false;
  const rows = await readAll();
  return rows.some((row) => cleanUserId(row.userId) === uid && cleanChurchId(row.churchId) === cid);
}

export async function toggleChurchFollow(args: {
  userId: string;
  churchId: string;
  viewerChurchId?: string;
}) {
  const uid = cleanUserId(args.userId);
  const cid = cleanChurchId(args.churchId);
  if (!uid || !cid) {
    return { ok: false as const, error: "userId or churchId missing" };
  }

  let following = false;

  await updateJsonFile<ChurchFollowRow[]>(STORE_FILE, [], (rows) => {
    const list = Array.isArray(rows) ? [...rows] : [];
    const index = list.findIndex(
      (row) => cleanUserId(row.userId) === uid && cleanChurchId(row.churchId) === cid
    );

    if (index >= 0) {
      list.splice(index, 1);
      following = false;
      return list;
    }

    list.push({
      userId: uid,
      churchId: cid,
      viewerChurchId: cleanChurchId(args.viewerChurchId) || undefined,
      createdAt: new Date().toISOString(),
    });
    following = true;
    return list;
  });

  const followerCount = await countChurchFollowers(cid);
  return { ok: true as const, following, followerCount };
}

export async function countChurchFollowers(churchId: string) {
  const cid = cleanChurchId(churchId);
  if (!cid) return 0;
  const rows = await readAll();
  return new Set(
    rows
      .filter((row) => cleanChurchId(row.churchId) === cid)
      .map((row) => cleanUserId(row.userId))
      .filter(Boolean)
  ).size;
}

export async function countMutualFollowersFromChurch(args: {
  targetChurchId: string;
  viewerChurchId: string;
}) {
  const targetChurchId = cleanChurchId(args.targetChurchId);
  const viewerChurchId = cleanChurchId(args.viewerChurchId);
  if (!targetChurchId || !viewerChurchId || targetChurchId === viewerChurchId) {
    return 0;
  }

  const rows = await readAll();
  return rows.filter(
    (row) =>
      cleanChurchId(row.churchId) === targetChurchId &&
      cleanChurchId(row.viewerChurchId) === viewerChurchId
  ).length;
}
