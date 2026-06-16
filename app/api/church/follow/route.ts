import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { logAuthRequestDiag } from "@/app/api/auth/_lib/sessionToken";
import { guardAuth } from "@/app/api/_lib/rbac";
import {
  countChurchFollowers,
  isUserFollowingChurch,
  loadChurchFollowEdges,
  normalizeChurchId,
  removeChurchFollow,
  upsertChurchFollow,
} from "@/app/api/_lib/churchFollows";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function parseFollowingFlag(value: unknown): boolean | null {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function logFollowRequest(method: string, extra?: Record<string, unknown>) {
  console.log("KRISTO_CHURCH_FOLLOW_REQUEST", {
    method,
    path: "/api/church/follow",
    ...(extra || {}),
  });
}

function logFollowResponse(status: number, body: unknown, extra?: Record<string, unknown>) {
  console.log("KRISTO_CHURCH_FOLLOW_RESPONSE", {
    path: "/api/church/follow",
    status,
    body,
    ...(extra || {}),
  });
}

function logFollowError(status: number, error: string, extra?: Record<string, unknown>) {
  console.log("KRISTO_CHURCH_FOLLOW_ERROR", {
    path: "/api/church/follow",
    status,
    error,
    ...(extra || {}),
  });
}

export async function GET(req: NextRequest) {
  logFollowRequest("GET", {
    churchId: normalizeChurchId(new URL(req.url).searchParams.get("churchId")) || null,
  });

  const authDiag = logAuthRequestDiag(req, "church-follow-get");
  const authOrRes = await guardAuth(req);
  if (authOrRes instanceof NextResponse) {
    const body = await authOrRes.clone().json().catch(() => null);
    logFollowError(authOrRes.status, String(body?.error || "Unauthorized"), {
      resolvedUserId: authDiag.resolved.userId || null,
      authVia: authDiag.resolved.via,
      authReason: authDiag.resolved.reason || null,
    });
    return authOrRes;
  }

  const churchId = normalizeChurchId(new URL(req.url).searchParams.get("churchId"));
  if (!churchId) {
    logFollowError(400, "churchId missing", {
      resolvedUserId: authOrRes.viewer.userId,
    });
    return json({ ok: false, error: "churchId missing" }, { status: 400 });
  }

  const userId = String(authOrRes.viewer.userId || "").trim();
  const edges = await loadChurchFollowEdges();
  const following = isUserFollowingChurch(userId, churchId, edges);
  const followerCount = countChurchFollowers(churchId, edges);

  const payload = {
    ok: true,
    churchId,
    following,
    followerCount,
  };

  logFollowResponse(200, payload, {
    churchId,
    resolvedUserId: userId,
  });
  return json(payload);
}

export async function POST(req: NextRequest) {
  const authDiag = logAuthRequestDiag(req, "church-follow-post");
  const authOrRes = await guardAuth(req);
  if (authOrRes instanceof NextResponse) {
    const body = await authOrRes.clone().json().catch(() => null);
    logFollowError(authOrRes.status, String(body?.error || "Unauthorized"), {
      resolvedUserId: authDiag.resolved.userId || null,
      authVia: authDiag.resolved.via,
      authReason: authDiag.resolved.reason || null,
    });
    return authOrRes;
  }

  const userId = String(authOrRes.viewer.userId || "").trim();
  const body = await req.json().catch(() => ({}));
  const churchId = normalizeChurchId(body?.churchId);
  const following = parseFollowingFlag(body?.following);

  logFollowRequest("POST", {
    churchId: churchId || null,
    following,
    resolvedUserId: userId,
  });

  if (!churchId) {
    logFollowError(400, "churchId missing", { resolvedUserId: userId, requestBody: body });
    return json({ ok: false, error: "churchId missing" }, { status: 400 });
  }

  if (following === null) {
    logFollowError(400, "following must be true or false", {
      resolvedUserId: userId,
      requestBody: body,
    });
    return json({ ok: false, error: "following must be true or false" }, { status: 400 });
  }

  const edges = following
    ? await upsertChurchFollow(userId, churchId)
    : await removeChurchFollow(userId, churchId);
  const followerCount = countChurchFollowers(churchId, edges);

  const payload = {
    ok: true,
    churchId,
    following,
    followerCount,
  };

  logFollowResponse(200, payload, {
    churchId,
    resolvedUserId: userId,
  });
  return json(payload);
}

/** @deprecated Prefer POST { churchId, following: false } */
export async function DELETE(req: NextRequest) {
  const authDiag = logAuthRequestDiag(req, "church-follow-delete");
  const authOrRes = await guardAuth(req);
  if (authOrRes instanceof NextResponse) {
    const body = await authOrRes.clone().json().catch(() => null);
    logFollowError(authOrRes.status, String(body?.error || "Unauthorized"), {
      resolvedUserId: authDiag.resolved.userId || null,
      authVia: authDiag.resolved.via,
      authReason: authDiag.resolved.reason || null,
    });
    return authOrRes;
  }

  const userId = String(authOrRes.viewer.userId || "").trim();
  const churchId = normalizeChurchId(new URL(req.url).searchParams.get("churchId"));
  logFollowRequest("DELETE", { churchId: churchId || null, resolvedUserId: userId });

  if (!churchId) {
    logFollowError(400, "churchId missing", { resolvedUserId: userId });
    return json({ ok: false, error: "churchId missing" }, { status: 400 });
  }

  const edges = await removeChurchFollow(userId, churchId);
  const followerCount = countChurchFollowers(churchId, edges);
  const payload = {
    ok: true,
    churchId,
    following: false,
    followerCount,
  };

  logFollowResponse(200, payload, { churchId, resolvedUserId: userId });
  return json(payload);
}
