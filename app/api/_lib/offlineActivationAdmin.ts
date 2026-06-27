import { findUserByIdentifier, getUserById } from "@/app/api/auth/_lib/session";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getPlatformRole, upsertPlatformRole, type PlatformRole } from "@/app/api/_lib/platformRoles";

export type ActivationUserRef = {
  userId: string;
  email?: string;
  fullName?: string;
  phone?: string;
};

export async function resolveActivationUserIdentifier(identifier: string): Promise<ActivationUserRef> {
  const raw = String(identifier || "").trim();
  if (!raw) throw new Error("Email or userId is required");

  if (raw.startsWith("u_")) {
    const user = await getUserById(raw);
    if (!user) throw new Error("User not found");
    const profile = await getProfile(raw).catch(() => null);
    return {
      userId: raw,
      email: String(user.email || profile?.email || "").trim() || undefined,
      fullName: String(profile?.fullName || "").trim() || undefined,
      phone: String(user.phone || profile?.phone || "").trim() || undefined,
    };
  }

  if (raw.includes("@")) {
    const user = await findUserByIdentifier("email", raw);
    if (!user?.id) throw new Error("User not found for email");
    const profile = await getProfile(user.id).catch(() => null);
    return {
      userId: user.id,
      email: String(user.email || profile?.email || raw).trim() || undefined,
      fullName: String(profile?.fullName || "").trim() || undefined,
      phone: String(user.phone || profile?.phone || "").trim() || undefined,
    };
  }

  throw new Error("Use a valid email or userId (u_...)");
}

export async function addSupervisorByIdentifier(
  identifier: string,
  addedByUserId: string
): Promise<{ user: ActivationUserRef; platformRole: PlatformRole }> {
  const user = await resolveActivationUserIdentifier(identifier);
  const existing = await getPlatformRole(user.userId);

  if (existing === "System_Admin") {
    throw new Error("User is already System_Admin");
  }
  if (existing === "Agent") {
    throw new Error("User is already an Agent");
  }

  const saved = await upsertPlatformRole(
    user.userId,
    "Supervisor",
    `Added by System Admin ${String(addedByUserId || "").trim() || "unknown"}`
  );

  return { user, platformRole: saved.platformRole };
}
