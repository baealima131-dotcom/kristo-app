import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getProfile,
  getProfileByUserCode,
} from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";
import { getActiveMembership } from "@/app/api/_lib/memberships";
import { getChurchById } from "@/app/api/_lib/churches";
import { normalizePrivacy } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value || "").trim();
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

  const activeMembership =
    await getActiveMembership(
      canonicalTargetUserId
    ).catch(() => null);

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
    }
  );

  return NextResponse.json({
    ok: true,
    profile: {
      userId:
        canonicalTargetUserId,
      fullName,
      avatarUrl,
      bio: text(source.bio),
      phone: "",
      city: text(source.city),
      country: text(source.country),
      profileStatus:
        source.profileStatus ||
        "Complete",
      kristoId,
      publicKristoId: kristoId,
      churchIdPublic:
        Boolean(privacy.showChurchId),
      kristoIdPublic:
        Boolean(privacy.showKristoId),
      churchId,
      activeChurchId: churchId,
      churchName,
      role,
      churchRole: role,
      updatedAt: Number(
        source.updatedAt ||
          source.avatarUpdatedAt ||
          0
      ),
    },
  });
}
