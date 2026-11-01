import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

function firstName(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    // Never surface an email address as a public name.
    if (text && !text.includes("@")) return text;
  }
  return "";
}

/** Display name stored for the account (profile first, then the user record). Never an email. */
export async function resolvePublicDisplayName(userId: string, fallback = "Member"): Promise<string> {
  const uid = String(userId || "").trim();
  if (!uid) return fallback;
  const profile: any = await getProfile(uid).catch(() => null);
  const user: any = await getUserById(uid).catch(() => null);
  return (
    firstName(
      profile?.displayName,
      profile?.fullName,
      profile?.name,
      user?.displayName,
      user?.name,
      user?.kristoId
    ) || fallback
  );
}
