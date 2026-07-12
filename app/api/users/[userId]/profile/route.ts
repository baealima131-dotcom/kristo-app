import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getProfile,
  getProfileByUserCode,
} from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";
import {
  getActiveMembership,
  getMembershipsForUser,
} from "@/app/api/_lib/memberships";
import { getChurchById } from "@/app/api/_lib/churches";
import { normalizePrivacy } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value || "").trim();
}

function normalizePublicLanguages(
  value: unknown
): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter(Boolean)
      .slice(0, 8);
  }

  const raw = text(value);

  if (!raw) {
    return [];
  }

  if (
    raw.startsWith("[") &&
    raw.endsWith("]")
  ) {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => text(item))
          .filter(Boolean)
          .slice(0, 8);
      }
    } catch {
      // Fall through to comma-separated parsing.
    }
  }

  return raw
    .split(",")
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, 8);
}

export async function GET(
  req: NextRequest,
  context: {
    params:
      | { userId: string }
      | Promise<{ userId: string }>;
  }
) {
  const viewerUserId = text(
    req.headers.get("x-kristo-user-id")
  );

  if (!viewerUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 }
    );
  }

  const params = await Promise.resolve(
    context.params
  );

  const targetUserId = text(params?.userId);

  if (!targetUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing userId",
      },
      { status: 400 }
    );
  }

  const directProfile =
    await getProfile(targetUserId).catch(
      () => null
    );

  const codeProfile =
    directProfile
      ? null
      : await getProfileByUserCode(
          targetUserId
        ).catch(() => null);

  const initialProfile =
    directProfile || codeProfile;

  const canonicalTargetUserId = text(
    (initialProfile as any)?.userId ||
      (initialProfile as any)?.id ||
      targetUserId
  );

  const [profile, account] =
    await Promise.all([
      initialProfile
        ? Promise.resolve(initialProfile)
        : getProfile(
            canonicalTargetUserId
          ).catch(() => null),

      getUserById(
        canonicalTargetUserId
      ).catch(() => null),
    ]);

  if (!profile && !account) {
    return NextResponse.json(
      {
        ok: false,
        error: "Profile not found",
      },
      { status: 404 }
    );
  }

  const source: any = profile || {};
  const user: any = account || {};

  const [
    activeMembership,
    membershipHistory,
  ] = await Promise.all([
    getActiveMembership(
      canonicalTargetUserId
    ).catch(() => null),

    getMembershipsForUser(
      canonicalTargetUserId
    ).catch(() => []),
  ]);

  const membershipChurch =
    activeMembership?.churchId
      ? await getChurchById(
          activeMembership.churchId
        ).catch(() => null)
      : null;

  const privacy = normalizePrivacy({
    ...(source.privacy &&
    typeof source.privacy === "object"
      ? source.privacy
      : {}),

    ...(
      typeof source.showChurchId ===
      "boolean"
        ? {
            showChurchId:
              source.showChurchId,
          }
        : {}
    ),

    ...(
      typeof source.showKristoId ===
      "boolean"
        ? {
            showKristoId:
              source.showKristoId,
          }
        : {}
    ),

    ...(
      typeof source.churchIdPublic ===
      "boolean"
        ? {
            showChurchId:
              source.churchIdPublic,
          }
        : {}
    ),

    ...(
      typeof source.kristoIdPublic ===
      "boolean"
        ? {
            showKristoId:
              source.kristoIdPublic,
          }
        : {}
    ),
  });

  const fullName = text(
    source.fullName ||
      source.displayName ||
      source.name ||
      user.displayName ||
      user.name ||
      "Member"
  );

  const avatarUrl = text(
    source.avatarUrl ||
      source.avatarUri ||
      source.profileImage ||
      source.photoURL ||
      source.image ||
      user.avatarUrl ||
      user.avatarUri ||
      user.profileImage ||
      user.photoURL ||
      user.image
  );

  const rawChurchId = text(
    activeMembership?.churchId ||
      source.churchId ||
      source.activeChurchId ||
      user.churchId ||
      user.activeChurchId
  );

  const churchId =
    privacy.showChurchId
      ? rawChurchId
      : "";

  const churchName = text(
    membershipChurch?.name ||
      source.churchName ||
      source.activeChurchName ||
      user.churchName ||
      user.activeChurchName
  );

  const role = text(
    activeMembership?.churchRole ||
      source.role ||
      source.churchRole ||
      user.role ||
      user.churchRole ||
      "Member"
  );

  const kristoId = privacy.showKristoId
    ? text(
        source.userCode ||
          source.kristoId ||
          source.publicKristoId
      )
    : "";

  const dobIsPublic =
    source.dobVisibility === "Public";

  const publicDob =
    dobIsPublic
      ? text(source.dob)
      : "";

  let publicAge: number | "" = "";

  if (publicDob) {
    const birthDate = new Date(
      `${publicDob}T12:00:00`
    );

    if (
      Number.isFinite(
        birthDate.getTime()
      )
    ) {
      const today = new Date();

      let age =
        today.getFullYear() -
        birthDate.getFullYear();

      const birthdayPassed =
        today.getMonth() >
          birthDate.getMonth() ||
        (
          today.getMonth() ===
            birthDate.getMonth() &&
          today.getDate() >=
            birthDate.getDate()
        );

      if (!birthdayPassed) {
        age -= 1;
      }

      if (age >= 0 && age <= 130) {
        publicAge = age;
      }
    }
  }

  const publicLanguages =
    privacy.showLanguages
      ? normalizePublicLanguages(
          source.languages
        )
      : [];

  const verifiedMembershipHistory =
    (
      await Promise.all(
        (
          Array.isArray(membershipHistory)
            ? membershipHistory
            : []
        )
          .filter((membership: any) => {
            const status = text(
              membership?.status
            );

            return (
              status === "Active" ||
              status === "Left" ||
              status === "Banned"
            );
          })
          .map(async (membership: any) => {
            const historyChurchId = text(
              membership?.churchId
            );

            const historyChurch =
              historyChurchId
                ? await getChurchById(
                    historyChurchId
                  ).catch(() => null)
                : null;

            const status = text(
              membership?.status
            );

            const joinedAt =
              membership?.decidedAt ||
              membership?.approvedAt ||
              membership?.joinedAt ||
              membership?.createdAt ||
              "";

            const leftAt =
              status === "Active"
                ? ""
                : (
                    membership?.leftAt ||
                    membership?.endedAt ||
                    membership?.updatedAt ||
                    membership?.decidedAt ||
                    ""
                  );

            const role = text(
              membership?.churchRole ||
              membership?.role ||
              "Member"
            );

            return {
              membershipId: text(
                membership?.id
              ),

              kristoUserId:
                canonicalTargetUserId,

              churchId:
                historyChurchId,

              churchName: text(
                historyChurch?.name ||
                membership?.churchName ||
                historyChurchId
              ),

              role,

              joinedAt,

              leftAt,

              status,

              exitType:
                status === "Left"
                  ? "Left"
                  : status === "Banned"
                    ? "Removed"
                    : "Active",

              exitReasonPublic: text(
                membership
                  ?.exitReasonPublic
              ),
            };
          })
      )
    )
      .filter(
        (item: any) =>
          Boolean(
            item.churchId ||
            item.churchName
          )
      )
      .sort(
        (a: any, b: any) => {
          const aTime = new Date(
            a.joinedAt || 0
          ).getTime();

          const bTime = new Date(
            b.joinedAt || 0
          ).getTime();

          return (
            (Number.isFinite(bTime)
              ? bTime
              : 0) -
            (Number.isFinite(aTime)
              ? aTime
              : 0)
          );
        }
      );

  const publicChurchHistory =
    privacy.showChurchHistory
      ? verifiedMembershipHistory
      : [];

  const publicMemberSince =
    privacy.showMemberSince
      ? (
          source.createdAt ||
          source.joinedAt ||
          user.createdAt ||
          ""
        )
      : "";

  const publicProfileFact =
    privacy.showProfileFact
      ? text(
          source.profileFact ||
            source.bio
        )
      : "";

  const publicCountry =
    privacy.showCountry
      ? text(source.country)
      : "";

  const publicCity =
    privacy.showCity
      ? text(source.city)
      : "";

  const publicGender =
    privacy.showGender
      ? text(source.gender)
      : "";

  const publicMaritalStatus =
    privacy.showMaritalStatus &&
    source.maritalVisibility === "Public"
      ? text(source.maritalStatus)
      : "";

  console.log(
    "KRISTO_PUBLIC_USER_PROFILE_RETURNED",
    {
      viewerUserId,
      requestedTargetUserId:
        targetUserId,
      canonicalTargetUserId,
      hasProfile: Boolean(profile),
      hasAccount: Boolean(account),
      membershipChurchId:
        activeMembership?.churchId ||
        null,
      membershipChurchName:
        membershipChurch?.name ||
        null,
      showChurchId:
        privacy.showChurchId === true,
      showKristoId:
        privacy.showKristoId === true,
      returnedChurchId:
        churchId || null,
      returnedKristoId:
        kristoId || null,
      showGender:
        privacy.showGender === true,
      showAge:
        dobIsPublic,
      showCountry:
        privacy.showCountry === true,
      showCity:
        privacy.showCity === true,
      showMaritalStatus:
        privacy.showMaritalStatus === true,
      showLanguages:
        privacy.showLanguages === true,
      showProfileFact:
        privacy.showProfileFact === true,
      showMemberSince:
        privacy.showMemberSince === true,
      showChurchHistory:
        privacy.showChurchHistory === true,
      returnedCountry:
        publicCountry || null,
      returnedCity:
        publicCity || null,
      returnedLanguageCount:
        publicLanguages.length,
      returnedHistoryCount:
        publicChurchHistory.length,
      journeySource:
        "kristo-membership-history",
      journeyKristoUserId:
        canonicalTargetUserId,
      totalMembershipRecords:
        Array.isArray(membershipHistory)
          ? membershipHistory.length
          : 0,
    }
  );

  return NextResponse.json({
    ok: true,
    profile: {
      userId:
        canonicalTargetUserId,

      journeyIdentity: {
        userId:
          canonicalTargetUserId,
        kristoId: text(
          source.userCode ||
          source.kristoId ||
          source.publicKristoId
        ),
      },

      fullName,
      avatarUrl,

      profileFact:
        publicProfileFact,

      bio:
        publicProfileFact,

      churchName,
      churchId,
      role,
      churchRole: role,
      kristoId,

      gender:
        publicGender,

      dob:
        publicDob,

      age:
        publicAge,

      maritalStatus:
        publicMaritalStatus,

      country:
        publicCountry,

      city:
        publicCity,

      languages:
        publicLanguages,

      memberSince:
        publicMemberSince,

      joinedAt:
        publicMemberSince,

      createdAt:
        publicMemberSince,

      churchHistory:
        publicChurchHistory,

      churchesJoinedCount:
        publicChurchHistory.length,

      churchCount:
        publicChurchHistory.length,

      publicVisibility: {
        showGender:
          privacy.showGender === true,
        showAge:
          dobIsPublic,
        showCountry:
          privacy.showCountry === true,
        showCity:
          privacy.showCity === true,
        showMaritalStatus:
          privacy.showMaritalStatus === true,
        showLanguages:
          privacy.showLanguages === true,
        showProfileFact:
          privacy.showProfileFact === true,
        showMemberSince:
          privacy.showMemberSince === true,
        showChurchHistory:
          privacy.showChurchHistory === true,
      },
    },
  });
}
