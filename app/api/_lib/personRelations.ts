import { getActiveMembership } from "@/app/api/_lib/memberships";

/**
 * Who a person is to the viewer, for the avatar rings. Only verified data counts: an Active
 * membership in a real church and its church role. Without an active membership the person is
 * "unknown" (neutral ring). Only the category leaves the server, never the person's church id.
 */
export type PersonRingCategory =
  | "myChurchPastor"
  | "myChurchMember"
  | "otherChurchPastor"
  | "otherChurchMember"
  | "unknown";

export const PERSON_RELATIONS_MAX_IDS = 50;

function normUserId(value: unknown) {
  return String(value || "").trim();
}

export function personRingCategoryFor(
  viewerChurchId: string,
  person: { churchId?: string; churchRole?: string } | null | undefined
): PersonRingCategory {
  const personChurchId = normUserId(person?.churchId);
  const role = String(person?.churchRole || "").trim().toLowerCase();
  if (!personChurchId || !role) return "unknown";
  const isPastor = role === "pastor";
  if (viewerChurchId && viewerChurchId === personChurchId) {
    return isPastor ? "myChurchPastor" : "myChurchMember";
  }
  return isPastor ? "otherChurchPastor" : "otherChurchMember";
}

/** Categories for up to PERSON_RELATIONS_MAX_IDS people, relative to `viewerUserId`. */
export async function resolvePersonRingCategories(
  viewerUserId: string,
  userIds: string[]
): Promise<Record<string, PersonRingCategory>> {
  const ids = Array.from(new Set(userIds.map(normUserId).filter(Boolean))).slice(
    0,
    PERSON_RELATIONS_MAX_IDS
  );
  const out: Record<string, PersonRingCategory> = {};
  if (!ids.length) return out;
  const viewer = await getActiveMembership(normUserId(viewerUserId)).catch(() => undefined);
  const viewerChurchId = normUserId(viewer?.churchId);
  const memberships = await Promise.all(
    ids.map((id) => getActiveMembership(id).catch(() => undefined))
  );
  ids.forEach((id, index) => {
    out[id] = personRingCategoryFor(viewerChurchId, memberships[index]);
  });
  return out;
}
