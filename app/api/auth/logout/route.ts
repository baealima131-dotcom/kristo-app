import { NextResponse } from "next/server";
import { clearSessionCookie, invalidateUserSessions, readSession } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sess = await readSession(req);
  if (sess?.userId) invalidateUserSessions(sess.userId);

  let res = NextResponse.json({ ok: true });
  res = clearSessionCookie(res);
  return res;
}
