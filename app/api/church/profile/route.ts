import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getChurchById, patchChurchProfile } from "@/app/api/_lib/churches";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { resolveActorFromViewer } from "@/app/api/_lib/notificationActor";
import { addNotification } from "@/app/api/_lib/notifications";
import { isChurchDatabaseError } from "@/app/api/_lib/store/churchDb";
import { hasDurableStore } from "@/app/api/_lib/store/authDb";

export const runtime = "nodejs";

type ApiErr = { ok: false; error: string; reason?: string; details?: unknown };

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

const MAX_AVATAR_DATA_URL_LEN = 2_800_000;

async function saveChurchAvatarData(churchId: string, avatarData: unknown) {
  const raw = String(avatarData || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("data:image/")) return "";

  const match = raw.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return "";

  // Vercel/serverless: no writable public/ — store data URL in Postgres profile JSON.
  if (isServerlessRuntime()) {
    if (raw.length > MAX_AVATAR_DATA_URL_LEN) {
      throw new Error("Avatar image is too large. Choose a smaller photo (max ~2MB).");
    }
    return raw;
  }

  const ext = match[1].toLowerCase().replace("jpeg", "jpg");
  const b64 = match[2];
  const dir = path.join(process.cwd(), "public", "uploads", "church-avatars");
  await fs.mkdir(dir, { recursive: true });

  const safeChurchId = churchId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const file = `${safeChurchId}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(dir, file), Buffer.from(b64, "base64"));

  return `/uploads/church-avatars/${file}`;
}

function asBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return req.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function profileLog(label: string, details?: Record<string, unknown>) {
  if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
    console.log(`[church/profile] ${label}`, details || {});
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
    if (ctxOrRes instanceof NextResponse) return ctxOrRes;

    const churchId = ctxOrRes.churchId;
    const profile = await getChurchById(churchId);

    return json({
      ok: true,
      data: {
        id: churchId,
        name: profile?.name || churchId,
        address: profile?.address || "",
        phone: profile?.phone || "",
        country: (profile as any)?.country || "",
        province: (profile as any)?.province || "",
        city: (profile as any)?.city || "",
        primaryLanguage: (profile as any)?.primaryLanguage || "",
        pastorName: profile?.pastorName || "",
        avatarUri: (profile as any)?.avatarUri || (profile as any)?.avatarUrl || "",
        avatarUrl: (profile as any)?.avatarUrl || (profile as any)?.avatarUri || "",
      },
      storeMode: hasDurableStore() ? "postgres" : "local-json",
    });
  } catch (error: any) {
    console.error("[church/profile] GET failed", error);
    return json(
      {
        ok: false,
        error: String(error?.message || error || "Failed to load church profile"),
        reason: "church_profile_get_failed",
      } satisfies ApiErr,
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const headerUserId = String(req.headers.get("x-kristo-user-id") || "").trim();
  const headerRole = String(req.headers.get("x-kristo-role") || "").trim();
  const headerChurchId = String(req.headers.get("x-kristo-church-id") || "").trim();

  profileLog("PATCH request", {
    "x-kristo-user-id": headerUserId,
    "x-kristo-role": headerRole,
    "x-kristo-church-id": headerChurchId,
    storeMode: hasDurableStore() ? "postgres" : "local-json",
  });

  try {
    const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
    if (ctxOrRes instanceof NextResponse) return ctxOrRes;

    const body = await asBody(req);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body", reason: "invalid_json" } satisfies ApiErr, { status: 400 });
    }

    const churchId = ctxOrRes.churchId;
    const viewer = ctxOrRes.viewer;
    const before = await getChurchById(churchId);

    const uploadedAvatarUrl = await saveChurchAvatarData(churchId, body.avatarData);
    const avatarFromBody = String(body.avatarUri || body.avatarUrl || "").trim();
    const avatarUri = uploadedAvatarUrl || avatarFromBody || undefined;
    const avatarUrl = uploadedAvatarUrl || String(body.avatarUrl || body.avatarUri || "").trim() || undefined;

    profileLog("PATCH apply", {
      churchId,
      userId: viewer.userId,
      hasAvatarData: Boolean(String(body.avatarData || "").trim()),
      uploadedAvatar: Boolean(uploadedAvatarUrl),
      fields: {
        name: body.name,
        pastorName: body.pastorName,
        phone: body.phone,
        address: body.address,
      },
    });

    const saved = await patchChurchProfile(churchId, {
      name: body.name,
      address: body.address,
      phone: body.phone,
      country: body.country,
      province: body.province,
      city: body.city,
      primaryLanguage: body.primaryLanguage,
      pastorName: body.pastorName,
      avatarUri,
      avatarUrl,
    });

    const activeMembers = await getMembershipsForChurch(churchId, "Active");

    const prevName = String(before?.name || churchId);
    const nextName = String(saved.name || churchId);
    const actor = await resolveActorFromViewer(viewer, req);
    const actorName = actor.actorName || "A leader";

    const message =
      prevName !== nextName
        ? `${actorName} updated church profile: name changed from ${prevName} to ${nextName}.`
        : `${actorName} updated church profile for ${nextName}.`;

    for (const m of activeMembers) {
      if (!m.userId) continue;
      addNotification({
        churchId,
        type: "ChurchProfileUpdated",
        title: "Church profile updated",
        message,
        targetUserId: m.userId,
        actorName,
        actorUserId: actor.actorUserId || viewer.userId,
        actorAvatarUri: actor.actorAvatarUri || undefined,
        actorRole: actor.actorRole || viewer.role,
      });
    }

    return json({
      ok: true,
      data: {
        id: saved.id,
        name: saved.name || saved.id,
        address: saved.address || "",
        phone: saved.phone || "",
        country: (saved as any).country || "",
        province: (saved as any).province || "",
        city: (saved as any).city || "",
        primaryLanguage: (saved as any).primaryLanguage || "",
        pastorName: saved.pastorName || "",
        avatarUri: (saved as any).avatarUri || (saved as any).avatarUrl || "",
        avatarUrl: (saved as any).avatarUrl || (saved as any).avatarUri || "",
        updatedAt: saved.updatedAt || saved.createdAt,
        notifiedMembers: activeMembers.filter((m) => !!m.userId).length,
      },
      storeMode: hasDurableStore() ? "postgres" : "local-json",
    });
  } catch (error: any) {
    if (isChurchDatabaseError(error)) {
      return json(
        { ok: false, error: "Church database not configured", reason: "missing_db" } satisfies ApiErr,
        { status: 503 }
      );
    }

    const message = String(error?.message || error || "Failed to save church profile");
    console.error("[church/profile] PATCH failed", {
      message,
      userId: headerUserId,
      churchId: headerChurchId,
      stack: error?.stack,
    });

    return json(
      {
        ok: false,
        error: message,
        reason: "church_profile_patch_failed",
        details: process.env.NODE_ENV !== "production" ? { stack: String(error?.stack || "") } : undefined,
      } satisfies ApiErr,
      { status: 500 }
    );
  }
}
