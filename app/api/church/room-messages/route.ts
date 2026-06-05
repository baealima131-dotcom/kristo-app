import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  churchSubscriptionRequiredResponse,
  isChurchSubscriptionActive,
} from "@/app/api/_lib/churchSubscription";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";

export const runtime = "nodejs";

// V1: room chat messaging is not yet launched. The assignment / church-live
// control room shows a V2 notice instead of a composer, and the server rejects
// plain-text sends to that room with a clean response (no message persisted).
// Assignment cards (live-control scheduling) still flow through this endpoint.
const ROOM_MESSAGES_STORE_FILE = "room-messages.json";

const V1_MESSAGING_DISABLED_NOTICE =
  "Messages are coming in V2. For V1, communication happens through ministries, live, and church updates.";

function isV1DisabledRoomTextSend(roomKind: string, kind: string) {
  const rk = String(roomKind || "").trim().toLowerCase();
  const isAssignmentRoom = rk === "assignment" || rk === "church-live-control";
  return isAssignmentRoom && String(kind || "").trim() !== "assignment_card";
}

type RoomMessage = {
  id: string;
  churchId: string;
  roomId: string;
  roomKind: string;
  senderUserId: string;
  senderName: string;
  senderAvatar?: string;
  senderRole?: string;
  text: string;
  attachments: any[];
  kind?: string;
  card?: any;
  createdAt: number;
  deletedFor?: string[];
};

async function readStore(): Promise<Record<string, RoomMessage[]>> {
  try {
    const data = await readJsonFile<Record<string, RoomMessage[]>>(ROOM_MESSAGES_STORE_FILE, {});
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeStore(data: Record<string, RoomMessage[]>) {
  // Uses the writable data dir (/tmp on serverless) instead of the read-only
  // bundled `data/` folder, so sends never crash with a filesystem 500.
  await writeJsonFile(ROOM_MESSAGES_STORE_FILE, data);
}

function getHeaders(req: Request) {
  return {
    churchId: req.headers.get("x-kristo-church-id") || "",
    userId: req.headers.get("x-kristo-user-id") || "",
    role: req.headers.get("x-kristo-role") || "Member",
    name: req.headers.get("x-kristo-user-name") || req.headers.get("x-kristo-display-name") || "",
  };
}

function keyOf(churchId: string, roomId: string) {
  return `${churchId}::${roomId}`;
}


function pickProfileAvatar(profile: any, user: any) {
  return String(
    profile?.avatarUrl ||
    profile?.avatarUri ||
    profile?.profileImage ||
    profile?.photoURL ||
    profile?.image ||
    user?.avatarUrl ||
    user?.avatarUri ||
    user?.profileImage ||
    user?.photoURL ||
    user?.image ||
    ""
  ).trim();
}

function pickProfileName(profile: any, user: any) {
  return String(
    profile?.displayName ||
    profile?.fullName ||
    profile?.name ||
    user?.displayName ||
    user?.name ||
    user?.email ||
    profile?.email ||
    ""
  ).trim();
}

async function resolveSenderIdentity(userId: string) {
  const raw = String(userId || "").trim();
  if (!raw) return { name: "", avatar: "" };

  let profile: any = (await getProfile(raw)) || null;
  if (!profile && raw !== raw.toLowerCase()) {
    profile = (await getProfile(raw.toLowerCase())) || null;
  }

  const resolvedUserId = String(profile?.userId || raw).trim();
  const user: any = resolvedUserId ? await getUserById(resolvedUserId) : null;

  if (!profile && user) {
    profile = (await getProfile(resolvedUserId)) || null;
  }

  if (!profile) {
    try {
      const file = path.join(process.cwd(), "data", "profiles.json");
      const storeRaw = await fs.readFile(file, "utf8");
      const profiles = JSON.parse(storeRaw || "{}");
      profile = profiles?.[raw] || profiles?.[resolvedUserId] || null;
    } catch {
      profile = null;
    }
  }

  return {
    name: pickProfileName(profile, user),
    avatar: pickProfileAvatar(profile, user),
  };
}

async function profileAvatarForUser(userId: string) {
  const row = await resolveSenderIdentity(userId);
  return row.avatar;
}

type SenderProfile = { name: string; avatar: string; role: string };

const senderProfileCache = new Map<string, { row: SenderProfile; at: number }>();
const SENDER_PROFILE_TTL_MS = 5 * 60 * 1000;

async function senderProfileFor(churchId: string, userId: string): Promise<SenderProfile> {
  const id = String(userId || "").trim();
  if (!id) return { name: "", avatar: "", role: "" };

  const cached = senderProfileCache.get(`${churchId}::${id}`);
  if (cached && Date.now() - cached.at < SENDER_PROFILE_TTL_MS) {
    return cached.row;
  }

  const [identity, role] = await Promise.all([
    resolveSenderIdentity(id),
    churchRoleForUser(churchId, id),
  ]);

  const row = { name: identity.name, avatar: identity.avatar, role };
  senderProfileCache.set(`${churchId}::${id}`, { row, at: Date.now() });
  return row;
}


async function churchRoleForUser(churchId: string, userId: string) {
  try {
    const file = path.join(process.cwd(), "data", "memberships.json");
    const raw = await fs.readFile(file, "utf8");
    const memberships = JSON.parse(raw || "[]");
    const rows = Array.isArray(memberships) ? memberships : Object.values(memberships || {});

    const match = rows.find((m: any) =>
      String(m?.churchId || "").trim() === String(churchId || "").trim() &&
      String(m?.userId || "").trim() === String(userId || "").trim() &&
      String(m?.status || "Active").toLowerCase() !== "removed"
    );

    return String(
      (match as any)?.churchRole ||
      (match as any)?.role ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

async function profileNameForUser(userId: string) {
  const row = await resolveSenderIdentity(userId);
  return row.name;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const roomId = String(searchParams.get("roomId") || "").trim();
  const limitRaw = Number(searchParams.get("limit") || 0);
  const limit = limitRaw > 0 ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 0;
  const { churchId, userId } = getHeaders(req);

  if (!churchId || !userId) {
    return NextResponse.json({ ok: false, error: "Missing auth headers" }, { status: 401 });
  }

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "Missing roomId" }, { status: 400 });
  }

  const store = await readStore();
  const rows = (store[keyOf(churchId, roomId)] || []).filter((m: any) => {
    const deletedFor = Array.isArray(m?.deletedFor) ? m.deletedFor.map(String) : [];
    return !deletedFor.includes(String(userId));
  });
  const sorted = rows.slice().sort((a, b) => b.createdAt - a.createdAt);
  const window = limit > 0 ? sorted.slice(0, limit) : sorted;

  const enriched = await Promise.all(
    window.map(async (m: any) => {
      const profile = await senderProfileFor(churchId, String(m.senderUserId || ""));

      return {
        ...m,
        senderName: profile.name || m.senderName || "Member",
        senderAvatar: profile.avatar || m.senderAvatar || "",
        senderRole: profile.role || m.senderRole || "",
      };
    })
  );

  return NextResponse.json({
    ok: true,
    data: enriched,
  });
}

export async function POST(req: Request) {
  const { churchId, userId, name } = getHeaders(req);

  if (!churchId || !userId) {
    return NextResponse.json({ ok: false, error: "Missing auth headers" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const roomId = String(body?.roomId || "").trim();
  const roomKind = String(body?.roomKind || "ministry").trim();
  const text = String(body?.text || "").trim();
  const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
  const kind = String(body?.kind || "text").trim();
  const card = body?.card && typeof body.card === "object" ? body.card : null;

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "Missing roomId" }, { status: 400 });
  }

  // V1: assignment / church-live control room chat is disabled. Reject plain
  // text/attachment sends with a clean response instead of persisting/crashing.
  if (isV1DisabledRoomTextSend(roomKind, kind)) {
    return NextResponse.json(
      { ok: false, error: V1_MESSAGING_DISABLED_NOTICE, code: "MESSAGING_V1_DISABLED" },
      { status: 403 }
    );
  }

  if (!text && attachments.length === 0 && !(kind === "assignment_card" && card)) {
    return NextResponse.json({ ok: false, error: "Empty message" }, { status: 400 });
  }

  if (kind === "assignment_card" && card) {
    const subscriptionActive = await isChurchSubscriptionActive(churchId);
    if (!subscriptionActive) {
      return churchSubscriptionRequiredResponse();
    }
  }

  const store = await readStore();
  const key = keyOf(churchId, roomId);

  const identity = await resolveSenderIdentity(userId);
  const senderRole = await churchRoleForUser(churchId, userId);
  const senderName = String(identity.name || body?.senderName || name || "Member").trim();

  const msg: RoomMessage = {
    id: `rm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    churchId,
    roomId,
    roomKind,
    senderUserId: userId,
    senderName: senderName || "Member",
    senderAvatar: identity.avatar || "",
    senderRole: senderRole || "",
    text,
    attachments,
    kind,
    card,
    createdAt: Date.now(),
  };

  store[key] = [msg, ...(store[key] || [])].slice(0, 500);

  try {
    await writeStore(store);
  } catch (e) {
    console.log("KRISTO_ROOM_MESSAGES_WRITE_FAILED", {
      roomId,
      roomKind,
      error: String((e as any)?.message || e),
    });
    return NextResponse.json(
      { ok: false, error: "Message store unavailable. Please try again later." },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, data: msg });
}


export async function PATCH(req: Request) {
  const { churchId, userId } = getHeaders(req);

  if (!churchId || !userId) {
    return NextResponse.json({ ok: false, error: "Missing auth headers" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const roomId = String(body?.roomId || "").trim();
  const messageId = String(body?.messageId || "").trim();
  const cardId = String(body?.cardId || "").trim();
  const patch = body?.patch && typeof body.patch === "object" ? body.patch : {};
  const action = String(body?.action || "").trim().toLowerCase();
  const scope = String(body?.scope || "local").trim().toLowerCase();

  if (action === "delete") {
    if (!roomId || !messageId) {
      return NextResponse.json({ ok: false, error: "Missing roomId or messageId" }, { status: 400 });
    }

    const store = await readStore();
    const key = keyOf(churchId, roomId);
    const rows = store[key] || [];
    const index = rows.findIndex((m: any) => String(m?.id || "") === messageId);

    if (index < 0) {
      return NextResponse.json({ ok: false, error: "Message not found" }, { status: 404 });
    }

    const msg: any = rows[index];

    if (String(msg?.kind || "") === "assignment_card") {
      return NextResponse.json({ ok: false, error: "Assignment cards cannot be deleted here" }, { status: 403 });
    }

    if (scope === "everyone") {
      const msgSenderUserId = String(msg?.senderUserId || "");
      const currentUserId = String(userId);
      const ownerMatch = msgSenderUserId === currentUserId;

      console.log("[RoomMessagesDelete] compare-owner", {
        userId: currentUserId,
        senderUserId: msgSenderUserId,
        messageId,
        roomId,
        scope,
        ownerMatch,
      });

      if (!ownerMatch) {
        return NextResponse.json(
          { ok: false, error: "Only sender can delete for everyone", userId: currentUserId, senderUserId: msgSenderUserId, messageId, roomId, scope },
          { status: 403 }
        );
      }

      rows.splice(index, 1);
      store[key] = rows;
      await writeStore(store);

      return NextResponse.json({ ok: true, deleted: "everyone", messageId });
    }

    const deletedFor = Array.isArray(msg.deletedFor) ? msg.deletedFor.map(String) : [];
    if (!deletedFor.includes(String(userId))) deletedFor.push(String(userId));

    rows[index] = { ...msg, deletedFor };
    store[key] = rows;
    await writeStore(store);

    return NextResponse.json({ ok: true, deleted: "local", messageId });
  }

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "Missing roomId" }, { status: 400 });
  }

  if (!messageId && !cardId) {
    return NextResponse.json({ ok: false, error: "Missing messageId or cardId" }, { status: 400 });
  }

  const store = await readStore();
  const key = keyOf(churchId, roomId);
  const rows = store[key] || [];

  const index = rows.findIndex((m: any) =>
    (messageId && String(m?.id || "") === messageId) ||
    (cardId && String(m?.card?.cardId || "") === cardId)
  );

  if (index < 0) {
    return NextResponse.json({ ok: false, error: "Message/card not found" }, { status: 404 });
  }

  const oldMsg: any = rows[index];
  const nextMsg = {
    ...oldMsg,
    card: {
      ...(oldMsg.card || {}),
      ...patch,
      updatedAt: Date.now(),
    },
  };

  rows[index] = nextMsg;
  store[key] = rows;
  await writeStore(store);

  return NextResponse.json({ ok: true, data: nextMsg });
}


export async function DELETE(req: Request) {
  const { churchId, userId } = getHeaders(req);

  if (!churchId || !userId) {
    return NextResponse.json({ ok: false, error: "Missing auth headers" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const roomId = String(body?.roomId || "").trim();
  const cardIds = Array.isArray(body?.cardIds) ? body.cardIds.map(String) : [];
  const clearAllAssignmentCards = !!body?.clearAllAssignmentCards;

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "Missing roomId" }, { status: 400 });
  }

  const store = await readStore();
  const key = keyOf(churchId, roomId);
  const rows = store[key] || [];

  const next = rows.filter((m: any) => {
    if (clearAllAssignmentCards) return String(m?.kind || "") !== "assignment_card";
    return !cardIds.includes(String(m?.card?.cardId || m?.id || ""));
  });

  store[key] = next;
  await writeStore(store);

  return NextResponse.json({ ok: true, deleted: rows.length - next.length });
}
