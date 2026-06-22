import { NextResponse } from "next/server";
import { getActiveMembership } from "@/app/api/_lib/memberships";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  getUserById,
  readSession,
  seedUserIfMissing,
  touchSession,
} from "@/app/api/auth/_lib/session";
import {
  computeProfileStatus,
  ensureProfileDraft,
  getProfile,
  getProfileByUserCode,
  upsertProfilePersist,
  normalizePrivacy,
  type Gender,
} from "@/app/api/auth/_lib/profile";
import {
  isPersistedProfileAvatarUrl,
  pickPersistedProfileAvatarUrl,
  uploadProfileAvatarFromDataUrl,
  withPersistedProfileAvatarFields,
} from "@/app/api/_lib/profileAvatarUpload";

export const runtime = "nodejs";

type Body = {
  fullName?: string;
  gender?: Gender;
  dob?: string;
  phone?: string;
  country?: string;
  city?: string;
  userCode?: string;

  dobVisibility?: "Private" | "CorePastor" | "Public";
  maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";
  maritalVisibility?: "Private" | "CorePastor" | "Public";
  avatarUrl?: string;
  avatarData?: string;
  bio?: string;

  privacy?: {
    publicProfile?: boolean;
    showFollowers?: boolean;
    showFollowing?: boolean;
    allowMessages?: boolean;
    showPhone?: boolean;
    showChurch?: boolean;
  showAddress?: boolean;
    privateMode?: boolean;
  };

  publicProfile?: boolean;
  showFollowers?: boolean;
  showFollowing?: boolean;
  allowMessages?: boolean;
  showPhone?: boolean;
  showChurch?: boolean;
  showAddress?: boolean;
  privateMode?: boolean;
};

function norm(s: any) {
  return String(s ?? "").trim();
}

function resolveIncomingAvatarUrl(body: Body, current: any, uploadedAvatarUrl: string) {
  if (uploadedAvatarUrl && isPersistedProfileAvatarUrl(uploadedAvatarUrl)) {
    return uploadedAvatarUrl;
  }

  const bodyAvatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim() : "";
  if (bodyAvatarUrl && isPersistedProfileAvatarUrl(bodyAvatarUrl)) {
    return bodyAvatarUrl;
  }

  const persisted = pickPersistedProfileAvatarUrl(current);
  if (persisted) return persisted;

  return "";
}

async function saveAvatarData(userId: string, avatarData: string) {
  const uploaded = await uploadProfileAvatarFromDataUrl(userId, avatarData);
  if (uploaded) {
    console.log("[KRISTO PROFILE AVATAR UPLOADED]", {
      userId,
      avatarUrl: uploaded.slice(0, 160),
      hasPublicUrl: /^https?:\/\//i.test(uploaded),
    });
    return uploaded;
  }

  console.error("[KRISTO PROFILE AVATAR UPLOAD FAILED]", {
    userId,
    reason: "no-durable-storage-url",
    byteLen: String(avatarData || "").length,
  });
  return "";
}

function isKristoUserCode(x: any) {
  return /^KR7-[A-Z0-9]{6,10}$/.test(String(x || "").trim().toUpperCase());
}

async function resolveAuthedUser(req: Request) {
  const headerUserId = String(req.headers.get("x-kristo-user-id") || "").trim();
  if (!headerUserId) return null;

  const u = await getUserById(headerUserId);
  if (u) return { user: u, sessionId: null as string | null };

  // Mobile signup bootstrap on serverless: trust verified client user id header.
  if (headerUserId.startsWith("u_")) {
    return {
      user: {
        id: headerUserId,
        password: "",
      } as any,
      sessionId: null as string | null,
    };
  }

  if (isKristoUserCode(headerUserId)) {
    const profile = await getProfileByUserCode(headerUserId);
    const realUserId = String((profile as any)?.userId || (profile as any)?.id || headerUserId).trim();

    return {
      user: {
        id: realUserId,
        email: (profile as any)?.email,
        phone: (profile as any)?.phone,
        password: "",
      } as any,
      sessionId: null as string | null,
    };
  }

  return null;
}


export async function GET(req: Request) {
  try {
    await seedUserIfMissing();

    const sess = await readSession(req);
    let u = sess ? await getUserById(sess.userId) : null;

    if (sess?.id) await touchSession(sess.id);

    if (!u) {
      const fallback = await resolveAuthedUser(req);
      u = fallback?.user || null;
    }

    if (!u) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const current =
      (await getProfile(u.id)) || (await ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone }));
    const activeMembership = await getActiveMembership(u.id);
    const hasChurch = !!activeMembership;
    const churchProfile = activeMembership?.churchId
      ? await getChurchById(activeMembership.churchId)
      : null;

    const next = {
      ...current,
      userCode: (current as any).userCode || (isKristoUserCode(u.id) ? String(u.id).toUpperCase() : (current as any).userCode),
      privacy: normalizePrivacy((current as any).privacy),
      profileStatus: computeProfileStatus({
        fullName: norm(current.fullName),
        phone: norm(current.phone),
        dob: norm(current.dob),
        country: norm(current.country),
        city: norm(current.city),
        hasChurch,
      }),
      updatedAt: Date.now(),
    };

    await upsertProfilePersist(next);

    return NextResponse.json({
      ok: true,
      profile: next,
      activeMembership,
      churchId: activeMembership?.churchId || "",
      churchName: churchProfile?.name || "",
      churchRole: activeMembership?.churchRole || "",
      role: activeMembership?.churchRole || "",
    });
  } catch (error: any) {
    const message = String(error?.message || error || "Failed to load profile.");
    console.error("[KRISTO PROFILE GET ERROR]", message, error?.stack || error);
    return NextResponse.json({ ok: false, error: message, reason: "profile_get_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await seedUserIfMissing();

    const sess = await readSession(req);
    let u = sess ? await getUserById(sess.userId) : null;

    if (sess?.id) await touchSession(sess.id);

    if (!u) {
      const fallback = await resolveAuthedUser(req);
      u = fallback?.user || null;
    }

    if (!u) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Body;

    const current =
      (await getProfile(u.id)) || (await ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone }));
  const activeMembership = await getActiveMembership(u.id);
  const hasChurch = !!activeMembership;

  const mergedPrivacyInput = {
    ...(current as any).privacy,
    ...(body.privacy || {}),
    ...(typeof body.publicProfile === "boolean" ? { publicProfile: body.publicProfile } : {}),
    ...(typeof body.showFollowers === "boolean" ? { showFollowers: body.showFollowers } : {}),
    ...(typeof body.showFollowing === "boolean" ? { showFollowing: body.showFollowing } : {}),
    ...(typeof body.allowMessages === "boolean" ? { allowMessages: body.allowMessages } : {}),
    ...(typeof body.showPhone === "boolean" ? { showPhone: body.showPhone } : {}),
    ...(typeof body.showChurch === "boolean" ? { showChurch: body.showChurch } : {}),
    ...(typeof body.showAddress === "boolean" ? { showAddress: body.showAddress } : {}),
    ...(typeof body.privateMode === "boolean" ? { privateMode: body.privateMode } : {}),
  };

  let uploadedAvatarUrl = "";
  if (body.avatarData) {
    try {
      uploadedAvatarUrl = await saveAvatarData(u.id, body.avatarData);
    } catch (error: any) {
      const message = String(error?.message || error || "Avatar upload failed.");
      console.error("[KRISTO PROFILE AVATAR UPLOAD ERROR]", {
        userId: u.id,
        error: message,
      });
      return NextResponse.json(
        { ok: false, error: message, reason: "avatar_upload_failed" },
        { status: 500 }
      );
    }

    if (!uploadedAvatarUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "Avatar upload failed. Photo storage is not available.",
          reason: "avatar_upload_failed",
        },
        { status: 503 }
      );
    }
  }

  const resolvedAvatarUrl = resolveIncomingAvatarUrl(body, current, uploadedAvatarUrl);

  const nextBase = {
    ...current,
    fullName: norm(body.fullName) || current.fullName,
    phone: norm(body.phone) || current.phone,
    gender: body.gender === "FEMALE" ? "FEMALE" : body.gender === "MALE" ? "MALE" : current.gender,
    dob: norm(body.dob) || current.dob,
    country: norm(body.country) || current.country,
    city: norm(body.city) || current.city,
    userCode:
      norm(body.userCode).toUpperCase() ||
      (current as any).userCode ||
      (isKristoUserCode(u.id) ? String(u.id).toUpperCase() : undefined),

    bio: typeof body.bio === "string" ? body.bio : (current as any).bio,

    dobVisibility: body.dobVisibility || current.dobVisibility,
    maritalStatus: body.maritalStatus || current.maritalStatus,
    maritalVisibility: body.maritalVisibility || current.maritalVisibility,

    privacy: normalizePrivacy(mergedPrivacyInput),

    profileStatus: computeProfileStatus({
      fullName: norm(body.fullName) || current.fullName,
      phone: norm(body.phone) || current.phone,
      dob: norm(body.dob) || current.dob,
      country: norm(body.country) || current.country,
      city: norm(body.city) || current.city,
      hasChurch,
    }),

    updatedAt: Date.now(),
  };

  const next = resolvedAvatarUrl
    ? withPersistedProfileAvatarFields(nextBase, resolvedAvatarUrl)
    : nextBase;

  await upsertProfilePersist(next);

    const churchProfile = activeMembership?.churchId
      ? await getChurchById(activeMembership.churchId)
      : null;

    console.log("[KRISTO PROFILE POST] saved", {
      userId: u.id,
      fullName: next.fullName,
      userCode: (next as any).userCode,
      hasAvatar: Boolean(pickPersistedProfileAvatarUrl(next)),
    });

    return NextResponse.json({
      ok: true,
      profile: next,
      activeMembership,
      churchId: activeMembership?.churchId || "",
      churchName: churchProfile?.name || "",
      churchRole: activeMembership?.churchRole || "",
      role: activeMembership?.churchRole || "",
    });
  } catch (error: any) {
    const message = String(error?.message || error || "Failed to save profile.");
    console.error("[KRISTO PROFILE POST ERROR]", message, error?.stack || error);
    return NextResponse.json({ ok: false, error: message, reason: "profile_save_failed" }, { status: 500 });
  }
}
