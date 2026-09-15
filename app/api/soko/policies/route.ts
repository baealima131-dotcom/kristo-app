import { NextResponse } from "next/server";

import { publicSokoPolicyBundle } from "@/app/api/_lib/sokoLegalPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicSokoPolicyBundle(), {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
    },
  });
}
