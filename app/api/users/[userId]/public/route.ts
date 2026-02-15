import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import fs from "node:fs/promises";
import path from "node:path";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile } from "@/app/api/_lib/store/fs";

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

async function readProfiles(): Promise<ProfilesMap> {
  // 1) Prefer the actual dev file you showed: .kristo-dev/profiles.json
  try {
    const fp = path.join(process.cwd(), ".kristo-dev", "profiles.json");
    const raw = await fs.readFile(fp, "utf8");
    const data = JSON.parse(raw) as ProfilesMap;
    return data && typeof data === "object" ? data : {};
  } catch {
    // ignore
  }

  // 2) Fallback to store helper (if wired to same dir)
  try {
    const data = await readJsonFile<ProfilesMap>("profiles.json", {});
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
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

  const profiles = await readProfiles();
  const p = profiles[targetId];
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

    // Conditionally visible
    dob: allowDob ? (p.dob || "") : "",
    dobVisibility: p.dobVisibility || "Private",

    maritalStatus: allowMarital ? (p.maritalStatus || "") : "",
    maritalVisibility: p.maritalVisibility || "Private",

    profileStatus: p.profileStatus || "",
  };

  return json({ ok: true, data: out });
}
