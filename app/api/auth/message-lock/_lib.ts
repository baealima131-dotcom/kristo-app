import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { auditMessageLockEvent } from "@/app/api/_lib/messageLock";
import { MessageLockStoreUnavailableError } from "@/app/api/_lib/store/messageLockDb";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function requireMessageLockUser(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = String(auth.viewer.userId || "").trim();
  if (!userId) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return { userId };
}

export async function enforceMessageLockIpThrottle(
  req: NextRequest,
  name: string
) {
  const rl = await rateLimit(req, {
    name,
    limit: 40,
    windowMs: 5 * 60 * 1000,
  });
  if (!rl.allowed) {
    return json(
      {
        ok: false,
        error: "Too many requests. Please wait and try again.",
        retryAfterSec: Math.ceil(rl.resetInMs / 1000),
      },
      { status: 429 }
    );
  }
  return null;
}

export function storeUnavailableResponse(userId: string) {
  auditMessageLockEvent("store_unavailable", userId);
  return json(
    {
      ok: false,
      error: "Message Lock is temporarily unavailable. Please try again later.",
      code: "MESSAGE_LOCK_STORE_UNAVAILABLE",
    },
    { status: 503 }
  );
}

export function isStoreUnavailable(e: unknown): boolean {
  return e instanceof MessageLockStoreUnavailableError;
}
