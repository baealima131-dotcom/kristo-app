import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";
import {
  dbListPendingSafetyInvitationsForUser,
} from "@/app/api/_lib/store/safetyDb";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const invitations =
    await dbListPendingSafetyInvitationsForUser(
      auth.viewer.userId
    );

  return NextResponse.json({
    ok: true,
    invitations,
  });
}
