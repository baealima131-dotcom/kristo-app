import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { seedUserIfMissing, findUserByIdentifier } from "@/app/api/auth/_lib/session";

/** Identifiers are hashed before they are used as rate-limit keys (the store is a plain file). */
function lookupKeyHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export const runtime = "nodejs";

type Body = {
  identifierType: "email" | "phone";
  identifier: string;
};

function maskEmail(email: string) {
  const v = String(email || "").trim().toLowerCase();
  const [name, domain] = v.split("@");
  if (!name || !domain) return v;
  const left = name.length <= 2 ? `${name[0] || ""}*` : `${name.slice(0, 2)}***`;
  return `${left}@${domain}`;
}

function maskPhone(phone: string) {
  const v = String(phone || "").trim();
  if (v.length <= 4) return "***";
  return `${"*".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
}

export async function POST(req: NextRequest) {
  await seedUserIfMissing();

  const body = (await req.json().catch(() => ({}))) as Partial<Body>;
  const identifierType = body.identifierType;
  const identifier = String(body.identifier || "").trim();

  if (identifierType !== "email" && identifierType !== "phone") {
    return NextResponse.json({ ok: false, error: "Identifier type si sahihi." }, { status: 400 });
  }

  if (!identifier) {
    return NextResponse.json({ ok: false, error: "Weka email au phone." }, { status: 400 });
  }

  // Account lookups reveal whether an identifier exists: limit per IP and per identifier.
  for (const rl of [
    await rateLimit(req, { name: "recover-username", limit: 10, windowMs: 15 * 60 * 1000 }),
    await rateLimit(req, { name: "recover-username-id", limit: 5, windowMs: 15 * 60 * 1000, key: `recover-username-id:${lookupKeyHash(`${identifierType}:${identifier.toLowerCase()}`)}` }),
  ]) {
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Please wait and try again.", retryAfterSec: Math.ceil(rl.resetInMs / 1000) },
        { status: 429 }
      );
    }
  }

  const user = await findUserByIdentifier(identifierType, identifier);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    // No internal userId: it is not needed to recover a username.
    data: {
      email: user.email ? maskEmail(user.email) : "",
      phone: user.phone ? maskPhone(user.phone) : "",
    },
  });
}
