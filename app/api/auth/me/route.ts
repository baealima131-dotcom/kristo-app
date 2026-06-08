import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getUserById,
  readSession,
  seedUserIfMissing,
  SESSION_COOKIE,
  touchSession,
} from "@/app/api/auth/_lib/session";
import { resolveRequestUserId } from "@/app/api/auth/_lib/sessionToken";
import { ensureProfileDraft, getProfile } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await seedUserIfMissing();

  const headerAuth = resolveRequestUserId(req);
  const cookieSid = (await cookies()).get(SESSION_COOKIE)?.value || "";

  console.log("KRISTO_AUTH_ME_HEADER_TOKEN_RESULT", {
    via: headerAuth.via,
    ok: Boolean(headerAuth.userId),
    userId: headerAuth.userId || null,
    reason: headerAuth.reason || null,
    hasCookie: Boolean(cookieSid),
    hasHeaderUserId: Boolean(req.headers.get("x-kristo-user-id")),
    hasHeaderToken: Boolean(req.headers.get("x-kristo-session-token")),
    headerTokenLen: String(req.headers.get("x-kristo-session-token") || "").length,
  });

  // Prefer stateless header token auth (survives serverless instance rotation).
  if (headerAuth.userId) {
    const headerUser = await getUserById(headerAuth.userId);
    if (headerUser) {
      const profile =
        (await getProfile(headerUser.id)) ||
        (await ensureProfileDraft({
          userId: headerUser.id,
          email: headerUser.email,
          phone: headerUser.phone,
        }));

      return NextResponse.json({
        ok: true,
        authVia: headerAuth.via,
        viewer: {
          userId: headerUser.id,
          email: headerUser.email || "",
          phone: headerUser.phone || "",
        },
        profile,
      });
    }

    console.log("KRISTO_AUTH_ME_HEADER_TOKEN_RESULT", {
      ok: false,
      reason: "user-not-found",
      userId: headerAuth.userId,
    });
  }

  const sess = await readSession(req);
  let u = sess ? await getUserById(sess.userId) : null;

  if (sess?.id) await touchSession(sess.id);

  if (!u) {
    console.log("KRISTO_AUTH_ME_HEADER_TOKEN_RESULT", {
      ok: false,
      reason: "unauthorized",
      hadCookie: Boolean(cookieSid),
      hadHeaderToken: Boolean(req.headers.get("x-kristo-session-token")),
    });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const p0 =
    (await getProfile(u.id)) ||
    (await ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone }));

  return NextResponse.json({
    ok: true,
    authVia: cookieSid ? "cookie" : "session",
    viewer: { userId: u.id, email: u.email || "", phone: u.phone || "" },
    profile: p0,
  });
}
