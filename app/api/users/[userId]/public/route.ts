import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import fs from "node:fs/promises";
import path from "node:path";

import { guard } from "@/app/api/_lib/rbac";
import { getProfile } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";

type ProfileVisibility = "Private" | "CorePastor" | "Public";

type Profile = {
  userId: string;
  fullName?: string;
  gender?: string;
  dob?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;
  bio?: string;

  dobVisibility?: ProfileVisibility;
  maritalStatus?: string;
  maritalVisibility?: ProfileVisibility;

  profileStatus?: string;
  createdAt?: number;
  updatedAt?: number;
};

type ProfilesMap = Record<string, Profile>;

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

/**
 * Resolve a single public profile from the durable store first (Postgres
 * kristo_profiles in production via getProfile, or the local profiles store in
 * dev). Only as a local convenience do we fall back to .kristo-dev/profiles.json
 * — this file never exists on Vercel, so production never touches /tmp here.
 */
async function readProfile(targetId: string): Promise<Profile | null> {
  try {
    const durable = await getProfile(targetId);
    if (durable) return durable as unknown as Profile;
  } catch {
    // ignore and try local dev file
  }

  try {
    const fp = path.join(process.cwd(), ".kristo-dev", "profiles.json");
    const raw = await fs.readFile(fp, "utf8");
    const data = JSON.parse(raw) as ProfilesMap;
    if (data && typeof data === "object") return data[targetId] || null;
  } catch {
    // ignore
  }

  return null;
}

function canSee(vis: ProfileVisibility | undefined, viewerRole: string, viewerId: string, ownerId: string) {
  const v = (vis || "Private") as ProfileVisibility;
  if (viewerId === ownerId) return true;
  if (v === "Public") return true;
  if (v === "CorePastor") return viewerRole === "Pastor";
  return false; // Private
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const params = await ctx.params;
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const targetId = safeString((params as any)?.userId).trim();
  if (!targetId) return json({ ok: false, error: "Missing userId" }, { status: 400 });

  const p = await readProfile(targetId);
  if (!p) return json({ ok: false, error: "Profile not found" }, { status: 404 });

  const viewerId = ctxOrRes.viewer.userId;
  const viewerRole = ctxOrRes.viewer.role;

  const allowDob = canSee(p.dobVisibility, viewerRole, viewerId, targetId);
  const allowMarital = canSee(p.maritalVisibility, viewerRole, viewerId, targetId);

  // Always safe basics
  const out = {
    userId: targetId,
    fullName: p.fullName || "",
    gender: p.gender || "",
    country: p.country || "",
    city: p.city || "",
    avatarUrl: p.avatarUrl || "",
    bio: (p as any).bio || "",

    // Conditionally visible
    dob: allowDob ? (p.dob || "") : "",
    dobVisibility: p.dobVisibility || "Private",

    maritalStatus: allowMarital ? (p.maritalStatus || "") : "",
    maritalVisibility: p.maritalVisibility || "Private",

    profileStatus: p.profileStatus || "",
  };

  return json({ ok: true, data: out });
}
