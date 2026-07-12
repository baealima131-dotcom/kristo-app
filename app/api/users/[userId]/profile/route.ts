import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

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

  const [profile, account] =
    await Promise.all([
      getProfile(targetUserId).catch(
        () => null
      ),
      getUserById(targetUserId).catch(
        () => null
      ),
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

  const churchId = text(
    source.churchId ||
      source.activeChurchId ||
      user.churchId ||
      user.activeChurchId
  );

  const churchName = text(
    source.churchName ||
      source.activeChurchName ||
      user.churchName ||
      user.activeChurchName
  );

  const role = text(
    source.role ||
      source.churchRole ||
      user.role ||
      user.churchRole ||
      "Member"
  );

  console.log(
    "KRISTO_PUBLIC_USER_PROFILE_RETURNED",
    {
      viewerUserId,
      targetUserId,
      hasProfile: Boolean(profile),
      hasAccount: Boolean(account),
    }
  );

  return NextResponse.json({
    ok: true,
    profile: {
      userId: targetUserId,
      fullName,
      avatarUrl,
      bio: text(source.bio),
      phone: "",
      city: text(source.city),
      country: text(source.country),
      profileStatus:
        source.profileStatus ||
        "Complete",
      kristoId: text(
        source.kristoId ||
          source.publicKristoId
      ),
      publicKristoId: text(
        source.publicKristoId ||
          source.kristoId
      ),
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
