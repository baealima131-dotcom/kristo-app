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
  dbListSafetyRolesForUser,
} from "@/app/api/_lib/store/safetyDb";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const roles =
    await dbListSafetyRolesForUser(
      auth.viewer.userId
    );

  return NextResponse.json({
    ok: true,
    roles,
    isSafetySupervisor:
      roles.some(
        (row) =>
          row.role ===
          "Safety_Supervisor"
      ),
    isSafetyAgent:
      roles.some(
        (row) =>
          row.role ===
          "Safety_Agent"
      ),
  });
}
