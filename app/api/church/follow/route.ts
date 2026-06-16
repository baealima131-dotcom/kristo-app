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
import { isCoreDatabaseError, resolveCoreStoreMode } from "@/app/api/_lib/store/coreDb";

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
    storeMode: resolveCoreStoreMode(),
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
  console.error("KRISTO_CHURCH_FOLLOW_ERROR", {
    path: "/api/church/follow",
    status,
    error,
    storeMode: resolveCoreStoreMode(),
    ...(extra || {}),
  });
}

function formatRouteError(error: unknown) {
  const err = error as Error;
  return {
    message: String(err?.message || error || "Internal server error"),
    stack: err?.stack || null,
    name: err?.name || "Error",
  };
}

function handleRouteFailure(method: string, error: unknown, extra?: Record<string, unknown>) {
  const formatted = formatRouteError(error);
  const status = isCoreDatabaseError(error) ? 503 : 500;

  logFollowError(status, formatted.message, {
    method,
    stack: formatted.stack,
    errorName: formatted.name,
    ...(extra || {}),
  });

  return json(
    {
      ok: false,
      error: isCoreDatabaseError(error) ? "Church follow store unavailable" : "Follow request failed",
      details: {
        message: formatted.message,
        ...(process.env.NODE_ENV !== "production" ? { stack: formatted.stack } : {}),
      },
    },
    { status }
  );
}

export async function GET(req: NextRequest) {
  const method = "GET";
  try {
    logFollowRequest(method, {
      churchId: normalizeChurchId(new URL(req.url).searchParams.get("churchId")) || null,
    });

    const authDiag = logAuthRequestDiag(req, "church-follow-get");
    const authOrRes = await guardAuth(req);
    if (authOrRes instanceof NextResponse) {
      const body = await authOrRes.clone().json().catch(() => null);
      logFollowError(authOrRes.status, String(body?.error || "Unauthorized"), {
        method,
        resolvedUserId: authDiag.resolved.userId || null,
        authVia: authDiag.resolved.via,
        authReason: authDiag.resolved.reason || null,
      });
      return authOrRes;
    }

    const churchId = normalizeChurchId(new URL(req.url).searchParams.get("churchId"));
    if (!churchId) {
      logFollowError(400, "churchId missing", {
        method,
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
      method,
      churchId,
      resolvedUserId: userId,
    });
    return json(payload);
  } catch (error) {
    return handleRouteFailure(method, error);
  }
}

export async function POST(req: NextRequest) {
  const method = "POST";
  try {
    const authDiag = logAuthRequestDiag(req, "church-follow-post");
    const authOrRes = await guardAuth(req);
    if (authOrRes instanceof NextResponse) {
      const body = await authOrRes.clone().json().catch(() => null);
      logFollowError(authOrRes.status, String(body?.error || "Unauthorized"), {
        method,
        resolvedUserId: authDiag.resolved.userId || null,
        authVia: authDiag.resolved.via,
        authReason: authDiag.resolved.reason || null,
      });
      return authOrRes;
    }

    const userId = String(authOrRes.viewer.userId || "").trim();
    const body = await req.json().catch((parseError) => {
      logFollowError(400, "Invalid JSON body", {
        method,
        resolvedUserId: userId,
        stack: formatRouteError(parseError).stack,
      });
      return null;
    });

    if (body === null) {
      return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const churchId = normalizeChurchId(body?.churchId);
    const following = parseFollowingFlag(body?.following);

    logFollowRequest(method, {
      churchId: churchId || null,
      following,
      resolvedUserId: userId,
      requestBodyKeys: Object.keys(body || {}),
    });

    if (!churchId) {
      logFollowError(400, "churchId missing", { method, resolvedUserId: userId, requestBody: body });
      return json({ ok: false, error: "churchId missing" }, { status: 400 });
    }

    if (following === null) {
      logFollowError(400, "following must be true or false", {
        method,
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
      method,
      churchId,
      resolvedUserId: userId,
    });
    return json(payload);
  } catch (error) {
    return handleRouteFailure(method, error, {
      note: "POST /api/church/follow failed after auth",
    });
  }
}

/** @deprecated Prefer POST { churchId, following: false } */
export async function DELETE(req: NextRequest) {
  const method = "DELETE";
  try {
    const authDiag = logAuthRequestDiag(req, "church-follow-delete");
    const authOrRes = await guardAuth(req);
    if (authOrRes instanceof NextResponse) {
      const body = await authOrRes.clone().json().catch(() => null);
      logFollowError(authOrRes.status, String(body?.error || "Unauthorized"), {
        method,
        resolvedUserId: authDiag.resolved.userId || null,
        authVia: authDiag.resolved.via,
        authReason: authDiag.resolved.reason || null,
      });
      return authOrRes;
    }

    const userId = String(authOrRes.viewer.userId || "").trim();
    const churchId = normalizeChurchId(new URL(req.url).searchParams.get("churchId"));
    logFollowRequest(method, { churchId: churchId || null, resolvedUserId: userId });

    if (!churchId) {
      logFollowError(400, "churchId missing", { method, resolvedUserId: userId });
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

    logFollowResponse(200, payload, { method, churchId, resolvedUserId: userId });
    return json(payload);
  } catch (error) {
    return handleRouteFailure(method, error);
  }
}
