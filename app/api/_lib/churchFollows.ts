import {
  CHURCH_FOLLOWS_STORE_KEY,
  readCoreJsonFile as readJsonFile,
  resolveCoreStoreMode,
  updateCoreJsonFile as updateJsonFile,
  writeCoreJsonFile as writeJsonFile,
} from "@/app/api/_lib/store/coreDb";
import { resolveActorIdentity } from "@/app/api/_lib/notificationActor";

export type ChurchFollowEdge = {
  id: string;
  userId: string;
  churchId: string;
  createdAt: string;
  updatedAt: string;
};

export type ChurchFollowItem = {
  churchId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  id?: string;
};

export type ChurchFollowsDocument = {
  items: ChurchFollowItem[];
};

export const CHURCH_FOLLOWS_STORE = CHURCH_FOLLOWS_STORE_KEY;

export const EMPTY_CHURCH_FOLLOWS_DOC: ChurchFollowsDocument = { items: [] };

export function normalizeChurchId(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeFollowItem(row: unknown): ChurchFollowItem | null {
  const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const userId = String(source.userId || "").trim();
  const churchId = normalizeChurchId(source.churchId);
  if (!userId || !churchId) return null;

  const createdAt = String(source.createdAt || source.followedAt || nowIso()).trim() || nowIso();
  const updatedAt = String(source.updatedAt || createdAt).trim() || createdAt;
  const id = String(source.id || `church_follow_${userId}_${churchId}`).trim();

  return {
    id,
    userId,
    churchId,
    createdAt,
    updatedAt,
  };
}

export function parseChurchFollowsDocument(raw: unknown): {
  document: ChurchFollowsDocument;
  repaired: boolean;
} {
  if (Array.isArray(raw)) {
    const items = raw
      .map((row) => normalizeFollowItem(row))
      .filter((row): row is ChurchFollowItem => Boolean(row));
    return {
      document: normalizeChurchFollowsDocument({ items }),
      repaired: true,
    };
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      const items = record.items
        .map((row) => normalizeFollowItem(row))
        .filter((row): row is ChurchFollowItem => Boolean(row));
      const document = normalizeChurchFollowsDocument({ items });
      const repaired = items.length !== record.items.length;
      return { document, repaired };
    }
  }

  return {
    document: EMPTY_CHURCH_FOLLOWS_DOC,
    repaired: raw != null,
  };
}

export function normalizeChurchFollowsDocument(doc: ChurchFollowsDocument): ChurchFollowsDocument {
  const seen = new Set<string>();
  const items: ChurchFollowItem[] = [];

  for (const row of doc.items || []) {
    const normalized = normalizeFollowItem(row);
    if (!normalized) continue;
    const key = `${normalized.userId}:${normalized.churchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
  }

  return { items };
}

export function readChurchFollowEdges(raw: unknown): ChurchFollowEdge[] {
  const { document } = parseChurchFollowsDocument(raw);
  return document.items.map((row) => ({
    id: String(row.id || `church_follow_${row.userId}_${row.churchId}`),
    userId: row.userId,
    churchId: row.churchId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function writeChurchFollowsDocument(doc: ChurchFollowsDocument) {
  const normalized = normalizeChurchFollowsDocument(doc);
  console.log("KRISTO_CHURCH_FOLLOW_WRITE_PAYLOAD", {
    store: CHURCH_FOLLOWS_STORE,
    storeMode: resolveCoreStoreMode(),
    typeofPayload: typeof normalized,
    itemCount: normalized.items.length,
    preview: JSON.stringify(normalized).slice(0, 240),
  });
  await writeJsonFile(CHURCH_FOLLOWS_STORE, normalized);
}

async function loadChurchFollowsDocument(): Promise<ChurchFollowsDocument> {
  try {
    const raw = await readJsonFile<unknown>(CHURCH_FOLLOWS_STORE, EMPTY_CHURCH_FOLLOWS_DOC);
    const parsed = parseChurchFollowsDocument(raw);
    if (parsed.repaired) {
      console.warn("KRISTO_CHURCH_FOLLOW_STORE_SELF_HEAL", {
        store: CHURCH_FOLLOWS_STORE,
        storeMode: resolveCoreStoreMode(),
        reason: "invalid-or-legacy-payload",
        itemCount: parsed.document.items.length,
      });
      await writeChurchFollowsDocument(parsed.document);
    }
    return parsed.document;
  } catch (error) {
    logChurchFollowStoreError("loadChurchFollowsDocument", error);
    console.warn("KRISTO_CHURCH_FOLLOW_STORE_SELF_HEAL", {
      store: CHURCH_FOLLOWS_STORE,
      storeMode: resolveCoreStoreMode(),
      reason: "read-failed-reset-empty",
    });
    await writeChurchFollowsDocument(EMPTY_CHURCH_FOLLOWS_DOC);
    return EMPTY_CHURCH_FOLLOWS_DOC;
  }
}

export async function loadChurchFollowEdges(): Promise<ChurchFollowEdge[]> {
  try {
    const document = await loadChurchFollowsDocument();
    return readChurchFollowEdges(document);
  } catch (error) {
    logChurchFollowStoreError("loadChurchFollowEdges", error);
    throw error;
  }
}

function logChurchFollowStoreError(phase: string, error: unknown) {
  const err = error as Error;
  console.error("KRISTO_CHURCH_FOLLOW_STORE_ERROR", {
    phase,
    store: CHURCH_FOLLOWS_STORE,
    storeMode: resolveCoreStoreMode(),
    message: String(err?.message || error || "unknown"),
    stack: err?.stack || null,
  });
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

  try {
    const next = await updateJsonFile<ChurchFollowsDocument>(
      CHURCH_FOLLOWS_STORE,
      (current) => {
        const parsed = parseChurchFollowsDocument(current);
        const document = parsed.document;
        const stamp = nowIso();
        const existing = document.items.find((row) => row.userId === uid && row.churchId === cid);
        if (existing) {
          return normalizeChurchFollowsDocument({
            items: document.items.map((row) =>
              row.userId === uid && row.churchId === cid
                ? { ...row, updatedAt: stamp }
                : row
            ),
          });
        }

        return normalizeChurchFollowsDocument({
          items: [
            {
              id: `church_follow_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
              userId: uid,
              churchId: cid,
              createdAt: stamp,
              updatedAt: stamp,
            },
            ...document.items,
          ],
        });
      },
      EMPTY_CHURCH_FOLLOWS_DOC
    );

    return readChurchFollowEdges(next);
  } catch (error) {
    logChurchFollowStoreError("upsertChurchFollow", error);
    throw error;
  }
}

export async function removeChurchFollow(userId: string, churchId: string) {
  const uid = String(userId || "").trim();
  const cid = normalizeChurchId(churchId);
  if (!uid || !cid) return loadChurchFollowEdges();

  try {
    const next = await updateJsonFile<ChurchFollowsDocument>(
      CHURCH_FOLLOWS_STORE,
      (current) => {
        const parsed = parseChurchFollowsDocument(current);
        return normalizeChurchFollowsDocument({
          items: parsed.document.items.filter(
            (row) => !(row.userId === uid && row.churchId === cid)
          ),
        });
      },
      EMPTY_CHURCH_FOLLOWS_DOC
    );

    return readChurchFollowEdges(next);
  } catch (error) {
    logChurchFollowStoreError("removeChurchFollow", error);
    throw error;
  }
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
      const aMs = Date.parse(a.updatedAt || a.createdAt) || 0;
      const bMs = Date.parse(b.updatedAt || b.createdAt) || 0;
      return bMs - aMs;
    });

  const rows = await Promise.all(
    edges.map(async (edge) => {
      const identity = await resolveActorIdentity(edge.userId);
      return {
        userId: edge.userId,
        displayName: String(identity.name || edge.userId).trim() || edge.userId,
        avatarUri: String(identity.avatar || "").trim(),
        followedAt: edge.updatedAt || edge.createdAt || nowIso(),
      } satisfies ChurchFollowerRow;
    })
  );

  return rows;
}
