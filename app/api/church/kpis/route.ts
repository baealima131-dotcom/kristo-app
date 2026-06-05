// app/api/church/kpis/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { readMinistryJsonFile } from "@/app/api/_lib/store/ministryDb";

/* =========================
   TYPES
   ========================= */

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

  const activeMembers = await getMembershipsForChurch(churchId, "Active");
  const ministries = await readMinistryJsonFile<Ministry[]>("ministries.json", []);
  const ministryMembers = await readMinistryJsonFile<MinistryMember[]>(
    "ministry-members.json",
    []
  );

  const membersCount = activeMembers.length;
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
