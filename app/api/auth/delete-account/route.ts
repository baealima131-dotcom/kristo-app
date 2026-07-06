import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import {
  getMembershipsForUser,
  leaveActiveMembership,
  rejectMembership,
} from "@/app/api/_lib/memberships";
import {
  getProfile,
  getProfileByUserCode,
  upsertProfilePersist,
} from "@/app/api/auth/_lib/profile";
import {
  clearSessionCookie,
  deleteChallengesForUser,
  deleteUserById,
  getUserById,
  updateUserPersist,
} from "@/app/api/auth/_lib/session";
import { logAuthRequestDiag, resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";
import { listPastorOwnedChurches } from "@/app/api/_lib/subscriptionOwnershipLock";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isPendingJoinRequestStatus(status: unknown): boolean {
  const token = String(status || "").trim().toLowerCase();
  return token === "requested" || token === "pending" || token === "request";
}

async function resolveRealUserId(headerUserId: string): Promise<string> {
  const trimmed = String(headerUserId || "").trim();
  if (!trimmed) return "";
  if (/^KR7-[A-Z0-9]{6,10}$/i.test(trimmed)) {
    const profile = await getProfileByUserCode(trimmed);
    return String((profile as any)?.userId || (profile as any)?.id || trimmed).trim();
  }
  return trimmed;
}

async function invalidateLogin(userId: string) {
  const revokedPassword = bcrypt.hashSync(
    `deleted:${userId}:${crypto.randomBytes(12).toString("hex")}`,
    10
  );
  await updateUserPersist(userId, {
    password: revokedPassword,
    email: "",
    phone: "",
  });
}

async function anonymizeProfile(userId: string) {
  const profile = await getProfile(userId);
  if (!profile) return;

  await upsertProfilePersist({
    ...profile,
    fullName: "Deleted User",
    email: "",
    phone: "",
    avatarUrl: "",
    bio: "",
    privacy: {
      ...(profile.privacy || {}),
      publicProfile: false,
      privateMode: true,
      allowMessages: false,
    },
    profileStatus: "Locked",
    updatedAt: Date.now(),
    accountDeletedAt: Date.now(),
  } as any);
}

async function detachMemberships(userId: string) {
  const leaveResult = await leaveActiveMembership(userId);
  if (!leaveResult.ok && leaveResult.error !== "No Active membership to leave") {
    throw new Error(leaveResult.error);
  }

  const rows = await getMembershipsForUser(userId);
  for (const membership of rows) {
    if (!isPendingJoinRequestStatus(membership.status)) continue;
    if (String(membership.requestSource || "JoinRequest") === "ChurchInvite") continue;
    const rejected = await rejectMembership(membership.id, userId, "Account deleted");
    if (!rejected.ok) {
      throw new Error(rejected.error);
    }
  }
}

async function purgeUserAccount(userId: string) {
  const partialErrors: string[] = [];

  const steps: Array<{ step: string; run: () => Promise<void> }> = [
    { step: "challenges", run: async () => deleteChallengesForUser(userId) },
    { step: "memberships", run: async () => detachMemberships(userId) },
    { step: "anonymize_profile", run: async () => anonymizeProfile(userId) },
    {
      step: "invalidate_login",
      run: async () => {
        const user = await getUserById(userId);
        if (user) await invalidateLogin(userId);
      },
    },
    { step: "delete_user", run: async () => deleteUserById(userId) },
  ];

  for (const { step, run } of steps) {
    try {
      await run();
    } catch (error: any) {
      const message = String(error?.message || error || `${step}_failed`);
      partialErrors.push(message);
      console.log("KRISTO_DELETE_ACCOUNT_STEP_FAILED", { userId, step, error: message });
    }
  }

  return partialErrors;
}

async function deleteAccount(req: NextRequest) {
  logAuthRequestDiag(req, "delete-account");
  const auth = resolveRequestUserId(req);
  if (!auth.userId) {
    console.log("KRISTO_DELETE_ACCOUNT_API_FAILED", {
      userId: null,
      reason: auth.reason || "unauthorized",
    });
    return json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const userId = await resolveRealUserId(auth.userId);
  if (!userId) {
    return json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  console.log("KRISTO_DELETE_ACCOUNT_API_START", { userId });

  const pastorOwnsChurches = await listPastorOwnedChurches(userId);
  if (pastorOwnsChurches.length > 0) {
    console.log("KRISTO_DELETE_ACCOUNT_BLOCKED_PASTOR_OWNS_CHURCH", {
      userId,
      churchCount: pastorOwnsChurches.length,
      churchIds: pastorOwnsChurches.map((row) => row.churchId),
    });
    return json(
      {
        ok: false,
        error: "pastor-owns-church",
        reason: "pastor-owns-church",
        pastorOwnsChurches,
      },
      { status: 403 }
    );
  }

  const partialErrors = await purgeUserAccount(userId);

  let res = json({
    ok: true,
    ...(partialErrors.length ? { partialErrors } : {}),
  });
  res = clearSessionCookie(res);
  console.log("KRISTO_DELETE_ACCOUNT_API_SUCCESS", {
    userId,
    partialErrors: partialErrors.length ? partialErrors : null,
  });
  return res;
}

export async function POST(req: NextRequest) {
  return deleteAccount(req);
}

export async function DELETE(req: NextRequest) {
  return deleteAccount(req);
}
