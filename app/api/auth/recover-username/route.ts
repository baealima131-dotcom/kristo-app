import { NextResponse } from "next/server";
import { seedUserIfMissing, findUserByIdentifier } from "@/app/api/auth/_lib/session";

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

export async function POST(req: Request) {
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

  const user = await findUserByIdentifier(identifierType, identifier);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Account haipo." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      userId: user.id,
      email: user.email ? maskEmail(user.email) : "",
      phone: user.phone ? maskPhone(user.phone) : "",
    },
  });
}
