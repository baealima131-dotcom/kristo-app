import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

// V1: Room attachments are disabled until durable object storage is wired.
// Local filesystem writes (process.cwd()/public/uploads) fail on Vercel's
// read-only filesystem with ENOENT. Until V2 storage is in place we return a
// clean 503 so text chat keeps working and clients can show a friendly notice.
export async function POST(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  return NextResponse.json(
    {
      ok: false,
      code: "ROOM_ATTACHMENTS_V1_DISABLED",
      error: "Attachments are coming in V2. Please send text messages for now.",
    },
    { status: 503 }
  );
}
