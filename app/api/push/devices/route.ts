import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { deletePushDevice, savePushDevice, validFcmToken } from "@/app/api/_lib/store/pushDevicesDb";

export const runtime = "nodejs";

async function mutate(req: NextRequest, remove: boolean) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "").trim();
  if (!validFcmToken(token)) {
    return NextResponse.json({ ok: false, error: "Invalid push token." }, { status: 400 });
  }
  try {
    if (remove) await deletePushDevice(auth.viewer.userId, token);
    else await savePushDevice(auth.viewer.userId, token);
    console.log("KRISTO_PUSH_DEVICE_" + (remove ? "REMOVED" : "SAVED"), { userId: auth.viewer.userId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not register notifications." }, { status: 503 });
  }
}

export const POST = (req: NextRequest) => mutate(req, false);
export const DELETE = (req: NextRequest) => mutate(req, true);
