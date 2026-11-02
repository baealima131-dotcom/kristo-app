import { NextResponse } from "next/server";
import { getUserById, readSession, seedUserIfMissing, touchSession } from "@/app/api/auth/_lib/session";
import { ensureProfileDraft, getProfile } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await seedUserIfMissing();

  // Verified session only (signed token or server cookie); x-kristo-user-id alone is not enough.
  const sess = await readSession(req);
  const u = sess ? await getUserById(sess.userId) : null;

  if (sess?.id) await touchSession(sess.id);

  if (!u) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const p0 = (await getProfile(u.id)) || (await ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone }));

  return NextResponse.json({
    ok: true,
    viewer: { userId: u.id, email: u.email || "", phone: u.phone || "" },
    profile: p0,
  });
}
