import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guard } from "@/app/api/_lib/rbac";
import { listMinistryMemberUserIds } from "@/app/api/_lib/ministryAuthority";
import { createNotification } from "@/app/api/_lib/notifications";
type MinistryAnnouncement = {
  id: string;
  churchId: string;
  ministryId: string;
  title: string;
  body: string;
  pinned?: boolean;
  createdBy: { userId: string; role: string };
  createdAt: string;
  updatedAt?: string;
};
declare global {
  var __KRISTO_MINISTRY_ANNOUNCEMENTS__: MinistryAnnouncement[] | undefined;
}
function getStore() {
  if (!globalThis.__KRISTO_MINISTRY_ANNOUNCEMENTS__) globalThis.__KRISTO_MINISTRY_ANNOUNCEMENTS__ = [];
  return globalThis.__KRISTO_MINISTRY_ANNOUNCEMENTS__!;
}
function nowIso() {
  return new Date().toISOString();
}
function makeId() {
  return `ann_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const url = new URL(req.url);
  const ministryId = url.searchParams.get("ministryId") || "";
  if (!ministryId) return json({ ok: false, error: "ministryId required" }, { status: 400 });
  const items = getStore().filter((a) => a.ministryId === ministryId);
  return json({ ok: true, data: items });
}
export async function POST(req: NextRequest) {
  const g = await guard(req, ["Leader", "Church_Admin"] as any);
  if (g instanceof Response) return g;
  const body = await req.json().catch(() => ({} as any));
  const ministryId = String(body?.ministryId || "");
  const title = String(body?.title || "").trim();
  const text = String(body?.body || "").trim();
  if (!ministryId || !title || !text) {
    return json({ ok: false, error: "ministryId, title, body required" }, { status: 400 });
  }
  const ann: MinistryAnnouncement = {
    id: makeId(),
    churchId: g.churchId!,
    ministryId,
    title,
    body: text,
    pinned: !!body?.pinned,
    createdBy: { userId: g.viewer.userId, role: g.viewer.role },
    createdAt: nowIso(),
  };
  getStore().unshift(ann);
  // fire-and-forget notifications (dev)
    try {
      await fanoutAnnouncementNotifications(req, {
        ministryId,
        churchId: g.churchId!,
        title,
        body: text,
        createdByUserId: g.viewer.userId,
        announcementId: ann.id,
      });
    } catch (e: any) {
      console.warn("[fanout] announcement notifications failed", e?.message || e);
    }
    return json({ ok: true, data: ann });
}
export async function PATCH(req: NextRequest) {
  const g = await guard(req, ["Leader", "Church_Admin"] as any);
  if (g instanceof Response) return g;
  const body = await req.json().catch(() => ({} as any));
  const id = String(body?.id || "");
  if (!id) return json({ ok: false, error: "id required" }, { status: 400 });
  const items = getStore();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return json({ ok: false, error: "not found" }, { status: 404 });
  const cur = items[idx];
  const title = body?.title != null ? String(body.title).trim() : cur.title;
  const text = body?.body != null ? String(body.body).trim() : cur.body;
  const pinned = body?.pinned != null ? !!body.pinned : cur.pinned;
  items[idx] = { ...cur, title, body: text, pinned, updatedAt: nowIso() };
  return json({ ok: true, data: items[idx] });
}
export async function DELETE(req: NextRequest) {
  const g = await guard(req, ["Leader", "Church_Admin"] as any);
  if (g instanceof Response) return g;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return json({ ok: false, error: "id required" }, { status: 400 });
  const items = getStore();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return json({ ok: false, error: "not found" }, { status: 404 });
  const removed = items.splice(idx, 1)[0];
  return json({ ok: true, data: removed });
}
async function fanoutAnnouncementNotifications(
  req: NextRequest,
  args: {
    ministryId: string;
    churchId: string;
    title: string;
    body: string;
    createdByUserId: string;
    announcementId: string;
  }
) {
  // Direct store calls instead of HTTP calls to our own API that impersonated the author with
  // x-kristo-* headers (those relied on the closed Stage-1 header session; the POST target did
  // not even exist, so no notification was ever delivered).
  void req;
  try {
    const { ministryId, churchId, title, body, createdByUserId, announcementId } = args;
    const targets = (await listMinistryMemberUserIds(churchId, ministryId)).filter(
      (uid) => uid && uid !== createdByUserId
    );
    const results = await Promise.all(
      targets.map(async (uid) => {
        try {
          await createNotification({
            churchId,
            targetUserId: uid,
            type: "MinistryAnnouncement",
            title,
            message: body,
            ministryId,
            actorUserId: createdByUserId,
          });
          return true;
        } catch (e: any) {
          console.warn("[fanout] notif exception", { announcementId, error: String(e?.message || e) });
          return false;
        }
      })
    );
    console.log("[fanout] ministry announcement notifications", {
      announcementId,
      sent: results.filter(Boolean).length,
      of: results.length,
    });
  } catch {}
}
