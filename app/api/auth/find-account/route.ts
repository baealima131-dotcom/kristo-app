import { NextResponse } from "next/server";
import { seedUserIfMissing, findUserByIdentifier } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

function maskEmail(email: string) {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}***@${domain}`;
}

export async function POST(req: Request) {
  await seedUserIfMissing();

  const body = await req.json().catch(() => ({}));
  const phone = String(body?.phone || "").trim();

  if (phone.length < 6) {
    return NextResponse.json({ ok: false, error: "Enter a valid phone number." }, { status: 400 });
  }

  const digits = phone.replace(/\D/g, "");
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
