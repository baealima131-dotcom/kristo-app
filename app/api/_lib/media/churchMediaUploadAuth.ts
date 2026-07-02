import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard, type GuardContext } from "@/app/api/_lib/rbac";
import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";

export type ChurchMediaUploadContext = GuardContext & {
  access: Awaited<ReturnType<typeof evaluateChurchMediaAccess>>;
};

export async function guardChurchMediaUpload(
  req: NextRequest
): Promise<ChurchMediaUploadContext | NextResponse> {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const access = await evaluateChurchMediaAccess({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
  });

  if (!access.canUseMediaTools) {
    const error = !access.canOpenMediaScreen
      ? "Only the church Pastor or assigned media hosts can upload church media."
      : "Media Premium subscription is required to upload church media.";

    return NextResponse.json({ ok: false, error }, { status: 403 });
  }

  return { ...ctxOrRes, access };
}
