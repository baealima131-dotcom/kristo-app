import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  requireChurchSubscriptionActive,
} from "@/app/api/_lib/churchSubscription";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";
import {
  readRoomMessagesJsonFile,
  writeRoomMessagesJsonFile,
} from "@/app/api/_lib/store/roomMessageDb";
import { purgeFeedSchedulesForDeletedRoomCards } from "@/app/api/_lib/reconcileMediaScheduleFeed";
import {
  getDirectMessageConversationSettings,
  isDirectMessageBlocked,
  isDirectRoomId,
  isParticipantInDirectRoom,
  touchDirectMessageThread,
} from "@/app/api/_lib/directMessages";

export const runtime = "nodejs";

// V1 messaging policy:
// - Enabled: ministry chat, assignment / church-live control chat, and
//   assignment/live-control cards.
// - Disabled until V2: church room threads + direct/private (DM) chats. Plain
//   text/attachment sends to those rooms are rejected with a clean response
//   (no message persisted, no crash).
const ROOM_MESSAGES_STORE_FILE = "room-messages.json";

const V1_MESSAGING_DISABLED_NOTICE =
  "Messages are coming in V2. For V1, communication happens through ministries, live control, and church updates.";

const V1_DISABLED_ROOM_KINDS = new Set([
  "church-room",
  "church-thread",
  "thread",
]);

const V1_DIRECT_ROOM_KINDS = new Set(["direct", "dm", "private"]);

function isV1DisabledRoomTextSend(roomKind: string, kind: string) {
  const rk = String(roomKind || "").trim().toLowerCase();
  const messageKind = String(kind || "").trim();
  // Rich cards always flow through (live-control scheduling, shared feed posts).
  if (messageKind === "assignment_card" || messageKind === "shared_content") return false;
  return V1_DISABLED_ROOM_KINDS.has(rk);
}

type RoomMessage = {
  id: string;
  clientId?: string;
  churchId: string;
  roomId: string;
  roomKind: string;
  senderUserId: string;
  senderName: string;
  senderAvatar?: string;
  senderRole?: string;
  text: string;
  attachments: any[];
  // Optional rich payloads (assignment cards, schedule slots, etc.). These must
  // be persisted and returned verbatim so the client never loses them after a
  // poll/hydrate.
  attachment?: any;
  file?: any;
  files?: any[];
  kind?: string;
  card?: any;
  payload?: any;
  assignment?: any;
  schedule?: any;
  slot?: any;
  scheduleId?: string;
  slotId?: string;
  parentScheduleId?: string;
  metadata?: any;
  sharedContent?: any;
  createdAt: number;
  deletedFor?: string[];
  storageDeletedFor?: Record<
    string,
    string[]
  >;
};

/**
 * Copy only the optional rich fields that are actually present on the incoming
 * body so we never overwrite stored fields with `undefined` and never strip
 * attachments/cards/schedule data.
 */
function pickOptionalRoomMessageFields(body: any): Partial<RoomMessage> {
  const out: Partial<RoomMessage> = {};
  if (body?.attachment !== undefined) out.attachment = body.attachment;
  if (body?.file !== undefined) out.file = body.file;
  if (Array.isArray(body?.files)) out.files = body.files;
  if (body?.payload !== undefined && body?.payload !== null) out.payload = body.payload;
  if (body?.assignment !== undefined && body?.assignment !== null) out.assignment = body.assignment;
  if (body?.schedule !== undefined && body?.schedule !== null) out.schedule = body.schedule;
  if (body?.slot !== undefined && body?.slot !== null) out.slot = body.slot;
  if (body?.metadata !== undefined && body?.metadata !== null) out.metadata = body.metadata;
  if (body?.sharedContent !== undefined && body?.sharedContent !== null) {
    out.sharedContent = body.sharedContent;
  }

  const scheduleId = String(body?.scheduleId || "").trim();
  if (scheduleId) out.scheduleId = scheduleId;
  const slotId = String(body?.slotId || "").trim();
  if (slotId) out.slotId = slotId;
  const parentScheduleId = String(body?.parentScheduleId || "").trim();
  if (parentScheduleId) out.parentScheduleId = parentScheduleId;

  return out;
}

async function readStore(): Promise<Record<string, RoomMessage[]>> {
  const data = await readRoomMessagesJsonFile<Record<string, RoomMessage[]>>(
    ROOM_MESSAGES_STORE_FILE,
    {}
  );
  return data && typeof data === "object" ? data : {};
}

async function writeStore(data: Record<string, RoomMessage[]>) {
  // Durable Postgres-backed store (falls back to local JSON only in dev). On
  // Vercel without a database this throws instead of silently writing to /tmp,
  // so room messages, attachments, cards and schedule slots are never lost
  // across instances, redeploys or devices.
  await writeRoomMessagesJsonFile(ROOM_MESSAGES_STORE_FILE, data);
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

  let store: Record<string, RoomMessage[]>;
  try {
    store = await readStore();
  } catch (e) {
    console.log("KRISTO_ROOM_MESSAGES_READ_FAILED", {
      roomId,
      error: String((e as any)?.message || e),
    });
    return NextResponse.json(
      { ok: false, error: "Message store unavailable. Please try again later." },
      { status: 503 }
    );
  }
  const getStoreKey = keyOf(churchId, roomId);

  // Diagnostics: the store is keyed by `${churchId}::${roomId}`, NOT by roomId
  // alone. These logs make it obvious if POST wrote under a different key than
  // GET is reading, or if the document loaded but the inner key missed.
  console.log("KRISTO_ROOM_MESSAGES_GET_STORE", roomId, store[roomId]?.length);
  console.log("KRISTO_ROOM_MESSAGES_GET_STORE_DETAIL", {
    roomId,
    churchId,
    storeKey: getStoreKey,
    rowsForStoreKey: store[getStoreKey]?.length || 0,
    rowsForRoomIdOnly: store[roomId]?.length || 0,
    totalDocKeys: Object.keys(store || {}).length,
    docKeys: Object.keys(store || {}).slice(0, 30),
  });

  let viewerClearedAt = 0;

  if (isDirectRoomId(roomId)) {
    const settings =
      await getDirectMessageConversationSettings({
        churchId,
        roomId,
        userId,
      });

    viewerClearedAt = Number(settings?.clearedAt || 0);
  }

  const rows = (store[getStoreKey] || []).filter((m: any) => {
    const deletedFor = Array.isArray(m?.deletedFor)
      ? m.deletedFor.map(String)
      : [];

    const createdAt = Number(m?.createdAt || 0);

    if (deletedFor.includes(String(userId))) {
      return false;
    }

    if (viewerClearedAt > 0 && createdAt <= viewerClearedAt) {
      return false;
    }

    return true;
  });
  const sorted = rows.slice().sort((a, b) => b.createdAt - a.createdAt);
  const window = limit > 0 ? sorted.slice(0, limit) : sorted;

  const enriched = await Promise.all(
    window.map(async (m: any) => {
      const profile = await senderProfileFor(
        churchId,
        String(m.senderUserId || "")
      );

      const storageDeletedFor =
        m?.storageDeletedFor &&
        typeof m.storageDeletedFor === "object" &&
        !Array.isArray(m.storageDeletedFor)
          ? m.storageDeletedFor
          : {};

      const viewerDeletedStorageItemIds =
        Object.entries(storageDeletedFor)
          .filter(([, deletedUsers]) =>
            Array.isArray(deletedUsers) &&
            deletedUsers
              .map(String)
              .includes(String(userId))
          )
          .map(([itemId]) => String(itemId));

      const textDeletedFor =
        m?.textDeletedFor &&
        typeof m.textDeletedFor === "object" &&
        !Array.isArray(m.textDeletedFor)
          ? m.textDeletedFor
          : {};

      const viewerTextDeleted =
        textDeletedFor[String(userId)] === true;

      /*
       * Never expose complete per-user deletion maps.
       * The viewer receives only their own deletion state.
       *
       * storageText preserves link indexing in Media Storage
       * while text remains hidden in the conversation UI.
       */
      const {
        storageDeletedFor: _privateStorageDeletedFor,
        textDeletedFor: _privateTextDeletedFor,
        ...publicMessage
      } = m;

      return {
        ...publicMessage,
        text: viewerTextDeleted
          ? ""
          : String(m?.text || ""),
        storageText: String(m?.text || ""),
        viewerTextDeleted,
        viewerDeletedStorageItemIds,
        senderName:
          profile.name ||
          m.senderName ||
          "Member",
        senderAvatar:
          profile.avatar ||
          m.senderAvatar ||
          "",
        senderRole:
          profile.role ||
          m.senderRole ||
          "",
      };
    })
  );

  const attachmentCount = enriched.reduce(
    (sum: number, m: any) => sum + (Array.isArray(m?.attachments) ? m.attachments.length : 0),
    0
  );
  const cardCount = enriched.filter(
    (m: any) => String(m?.kind || "") === "assignment_card" || !!m?.card
  ).length;

  console.log("KRISTO_ROOM_MESSAGE_GET_RETURNED", {
    roomId,
    count: enriched.length,
    attachmentCount,
    cardCount,
  });

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
  const clientId = String(body?.clientId || body?.localId || "").trim();
  const optionalFields = pickOptionalRoomMessageFields(body);

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "Missing roomId" }, { status: 400 });
  }

  const normalizedRoomKind = String(roomKind || "").trim().toLowerCase();
  const isDirectRoom =
    V1_DIRECT_ROOM_KINDS.has(normalizedRoomKind) || isDirectRoomId(roomId);

  if (kind === "appointment_request") {
    const appointmentMessage = String(
      card?.message || text || ""
    ).trim();

    if (!isDirectRoom) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Appointment requests are only supported in direct conversations.",
        },
        { status: 400 }
      );
    }

    if (
      !card ||
      String(card?.type || "") !== "appointment_request"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid appointment request payload.",
        },
        { status: 400 }
      );
    }

    if (!appointmentMessage) {
      return NextResponse.json(
        {
          ok: false,
          error: "Write a message before sending the appointment request.",
        },
        { status: 400 }
      );
    }

    if (appointmentMessage.length > 500) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Appointment request messages cannot exceed 500 characters.",
        },
        { status: 400 }
      );
    }

    if (
      String(card?.requesterId || "").trim() !==
      String(userId || "").trim()
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid appointment requester.",
        },
        { status: 403 }
      );
    }

    if (
      Array.isArray(card?.voiceNotes) &&
      card.voiceNotes.length > 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Voice appointment requests are not enabled yet.",
        },
        { status: 400 }
      );
    }
  }

  if (
    kind === "appointment_response" ||
    kind === "appointment_time_proposed" ||
    kind === "appointment_confirmed"
  ) {
    if (!isDirectRoom) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Appointment workflow messages require a direct conversation.",
        },
        { status: 400 }
      );
    }

    if (!card || !String(card?.appointmentId || "").trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid appointment workflow payload.",
        },
        { status: 400 }
      );
    }

    const requesterId = String(card?.requesterId || "").trim();
    const recipientId = String(card?.recipientId || "").trim();
    const actorId = String(userId || "").trim();
    const status = String(card?.status || "").trim();

    if (
      actorId !== requesterId &&
      actorId !== recipientId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "You are not part of this appointment.",
        },
        { status: 403 }
      );
    }

    if (
      kind === "appointment_response" &&
      (
        status === "accepted_awaiting_time" ||
        status === "rejected"
      ) &&
      actorId !== recipientId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the appointment recipient can accept or reject the request.",
        },
        { status: 403 }
      );
    }

    if (
      kind === "appointment_time_proposed" &&
      actorId !== recipientId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the appointment recipient can propose the meeting time.",
        },
        { status: 403 }
      );
    }

    if (
      kind === "appointment_confirmed" &&
      actorId !== requesterId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the requester can confirm the proposed time.",
        },
        { status: 403 }
      );
    }

    if (
      String(card?.message || text || "").length > 500
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Appointment messages cannot exceed 500 characters.",
        },
        { status: 400 }
      );
    }
  }

  if (isDirectRoom) {
    if (!isDirectRoomId(roomId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid direct message room." },
        { status: 400 }
      );
    }
    if (!isParticipantInDirectRoom(roomId, userId)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const blocked = await isDirectMessageBlocked({
      churchId,
      roomId,
      userId,
    });

    if (blocked) {
      console.log("KRISTO_DM_SEND_BLOCKED", {
        churchId,
        roomId,
        senderUserId: userId,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "conversation_blocked",
          message:
            "Messages cannot be sent in this blocked conversation.",
        },
        { status: 403 }
      );
    }
  }

  // V1: assignment / church-live control room chat is disabled. Reject plain
  // text/attachment sends with a clean response instead of persisting/crashing.
  if (isV1DisabledRoomTextSend(roomKind, kind)) {
    return NextResponse.json(
      { ok: false, error: V1_MESSAGING_DISABLED_NOTICE, code: "MESSAGING_V1_DISABLED" },
      { status: 403 }
    );
  }

  // A message is meaningful if it has text, attachments, a card, or any rich
  // payload (assignment / schedule / slot).
  const hasRichPayload =
    !!card ||
    optionalFields.payload !== undefined ||
    optionalFields.sharedContent !== undefined ||
    optionalFields.assignment !== undefined ||
    optionalFields.schedule !== undefined ||
    optionalFields.slot !== undefined;

  if (!text && attachments.length === 0 && !hasRichPayload) {
    return NextResponse.json({ ok: false, error: "Empty message" }, { status: 400 });
  }

  const isScheduleOrClaimSlotCreate =
    (kind === "assignment_card" && card) ||
    optionalFields.schedule !== undefined ||
    optionalFields.slot !== undefined;

  if (isScheduleOrClaimSlotCreate) {
    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/room-messages",
      churchId,
      userId,
      role: String(body?.role || req.headers.get("x-kristo-role") || ""),
      action:
        kind === "assignment_card"
          ? "assignment_card"
          : optionalFields.slot !== undefined
            ? "claim_slot"
            : "schedule_create",
    });
    if (subscriptionBlocked) return subscriptionBlocked;
  }

  let store: Record<string, RoomMessage[]>;
  try {
    store = await readStore();
  } catch (e) {
    console.log("KRISTO_ROOM_MESSAGES_READ_FAILED", {
      roomId,
      roomKind,
      error: String((e as any)?.message || e),
    });
    return NextResponse.json(
      { ok: false, error: "Message store unavailable. Please try again later." },
      { status: 503 }
    );
  }
  const key = keyOf(churchId, roomId);

  const identity = await resolveSenderIdentity(userId);
  const senderRole = await churchRoleForUser(churchId, userId);
  const senderName = String(identity.name || body?.senderName || name || "Member").trim();

  const msg: RoomMessage = {
    id: `rm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ...(clientId ? { clientId } : {}),
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
    ...optionalFields,
    createdAt: Date.now(),
  };

  store[key] = [msg, ...(store[key] || [])].slice(0, 500);

  // Diagnostics: confirm exactly which key POST writes under so it can be
  // compared against KRISTO_ROOM_MESSAGES_GET_STORE for the same room.
  console.log("KRISTO_ROOM_MESSAGES_POST_STORE", roomId, store[roomId]?.length);
  console.log("KRISTO_ROOM_MESSAGES_POST_STORE_DETAIL", {
    roomId,
    churchId,
    storeKey: key,
    rowsForStoreKey: store[key]?.length || 0,
    rowsForRoomIdOnly: store[roomId]?.length || 0,
    totalDocKeys: Object.keys(store || {}).length,
    docKeys: Object.keys(store || {}).slice(0, 30),
  });

  console.log("KRISTO_ROOM_MESSAGE_POST_PERSISTED", {
    roomId,
    kind,
    attachmentCount: attachments.length,
    hasPayload: optionalFields.payload !== undefined || !!card,
    hasSlot: optionalFields.slot !== undefined || !!optionalFields.slotId,
  });

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

  if (isDirectRoom) {
    try {
      await touchDirectMessageThread({
        churchId,
        roomId,
        senderUserId: userId,
        previewText: text,
        createdAt: msg.createdAt,
      });
    } catch (touchError) {
      console.log("KRISTO_DIRECT_MESSAGE_THREAD_TOUCH_FAILED", {
        roomId,
        error: String((touchError as any)?.message || touchError),
      });
    }
  }

  // Verify durability by re-reading the document straight back from the store.
  // If this shows the rows but the next GET shows 0, the problem is a key
  // mismatch (different churchId/roomId), not the durable read/write itself.
  try {
    const verify = await readStore();
    console.log("KRISTO_ROOM_MESSAGES_POST_VERIFY_READBACK", {
      roomId,
      storeKey: key,
      rowsForStoreKey: verify[key]?.length || 0,
      totalDocKeys: Object.keys(verify || {}).length,
    });
  } catch (e) {
    console.log("KRISTO_ROOM_MESSAGES_POST_VERIFY_READBACK_FAILED", {
      roomId,
      error: String((e as any)?.message || e),
    });
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

  if (action === "clear_text_for_viewer") {
    if (!roomId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing roomId",
        },
        { status: 400 }
      );
    }

    const store = await readStore();
    const key = keyOf(churchId, roomId);
    const rows = store[key] || [];

    let clearedCount = 0;

    const nextRows = rows.map(
      (message: any) => {
        const text = String(
          message?.text || ""
        ).trim();

        if (!text) return message;

        const textDeletedFor:
          Record<string, boolean> =
          message?.textDeletedFor &&
          typeof message.textDeletedFor ===
            "object" &&
          !Array.isArray(
            message.textDeletedFor
          )
            ? {
                ...message.textDeletedFor,
              }
            : {};

        if (
          textDeletedFor[
            String(userId)
          ] !== true
        ) {
          clearedCount += 1;
        }

        textDeletedFor[
          String(userId)
        ] = true;

        return {
          ...message,
          textDeletedFor,
        };
      }
    );

    store[key] = nextRows;
    await writeStore(store);

    console.log(
      "KRISTO_DM_TEXT_CLEARED_FOR_VIEWER_BACKEND",
      {
        churchId,
        roomId,
        userId,
        clearedCount,
      }
    );

    return NextResponse.json({
      ok: true,
      cleared: "text-for-viewer",
      roomId,
      clearedCount,
    });
  }

  if (action === "delete_storage_items") {
    if (!roomId || !messageId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing roomId or messageId",
        },
        { status: 400 }
      );
    }

    const itemIds: string[] =
      Array.isArray(body?.itemIds)
        ? Array.from(
            new Set<string>(
              body.itemIds
                .map((value: unknown) =>
                  String(value || "").trim()
                )
                .filter(
                  (
                    value: string
                  ): value is string =>
                    value.length > 0
                )
            )
          ).slice(0, 100)
        : [];

    if (!itemIds.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No storage item ids supplied",
        },
        { status: 400 }
      );
    }

    const store = await readStore();
    const key = keyOf(churchId, roomId);
    const rows = store[key] || [];

    const index = rows.findIndex(
      (message: any) =>
        String(message?.id || "") ===
        messageId
    );

    if (index < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Message not found",
        },
        { status: 404 }
      );
    }

    const message: any = rows[index];

    const storageDeletedFor:
      Record<string, string[]> =
      message?.storageDeletedFor &&
      typeof message.storageDeletedFor ===
        "object" &&
      !Array.isArray(
        message.storageDeletedFor
      )
        ? {
            ...message.storageDeletedFor,
          }
        : {};

    for (const itemId of itemIds) {
      const deletedUsers = Array.isArray(
        storageDeletedFor[itemId]
      )
        ? storageDeletedFor[itemId].map(
            String
          )
        : [];

      if (
        !deletedUsers.includes(
          String(userId)
        )
      ) {
        deletedUsers.push(String(userId));
      }

      storageDeletedFor[itemId] =
        deletedUsers;
    }

    rows[index] = {
      ...message,
      storageDeletedFor,
    };

    store[key] = rows;
    await writeStore(store);

    console.log(
      "KRISTO_MEDIA_STORAGE_DELETE_FOR_ME_BACKEND",
      {
        churchId,
        roomId,
        messageId,
        userId,
        itemCount: itemIds.length,
      }
    );

    return NextResponse.json({
      ok: true,
      deleted: "storage-for-me",
      messageId,
      itemIds,
    });
  }

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
  const oldCard = oldMsg?.card && typeof oldMsg.card === "object" ? oldMsg.card : {};
  const existingOwner = String(oldCard?.claimedByUserId || "").trim();
  const patchTouchesClaim =
    Object.prototype.hasOwnProperty.call(patch, "claimedByUserId") ||
    Object.prototype.hasOwnProperty.call(patch, "status");
  const incomingOwner = Object.prototype.hasOwnProperty.call(patch, "claimedByUserId")
    ? String(patch.claimedByUserId || "").trim()
    : existingOwner;
  const nextStatus = String(patch?.status ?? oldCard?.status ?? "open").toLowerCase();
  const isReleasePatch =
    nextStatus === "open" ||
    (Object.prototype.hasOwnProperty.call(patch, "claimedByUserId") && !incomingOwner);

  if (
    patchTouchesClaim &&
    existingOwner &&
    incomingOwner &&
    incomingOwner !== existingOwner &&
    !isReleasePatch
  ) {
    const slotId = String(messageId || cardId || oldMsg?.id || "").trim();
    console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
      slotId: slotId || null,
      existingClaimedByUserId: existingOwner,
      incomingUserId: incomingOwner,
      source: "api.church.room-messages.PATCH",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "slot_already_claimed",
        claimedByUserId: existingOwner,
      },
      { status: 409 }
    );
  }

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

  const deletedMessages = rows.filter((m: any) => {
    if (clearAllAssignmentCards) return String(m?.kind || "") === "assignment_card";
    return cardIds.includes(String(m?.card?.cardId || m?.id || ""));
  });

  const next = rows.filter((m: any) => {
    if (clearAllAssignmentCards) return String(m?.kind || "") !== "assignment_card";
    return !cardIds.includes(String(m?.card?.cardId || m?.id || ""));
  });

  store[key] = next;
  await writeStore(store);

  if (deletedMessages.length) {
    void purgeFeedSchedulesForDeletedRoomCards({
      churchId,
      deletedMessages,
      reason: clearAllAssignmentCards
        ? "room-messages-delete-all-assignment-cards"
        : "room-messages-delete-assignment-cards",
    });
  }

  return NextResponse.json({ ok: true, deleted: rows.length - next.length });
}
