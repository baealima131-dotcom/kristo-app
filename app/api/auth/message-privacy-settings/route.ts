import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import {
  validateMessagePrivacySettingsPatch,
} from "@/app/api/_lib/messagePrivacySettings";
import {
  getMessagePrivacySettings,
  patchMessagePrivacySettings,
} from "@/app/api/_lib/store/messagePrivacySettingsDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function GET(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  if (!userId) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getMessagePrivacySettings(userId);
  return json({ ok: true, data: settings });
}

export async function PATCH(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const userId = String(auth.viewer.userId || "").trim();
  if (!userId) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const validated = validateMessagePrivacySettingsPatch(body);
  if (!validated.ok) {
    return json(
      {
        ok: false,
        error: "Invalid settings.",
        details: validated.errors,
      },
      { status: 400 }
    );
  }

  if (Object.keys(validated.patch).length === 0) {
    const current = await getMessagePrivacySettings(userId);
    return json({ ok: true, data: current });
  }

  const settings = await patchMessagePrivacySettings({
    userId,
    patch: validated.patch,
  });

  return json({ ok: true, data: settings });
}
