import { NextResponse } from "next/server";
import {
  getUserById,
  readSession,
  seedUserIfMissing,
  touchSession,
} from "@/app/api/auth/_lib/session";
import {
  computeProfileStatus,
  ensureProfileDraft,
  getProfile,
  upsertProfile,
  type Gender,
} from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

type Body = {
  fullName?: string;
  gender?: Gender;
  dob?: string;
  phone?: string;
  country?: string;
  city?: string;

  // MVP privacy tweaks (optional)
  dobVisibility?: "Private" | "CorePastor" | "Public";
  maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";
  maritalVisibility?: "Private" | "CorePastor" | "Public";
  avatarUrl?: string;
};

function norm(s: any) {
  return String(s ?? "").trim();
}

/**
 * GET /api/auth/profile
 * Returns current user's profile (creates draft if missing).
 */
export async function GET() {
  seedUserIfMissing();

  const sess = await readSession();
  if (!sess) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  touchSession(sess.id);

  const u = getUserById(sess.userId);
  if (!u) return NextResponse.json({ ok: false, error: "User haipo." }, { status: 404 });

  const current = getProfile(u.id) || ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone });

  // ensure status is always consistent (even for older drafts)
  const next = {
    ...current,
    profileStatus: computeProfileStatus({
      fullName: norm(current.fullName),
      phone: norm(current.phone),
      dob: norm(current.dob),
      country: norm(current.country),
      city: norm(current.city),
    }),
    updatedAt: Date.now(),
  };

  upsertProfile(next);

  return NextResponse.json({ ok: true, profile: next });
}

/**
 * POST /api/auth/profile
 * Updates profile fields for current user.
 */
export async function POST(req: Request) {
  seedUserIfMissing();

  const sess = await readSession();
  if (!sess) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  touchSession(sess.id);

  const u = getUserById(sess.userId);
  if (!u) return NextResponse.json({ ok: false, error: "User haipo." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Body;

  const current = getProfile(u.id) || ensureProfileDraft({ userId: u.id, email: u.email, phone: u.phone });

  const next = {
    ...current,
    fullName: norm(body.fullName) || current.fullName,
    phone: norm(body.phone) || current.phone,
    gender: body.gender === "FEMALE" ? "FEMALE" : body.gender === "MALE" ? "MALE" : current.gender,
    dob: norm(body.dob) || current.dob,
    country: norm(body.country) || current.country,
    city: norm(body.city) || current.city,

    avatarUrl: typeof (body as any).avatarUrl === "string" ? (body as any).avatarUrl : (current as any).avatarUrl,

    dobVisibility: body.dobVisibility || current.dobVisibility,
    maritalStatus: body.maritalStatus || current.maritalStatus,
    maritalVisibility: body.maritalVisibility || current.maritalVisibility,

    profileStatus: computeProfileStatus({
      fullName: norm(body.fullName) || current.fullName,
      phone: norm(body.phone) || current.phone,
      dob: norm(body.dob) || current.dob,
      country: norm(body.country) || current.country,
      city: norm(body.city) || current.city,
    }),

    updatedAt: Date.now(),
  };

  upsertProfile(next);

  return NextResponse.json({ ok: true, profile: next });
}
