import { NextRequest, NextResponse } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { loadAdminPartiesForCases } from "@/app/api/_lib/sokoProtectionAdminParty";
import {
  dbListAdminSokoProtectionCases,
  publicProtectionCaseView,
} from "@/app/api/_lib/store/sokoProtectionDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" },
  });
}

export async function GET(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const state = req.nextUrl.searchParams.get("state") || "";
    const paymentVerificationKind =
      req.nextUrl.searchParams.get("paymentVerificationKind") || "";
    const cases = await dbListAdminSokoProtectionCases({
      state,
      paymentVerificationKind,
    });
    const views = cases.map((row) => publicProtectionCaseView(row));
    const parties = await loadAdminPartiesForCases(views);
    return reply({
      ok: true,
      cases: views.map((row, index) => ({
        ...row,
        parties: parties[index],
      })),
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load protection admin queue.",
      },
      500
    );
  }
}
