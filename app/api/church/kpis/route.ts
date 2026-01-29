// app/api/church/kpis/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile } from "@/app/api/_lib/store/fs";

/* =========================
   TYPES
   ========================= */

type ChurchMember = {
  id: string;
  churchId: string;
};

type Ministry = {
  id: string;
  churchId: string;
};

type MinistryMember = {
  id: string;
  churchId: string;
  role: "Member" | "Leader";
};

/* =========================
   HELPERS
   ========================= */

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/* =========================
   GET /api/church/kpis
   ========================= */

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId } = ctxOrRes;

  const members = await readJsonFile<ChurchMember[]>("church_members.json", []);
  const ministries = await readJsonFile<Ministry[]>("ministries.json", []);
  const ministryMembers = await readJsonFile<MinistryMember[]>("ministry_members.json", []);

  const membersCount = members.filter((m) => m.churchId === churchId).length;
  const ministriesCount = ministries.filter((m) => m.churchId === churchId).length;

  const leadersCount = ministryMembers.filter(
    (m) => m.churchId === churchId && m.role === "Leader"
  ).length;

  return json({
    ok: true,
    data: {
      members: membersCount,
      ministries: ministriesCount,
      leaders: leadersCount,
    },
  });
}
