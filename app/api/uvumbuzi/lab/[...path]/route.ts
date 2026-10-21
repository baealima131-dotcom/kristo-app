import { NextResponse } from "next/server";
import { verifiedUvumbuziUserId } from "@/app/api/_lib/uvumbuziIdentity";
import { labProxyConfigFromEnv, proxyToLab } from "@/app/api/_lib/uvumbuziLabProxy";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ path?: string[] }> };

/** /api/uvumbuzi/lab/<bridge path> — see app/api/_lib/uvumbuziLabProxy.ts for the allow-list. */
async function handle(req: Request, ctx: Ctx, method: "GET" | "POST") {
  const config = labProxyConfigFromEnv();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "UVUMBUZI Lab is not connected yet", reason: "lab_not_configured" },
      { status: 503, headers: NO_STORE }
    );
  }
  const userId = await verifiedUvumbuziUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized", reauth: true }, { status: 401, headers: NO_STORE });
  }
  const { path = [] } = await ctx.params;
  const result = await proxyToLab({
    method,
    segments: path,
    bodyText: method === "POST" ? await req.text() : undefined,
    verifiedUserId: userId,
    config,
  });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

export function GET(req: Request, ctx: Ctx) {
  return handle(req, ctx, "GET");
}

export function POST(req: Request, ctx: Ctx) {
  return handle(req, ctx, "POST");
}
