import { resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { getMembershipsForUser } from "@/app/api/_lib/memberships";
import {
  getChurchMediaByChurchId,
  listChurchMediaByOwnerUserId,
} from "@/app/api/_lib/store/mediaDb";

function normalizeUserId(value: unknown): string {
  return String(value || "").trim();
}

function normalizeChurchId(value: unknown): string {
  return String(value || "").trim();
}

function isPastorChurchRole(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "pastor" || normalized.includes("pastor");
}

async function pastorOwnsChurch(
  ownerUserId: string,
  churchId: string
): Promise<boolean> {
  const uid = normalizeUserId(ownerUserId);
  const cid = normalizeChurchId(churchId);

  if (!uid || !cid) return false;

  const actualPastorUserId = await resolveActualChurchPastorUserId(cid);

  return (
    normalizeUserId(actualPastorUserId).toLowerCase() ===
    uid.toLowerCase()
  );
}

export type PastorOwnedChurchSummary = {
  churchId: string;
  churchName: string | null;
};

/**
 * Churches the user still owns/manages as the actual canonical Pastor.
 * This is account/church ownership security only — no subscription logic.
 */
export async function listPastorOwnedChurches(
  ownerUserId: string
): Promise<PastorOwnedChurchSummary[]> {
  const uid = normalizeUserId(ownerUserId);
  if (!uid) return [];

  const byChurchId = new Map<string, PastorOwnedChurchSummary>();

  const memberships = await getMembershipsForUser(uid);

  for (const membership of memberships) {
    if (String(membership.status || "").trim() !== "Active") continue;
    if (!isPastorChurchRole(membership.churchRole)) continue;

    const churchId = normalizeChurchId(membership.churchId);
    if (!churchId) continue;

    if (!(await pastorOwnsChurch(uid, churchId))) continue;

    const media = await getChurchMediaByChurchId(churchId);

    byChurchId.set(churchId.toUpperCase(), {
      churchId,
      churchName: String(media?.mediaName || "").trim() || null,
    });
  }

  const ownerIndexed = await listChurchMediaByOwnerUserId(uid);

  for (const media of ownerIndexed) {
    const churchId = normalizeChurchId(media.churchId);

    if (!churchId || byChurchId.has(churchId.toUpperCase())) continue;
    if (!(await pastorOwnsChurch(uid, churchId))) continue;

    byChurchId.set(churchId.toUpperCase(), {
      churchId,
      churchName: String(media?.mediaName || "").trim() || null,
    });
  }

  return Array.from(byChurchId.values());
}
