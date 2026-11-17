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

function maskEmail(email: string) {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}***@${domain}`;
}

export async function POST(req: NextRequest) {
  await seedUserIfMissing();

  const body = await req.json().catch(() => ({}));
  const phone = String(body?.phone || "").trim();

  if (phone.length < 6) {
    return NextResponse.json({ ok: false, error: "Enter a valid phone number." }, { status: 400 });
  }

  const digits = phone.replace(/\D/g, "");

  // Account lookups reveal whether an identifier exists: limit per IP and per identifier.
  for (const rl of [
    await rateLimit(req, { name: "find-account", limit: 10, windowMs: 15 * 60 * 1000 }),
    await rateLimit(req, { name: "find-account-id", limit: 5, windowMs: 15 * 60 * 1000, key: `find-account-id:${lookupKeyHash(digits)}` }),
  ]) {
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Please wait and try again.", retryAfterSec: Math.ceil(rl.resetInMs / 1000) },
        { status: 429 }
      );
    }
  }
  const candidates = Array.from(new Set([
    phone,
    digits,
    digits.length === 10 ? `1${digits}` : digits,
    digits.length === 10 ? `+1 ${digits}` : phone,
  ]));

  let user = null;
  for (const candidate of candidates) {
    user = await findUserByIdentifier("phone", candidate);
    if (user) break;
  }

  if (!user) {
    return NextResponse.json({ ok: false, error: "No account found with this phone number." }, { status: 404 });
  }

  const email = String(user.email || "");
  return NextResponse.json({
    ok: true,
    phone,
    email: maskEmail(email),
  });
}
