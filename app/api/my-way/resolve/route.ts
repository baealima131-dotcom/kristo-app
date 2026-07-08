import {
  MY_WAY_COMMAND_LENGTH,
  normalizeMyWayCommandCode,
  resolveMyWayCommandCode,
  type MyWayCommandResolution,
} from "@/app/api/_lib/myWayCommands";
import { getViewer } from "@/app/api/_lib/auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const code = normalizeMyWayCommandCode(String(body?.code || ""));

  if (code.length !== MY_WAY_COMMAND_LENGTH) {
    return json(
      { ok: false, error: "invalid_code_length", message: "Command must be exactly 6 characters." },
      { status: 400 }
    );
  }

  const resolved = resolveMyWayCommandCode(code);
  if (!resolved) {
    console.log("KRISTO_MY_WAY_COMMAND_NOT_FOUND", {
      code,
      userId: viewer.userId || null,
      source: "api",
    });
    return json(
      {
        ok: false,
        error: "not_found",
        message: "Command not found. Check the code and try again.",
      },
      { status: 404 }
    );
  }

  console.log("KRISTO_MY_WAY_COMMAND_RESOLVED", {
    code,
    route: resolved.route,
    title: resolved.title,
    userId: viewer.userId || null,
    source: "api",
  });

  return json({
    ok: true,
    data: resolved satisfies MyWayCommandResolution,
  });
}
