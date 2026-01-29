import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createChallenge, findUserByIdentifier, seedUserIfMissing, type IdentifierType } from "@/app/api/auth/_lib/session";

export async function POST(req: NextRequest) {
  seedUserIfMissing();

  const body = await req.json().catch(() => ({}));
  const identifierType = String(body?.identifierType || "").toLowerCase() as IdentifierType;
  const identifier = String(body?.identifier || "");
  const password = String(body?.password || "");

  if (identifierType !== "email" && identifierType !== "phone") {
    return NextResponse.json({ ok: false, error: "Chagua Email au Phone." }, { status: 400 });
  }
  if (!identifier.trim()) return NextResponse.json({ ok: false, error: "Weka email/phone." }, { status: 400 });
  if (!password) return NextResponse.json({ ok: false, error: "Weka password." }, { status: 400 });

  const u = findUserByIdentifier(identifierType, identifier);
  if (!u) return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 401 });
  if (u.password !== password) return NextResponse.json({ ok: false, error: "Password si sahihi." }, { status: 401 });

  const ch = createChallenge({ identifierType, identifier: identifier.trim(), userId: u.id });

  // DEV delivery: show code in server console
  console.log(`\n[KRISTO OTP] (${identifierType}) ${identifier.trim()}  CODE: ${ch.code}  (expires in 10min)\n`);

  return NextResponse.json({ ok: true, challengeId: ch.id });
}
