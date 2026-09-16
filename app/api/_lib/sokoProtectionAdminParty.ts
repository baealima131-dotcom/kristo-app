import { getProfile } from "@/app/api/auth/_lib/profile";

/**
 * Additive System_Admin enrichment. Identity is resolved only from the
 * user ids already stored on the case. Client-supplied names, photos, and
 * prices are ignored.
 */
export type SokoProtectionAdminParty = {
  userId: string;
  displayName: string | null;
  kristoId: string | null;
  avatarUrl: string | null;
  profileStatus: string | null;
};

const HTTPS_IMAGE = /^https:\/\/[^\s]{8,480}$/i;

export function trustedHttpsImage(value: unknown) {
  const text = String(value ?? "").trim();
  if (!HTTPS_IMAGE.test(text)) return null;
  if (/^https:\/\/data:/i.test(text)) return null;
  return text;
}

export function projectAdminParty(
  userId: string,
  profile: {
    userId?: string;
    fullName?: string;
    userCode?: string;
    avatarUrl?: string;
    profileStatus?: string;
  } | null
): SokoProtectionAdminParty {
  const expected = String(userId || "").trim();
  const profileUserId = String(profile?.userId || "").trim();
  if (!expected || !profile || profileUserId !== expected) {
    return {
      userId: expected,
      displayName: null,
      kristoId: null,
      avatarUrl: null,
      profileStatus: null,
    };
  }
  const name = String(profile.fullName || "").trim();
  const kristoId = String(profile.userCode || "").trim();
  const status = String(profile.profileStatus || "").trim();
  return {
    userId: expected,
    displayName: name || null,
    kristoId: kristoId || null,
    avatarUrl: trustedHttpsImage(profile.avatarUrl),
    profileStatus: status || null,
  };
}

export async function loadAdminPartiesForCases(
  cases: Array<{ buyerUserId: string; sellerUserId: string }>
) {
  const ids = [
    ...new Set(
      cases.flatMap((row) => [
        String(row.buyerUserId || "").trim(),
        String(row.sellerUserId || "").trim(),
      ])
    ),
  ].filter(Boolean);

  const profiles = await Promise.all(
    ids.map(async (userId) => {
      try {
        const profile = await getProfile(userId);
        return [userId, projectAdminParty(userId, profile)] as const;
      } catch {
        return [userId, projectAdminParty(userId, null)] as const;
      }
    })
  );
  const byId = new Map(profiles);

  return cases.map((row) => {
    const buyerId = String(row.buyerUserId || "").trim();
    const sellerId = String(row.sellerUserId || "").trim();
    return {
      buyer: byId.get(buyerId) || projectAdminParty(buyerId, null),
      seller: byId.get(sellerId) || projectAdminParty(sellerId, null),
    };
  });
}
