import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listPastorOwnedChurches } from "@/app/api/_lib/subscriptionOwnershipLock";
import { getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import { logAuthRequestDiag, resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
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

export async function POST(req: NextRequest) {
  logAuthRequestDiag(req, "delete-account-precheck");
  const auth = resolveRequestUserId(req);
  if (!auth.userId) {
    return json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const userId = await resolveRealUserId(auth.userId);
  if (!userId) {
    return json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const pastorOwnsChurches = await listPastorOwnedChurches(userId);

  return json({
    ok: true,
    canDeleteAccount: pastorOwnsChurches.length === 0,
    pastorOwnsChurches,
  });
}
