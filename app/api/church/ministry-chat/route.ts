import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/app/api/_lib/rbac";
import { listMinistryMemberUserIds } from "@/app/api/_lib/ministryAuthority";
import { addNotification } from "@/app/api/_lib/notifications";
export const runtime = "nodejs";
type ChatMessage = {
  id: string;
  ministryId: string;
  churchId: string;
  userId: string;
  userName?: string;
  text: string;
  createdAt: string;
};
declare global {
  var __KRISTO_MINISTRY_CHAT__: ChatMessage[] | undefined;
}
function getStore() {
  if (!globalThis.__KRISTO_MINISTRY_CHAT__) globalThis.__KRISTO_MINISTRY_CHAT__ = [];
  return globalThis.__KRISTO_MINISTRY_CHAT__;
}
function nowIso() {
  return new Date().toISOString();
}
function uid(prefix = "mmsg") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
async function requireCtx(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  return ctxOrRes; // GuardContext
}
export async function GET(req: NextRequest) {
  const ctxOrRes: any = await requireCtx(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const g: any = ctxOrRes;
  const url = new URL(req.url);
  const ministryId = String(url.searchParams.get("ministryId") || "").trim();
  if (!ministryId) return json({ ok: false, error: "ministryId is required" }, { status: 400 });
  const churchId = String(g.churchId || "").trim();
  const store = getStore();
  const data = store
    .filter((m) => m.ministryId === ministryId && (!churchId || m.churchId === churchId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .slice(-200);
  return json({ ok: true, data });
}
export async function POST(req: NextRequest) {
  const ctxOrRes: any = await requireCtx(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const g: any = ctxOrRes;
  const body = (await req.json().catch(() => null)) as { ministryId?: string; text?: string } | null;
  const ministryId = String(body?.ministryId || "").trim();
  const text = String(body?.text || "").trim();
  if (!ministryId) return json({ ok: false, error: "ministryId is required" }, { status: 400 });
  if (!text) return json({ ok: false, error: "text is required" }, { status: 400 });
  if (text.length > 2000) return json({ ok: false, error: "text too long" }, { status: 400 });
  const viewer = g.viewer || {};
  const churchId = String(g.churchId || "").trim();
  const userId = String(viewer.userId || "").trim();
  const msg: ChatMessage = {
    id: uid(),
    ministryId,
    churchId: churchId || "unknown",
    userId: userId || "unknown",
    userName: viewer.name || viewer.fullName || undefined,
    text,
    createdAt: nowIso(),
  };
  const store = getStore();
  store.push(msg);
  // Notification: fan out to other ministry members (never the sender).
  if (churchId && churchId !== "unknown" && userId) {
    try {
      const memberIds = await listMinistryMemberUserIds(churchId, ministryId);
      const senderLabel = String(msg.userName || "Someone").trim() || "Someone";
      const preview = String(msg.text || "").slice(0, 140);

      for (const targetUserId of memberIds) {
        if (!targetUserId || targetUserId === userId) continue;

        await addNotification({
          churchId,
          type: "MinistryChatMessageCreated",
          title: "New ministry chat message",
          message: `${senderLabel}: ${preview}`,
          ministryId,
          targetUserId,
          actorName: msg.userName,
          actorUserId: userId,
        });
      }
    } catch {
      // ignore notification errors
    }
  }
return json({ ok: true, data: msg }, { status: 201 });
}
