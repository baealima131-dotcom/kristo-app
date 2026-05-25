import { NextResponse } from "next/server";
import { getUserById, readSession, seedUserIfMissing, touchSession } from "@/app/api/auth/_lib/session";
import { ensureProfileDraft, getProfile } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

async function resolveAuthedUser(req: Request) {
  const headerUserId = String(req.headers.get("x-kristo-user-id") || "").trim();
  if (!headerUserId) return null;
  return getUserById(headerUserId);
}

export async function GET(req: Request) {
  await seedUserIfMissing();

  const sess = await readSession(req);
  let u = sess ? await getUserById(sess.userId) : null;

  if (sess?.id) await touchSession(sess.id);

  if (!u) {
    u = await resolveAuthedUser(req);
  }

  if (!u) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const p0 = (await getProfile(u.id)) || (await ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone }));

  return NextResponse.json({
    ok: true,
    viewer: { userId: u.id, email: u.email || "", phone: u.phone || "" },
    profile: p0,
  });
}
