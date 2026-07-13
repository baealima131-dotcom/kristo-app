import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";

export type MsgAttachment = {
  id: string;
  kind: "image" | "file";
  uri: string;
  name: string;
  mime: string;
  size?: number;
  imageUri?: string;
  fileUri?: string;
  fileName?: string;
  mimeType?: string;
  url?: string;
};

export type AppointmentRequestStatus =
  | "pending"
  | "accepted_awaiting_time"
  | "rejected"
  | "time_proposed"
  | "confirmed"
  | "cancelled";

export type AppointmentVoiceNote = {
  id: string;
  uri: string;
  durationSec: number;
  mime?: string;
  name?: string;
};

export type AppointmentRequestPayload = {
  type: "appointment_request";
  appointmentId: string;
  status: AppointmentRequestStatus;
  requesterId: string;
  recipientId: string;
  requesterName?: string;
  recipientName?: string;
  message: string;
  voiceNotes?: AppointmentVoiceNote[];
  createdAt: number;
};

export type AssignmentCardStatus = "open" | "taken" | "done";

export type AssignmentCardPayload = {
  cardId: string;
  title: string;
  subtitle?: string;
  roleKey?: string;
  roleLabel?: string;
  slotLabel?: string;
  durationMin?: number;
  startTime?: string;
  endTime?: string;
  meetingDate?: string;
  timeLabel?: string;
  task?: string;
  script?: string;
  notes?: string[];
  musicItems?: string[];
  videoItems?: Array<{
    id: string;
    uri: string;
    title?: string;
    kind?: "upload" | "ministry";
    durationSec?: number;
    addedAt?: number;
  }>;
  status: AssignmentCardStatus;
  claimedByUserId?: string;
  claimedByName?: string;
  claimedByAvatar?: string;
  claimedByRole?: string;
  claimedAt?: number;
  likeCount?: number;
  commentCount?: number;
};

export type SharedContentType =
  | "video"
  | "post"
  | "announcement"
  | "testimony"
  | "image"
  | "live";

export type SharedContentPayload = {
  type: SharedContentType;
  postId?: string;
  title?: string;
  caption?: string;
  churchName?: string;
  authorName?: string;
  posterUri?: string;
  videoUri?: string;
  shareUrl?: string;
};

export type MsgItem = {
  id: string;
  // Stable client-generated id used to reconcile an optimistic message with the
  // server row it becomes, even across poll refreshes.
  clientId?: string;
  threadId: string;
  sender: "me" | "other";
  displayName?: string;
  avatarUri?: string;
  text?: string;
  attachments?: MsgAttachment[];
  createdAt: number;
  kind?:
    | "text"
    | "assignment_card"
    | "shared_content"
    | "appointment_request"
    | "appointment_response"
    | "appointment_time_proposed"
    | "appointment_confirmed";
  /**
   * Room messages support multiple rich-card schemas.
   * Narrow by `kind` / `card.type` before rendering or mutating.
   */
  card?: any;
  sharedContent?: SharedContentPayload;
  pending?: boolean;
  senderUserId?: string;
  senderRole?: string;
  role?: string;
  churchRole?: string;
  senderAvatar?: string;
  /**
   * Original text retained for Media Storage link indexing.
   * Do not render this value inside conversation bubbles.
   */
  storageText?: string;
  viewerTextDeleted?: boolean;
  viewerDeletedStorageItemIds?: string[];
};

export type ThreadMeta = {
  id: string;
  title: string;
  sub: string;
};

type StoreState = {
  threads: Record<string, ThreadMeta>;
  messages: Record<string, MsgItem[]>;
};

const KEY = "kristo_messages_store_real_schedule_only_20260416_runtime_meetingDate_fix_04";

let state: StoreState = {
  threads: {},
  messages: {},
};

let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  if (emitScheduled) return;
  emitScheduled = true;
  queueMicrotask(() => {
    emitScheduled = false;
    for (const l of Array.from(listeners)) l();
  });
}

let emitScheduled = false;

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreState;
      if (parsed && typeof parsed === "object") state = parsed;
    }
  } catch {
    // ignore
  }

  if (!Object.keys(state.threads).length) {
    ensureThread("g3", { title: "Pastor Desk", sub: "Private • counsel" });
    ensureThread("g2", { title: "Choir Team", sub: "Updates • rehearsal" });
    ensureThread("g1", { title: "Haizuri", sub: "Voice notes • 5 new" });

    sendMessage("g3", { text: "Karibu. Unaweza kuniandikia hapa.", attachments: [] }, { seedOther: true, name: "Pastor" });
    sendMessage("g2", { text: "Choir updates zitawekwa hapa.", attachments: [] }, { seedOther: true, name: "Leader" });
    sendMessage("g1", { text: "Voice notes + updates.", attachments: [] }, { seedOther: true, name: "Haizuri" });
  }

  emit();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  ensureLoaded();
  return () => {
    listeners.delete(fn);
  };
}

export function getSnapshot(): StoreState {
  return state;
}

function isAssignmentThreadMeta(meta: { title?: string; sub?: string }) {
  const title = String(meta?.title || "").toLowerCase();
  const sub = String(meta?.sub || "").toLowerCase();
  return (
    title.includes("assignment") ||
    sub.includes("assignment room") ||
    sub.includes("assignment")
  );
}


function formatAssignmentMeetingDayLabel(meetingDate?: string) {
  const raw = String(meetingDate || "").trim();
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function normalizeAssignmentCardPayload(card: AssignmentCardPayload): AssignmentCardPayload {
  const meetingDay = formatAssignmentMeetingDayLabel(card.meetingDate);
  const nextNotes = Array.isArray(card.notes) ? [...card.notes] : [];

  const cleanedNotes = nextNotes.filter(
    (note) => !/^meeting day:/i.test(String(note || "").trim())
  );

  if (meetingDay) {
    cleanedNotes.push(`Meeting day: ${meetingDay}`);
  }

  return {
    ...card,
    notes: cleanedNotes,
  };
}

function buildDemoAssignmentCards(): AssignmentCardPayload[] {
  const base = new Date();
  base.setSeconds(0, 0);
  base.setMinutes(0);
  base.setHours(19);

  const at = (minFromBase: number) =>
    new Date(base.getTime() + minFromBase * 60 * 1000).toISOString();

  return [
    {
      cardId: "assign_demo_choir_1",
      title: "Choir Session",
      subtitle: "Leaders meeting",
      roleKey: "choir",
      roleLabel: "Choir",
      slotLabel: "7:44 PM - 7:50 PM",
      durationMin: 6,
      meetingDate: at(44),
      task: "Choir session",
      script: "Prepare choir group and flow into next segment.",
      notes: [
        "Audience: All leaders",
        "Review detail: Select choir group",
        "Meeting day: Apr 03, 2026",
        "Weight used: 1.62",
      ],
      musicItems: [],
      status: "open",
      likeCount: 0,
      commentCount: 0,
    },
    {
      cardId: "assign_demo_announcement_1",
      title: "Announcements Part 2/2",
      subtitle: "Leaders meeting",
      roleKey: "announcer",
      roleLabel: "Announcer / MC",
      slotLabel: "7:50 PM - 7:52 PM",
      durationMin: 2,
      meetingDate: at(50),
      task: "Announcements Part 2/2",
      script: "No topic",
      notes: [
        "Audience: All leaders",
        "Review detail: Select announcer / MC",
        "Meeting day: Apr 03, 2026",
        "Weight used: 0.85",
      ],
      musicItems: [],
      status: "open",
      likeCount: 0,
      commentCount: 0,
    },
    {
      cardId: "assign_demo_announcement_2",
      title: "Announcements Part 3/3",
      subtitle: "Leaders meeting",
      roleKey: "announcer",
      roleLabel: "Announcer / MC",
      slotLabel: "7:52 PM - 7:55 PM",
      durationMin: 3,
      meetingDate: at(52),
      task: "Announcements Part 3/3",
      script: "No topic",
      notes: [
        "Audience: All leaders",
        "Review detail: Select announcer / MC",
        "Meeting day: Apr 03, 2026",
        "Weight used: 0.85",
      ],
      musicItems: [],
      status: "open",
      likeCount: 0,
      commentCount: 0,
    },
    {
      cardId: "assign_demo_prayer_1",
      title: "Closing Prayer",
      subtitle: "Leaders meeting",
      roleKey: "prayer",
      roleLabel: "Leader / Pastor",
      slotLabel: "7:55 PM - 8:00 PM",
      durationMin: 5,
      meetingDate: at(55),
      task: "Closing Prayer",
      script: "No topic",
      notes: [
        "Audience: All leaders",
        "Review detail: Select leader / pastor",
        "Meeting day: Apr 03, 2026",
        "Final adjusted to end exactly at selected time",
      ],
      musicItems: [],
      status: "open",
      likeCount: 0,
      commentCount: 0,
    },
  ];
}

function seedAssignmentThreadIfEmpty(threadId: string, meta: { title: string; sub: string }) {
  return;
}


function maybeSeedAssignmentThread(id: string, meta: { title: string; sub: string }) {
  return;
}

export function ensureThread(id: string, meta: { title: string; sub: string }) {
  if (!id) return;

  let changed = false;

  if (!state.threads[id]) {
    state.threads[id] = { id, title: meta.title || "Thread", sub: meta.sub || "" };
    if (!state.messages[id]) state.messages[id] = [];
    changed = true;
  } else {
    const t = state.threads[id];
    const nextTitle = meta.title || t.title;
    const nextSub = meta.sub || t.sub;
    if (nextTitle !== t.title || nextSub !== t.sub) {
      state.threads[id] = { ...t, title: nextTitle, sub: nextSub };
      changed = true;
    }
    if (!state.messages[id]) state.messages[id] = [];
  }

  // demo assignment auto-seed disabled: real cards must come from schedule sender only

  if (changed) {
    persist();
    emit();
  }
}

export function sendMessage(
  threadId: string,
  payload: {
    id?: string;
    clientId?: string;
    text?: string;
    attachments?: MsgAttachment[];
    pending?: boolean;
    senderUserId?: string;
    createdAt?: number;
    displayName?: string;
    senderRole?: string;
    role?: string;
    churchRole?: string;
    avatarUri?: string;
    senderAvatar?: string;
    kind?:
      | "text"
      | "assignment_card"
      | "shared_content"
      | "appointment_request"
    | "appointment_response"
    | "appointment_time_proposed"
    | "appointment_confirmed";
    sharedContent?: SharedContentPayload;
    card?: any;
  },
  opts?: { seedOther?: boolean; name?: string; disableAutoReply?: boolean }
) {
  if (!threadId) return;
  if (!state.messages[threadId]) state.messages[threadId] = [];
  if (!state.threads[threadId]) ensureThread(threadId, { title: "Thread", sub: "" });

  const now = payload.createdAt ?? Date.now();
  const id = String(payload.id || `msg_${now}_${Math.random().toString(16).slice(2)}`);

  const item: MsgItem = {
    id,
    clientId: payload.clientId || id,
    threadId,
    sender: opts?.seedOther ? "other" : "me",
    displayName: payload.displayName || (opts?.seedOther ? opts?.name || "User" : "Me"),
    text: payload.text || "",
    attachments: payload.attachments?.length ? payload.attachments : undefined,
    createdAt: now,
    kind: payload.kind || "text",
    card: payload.card,
    sharedContent: payload.sharedContent,
    pending: payload.pending,
    senderUserId: payload.senderUserId,
    senderRole: payload.senderRole,
    role: payload.role,
    churchRole: payload.churchRole,
    avatarUri: payload.avatarUri,
    senderAvatar: payload.senderAvatar || payload.avatarUri,
  };

  state.messages[threadId] = [item, ...(state.messages[threadId] || [])];
  persist();
  emit();

  if (!opts?.seedOther && !opts?.disableAutoReply) {
    const rid = `msg_${now + 1}_${Math.random().toString(16).slice(2)}`;
    const other: MsgItem = {
      id: rid,
      threadId,
      sender: "other",
      displayName: state.threads[threadId]?.title?.includes("Pastor") ? "Pastor" : "Leader",
      text: "Nimepokea. Nitajibu sasa hivi.",
      createdAt: now + 1,
      kind: "text",
    };
    state.messages[threadId] = [other, ...(state.messages[threadId] || [])];
    persist();
    emit();
  }
}

export function sendAssignmentCards(
  threadId: string,
  cards: AssignmentCardPayload[],
  opts?: { senderName?: string }
) {
  if (!threadId || !cards?.length) return;
  if (!state.messages[threadId]) state.messages[threadId] = [];
  if (!state.threads[threadId]) ensureThread(threadId, { title: "Assignment Room", sub: "assignment room" });

  const now = Date.now();

  const items: MsgItem[] = cards.map((card, index) => {
    const normalizedCard = normalizeAssignmentCardPayload(card);

    return {
      id: `cardmsg_${now}_${index}_${Math.random().toString(16).slice(2)}`,
      threadId,
      sender: "other",
      displayName: opts?.senderName || "Assignment Admin",
      createdAt: now + index,
      kind: "assignment_card",
      card: {
        ...normalizedCard,
        status: normalizedCard.status || "open",
      },
    };
  });

  state.messages[threadId] = [...items.reverse(), ...(state.messages[threadId] || [])];
  persist();
  emit();
}

export function claimAssignmentCard(
  threadId: string,
  messageId: string,
  actor: {
    userId: string;
    name: string;
    avatar?: string;
    role?: string;
  }
) {
  const arr = state.messages[threadId] || [];
  let changed = false;
  const actorUserId = String(actor.userId || "").trim();

  state.messages[threadId] = arr.map((m) => {
    if (m.id !== messageId || m.kind !== "assignment_card" || !m.card) return m;

    const existingOwner = String(m.card.claimedByUserId || "").trim();
    const cardStatus = String(m.card.status || "open").toLowerCase();
    if (existingOwner && existingOwner !== actorUserId) {
      console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
        slotId: messageId,
        existingClaimedByUserId: existingOwner,
        incomingUserId: actorUserId,
        source: "messagesStore.claimAssignmentCard",
      });
      return m;
    }
    if (cardStatus !== "open" && cardStatus !== "claimed") return m;
    if (false && cardStatus === "taken" && existingOwner && existingOwner !== actorUserId) return m;

    changed = true;
    return {
      ...m,
      card: {
        ...m.card,
        status: "taken",
        claimedByUserId: actor.userId,
        claimedByName: actor.name,
        claimedByAvatar: actor.avatar || "",
        claimedByRole: actor.role || "Member",
        claimedAt: Date.now(),
        likeCount: typeof m.card.likeCount === "number" ? m.card.likeCount : 0,
        commentCount: typeof m.card.commentCount === "number" ? m.card.commentCount : 0,
      },
    };
  });

  if (changed) {
    persist();
    emit();
  }

  return changed;
}

export function enrichAssignmentCardClaim(
  threadId: string,
  messageId: string,
  actor: {
    userId: string;
    name?: string;
    avatar?: string;
    role?: string;
  }
) {
  const arr = state.messages[threadId] || [];
  let changed = false;

  state.messages[threadId] = arr.map((m) => {
    if (m.id !== messageId || m.kind !== "assignment_card" || !m.card) return m;
    if (String(m.card.status || "").toLowerCase() !== "taken") return m;
    if (String(m.card.claimedByUserId || "") !== String(actor.userId || "")) return m;

    changed = true;
    return {
      ...m,
      card: {
        ...m.card,
        ...(actor.name ? { claimedByName: actor.name } : {}),
        ...(actor.avatar ? { claimedByAvatar: actor.avatar } : {}),
        ...(actor.role ? { claimedByRole: actor.role } : {}),
      },
    };
  });

  if (changed) {
    persist();
    emit();
  }

  return changed;
}

export function revertAssignmentCardClaim(
  threadId: string,
  messageId: string,
  claimedByUserId: string
) {
  const arr = state.messages[threadId] || [];
  let changed = false;

  state.messages[threadId] = arr.map((m) => {
    if (m.id !== messageId || m.kind !== "assignment_card" || !m.card) return m;
    if (String(m.card.claimedByUserId || "") !== String(claimedByUserId || "")) return m;
    if (String(m.card.status || "").toLowerCase() !== "taken") return m;

    changed = true;
    const nextCard = { ...m.card };
    delete (nextCard as any).claimedByUserId;
    delete (nextCard as any).claimedByName;
    delete (nextCard as any).claimedByAvatar;
    delete (nextCard as any).claimedByRole;
    delete (nextCard as any).claimedAt;

    return {
      ...m,
      card: {
        ...nextCard,
        status: "open",
      },
    };
  });

  if (changed) {
    persist();
    emit();
  }

  return changed;
}

export function addAssignmentCardVideo(
  threadId: string,
  messageId: string,
  video: {
    uri: string;
    title?: string;
    kind?: "upload" | "ministry";
    durationSec?: number;
  }
) {
  const uri = String(video?.uri || "").trim();
  if (!uri) return false;

  const arr = state.messages[threadId] || [];
  let changed = false;

  state.messages[threadId] = arr.map((m) => {
    if (m.id !== messageId || m.kind !== "assignment_card" || !m.card) return m;

    const nextVideos = Array.isArray((m.card as any).videoItems)
      ? [...((m.card as any).videoItems)]
      : [];

    const title = String(video?.title || "Video").trim() || "Video";
    const exists = nextVideos.some((x: any) => String(x?.uri || "").trim() == uri);

    if (!exists) {
      nextVideos.unshift({
        id: `video_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        uri,
        title,
        kind: video?.kind || "upload",
        durationSec: typeof video?.durationSec === "number" ? video.durationSec : undefined,
        addedAt: Date.now(),
      });
    }

    changed = true;
    return {
      ...m,
      card: {
        ...m.card,
        videoItems: nextVideos.slice(0, 8),
      },
    };
  });

  if (changed) {
    persist();
    emit();
  }

  return changed;
}

export function addAssignmentCardMusic(
  threadId: string,
  messageId: string,
  musicLabel: string
) {
  const value = String(musicLabel || "").trim();
  if (!value) return false;

  const arr = state.messages[threadId] || [];
  let changed = false;

  state.messages[threadId] = arr.map((m) => {
    if (m.id !== messageId || m.kind !== "assignment_card" || !m.card) return m;

    const nextMusic = Array.isArray(m.card.musicItems) ? [...m.card.musicItems] : [];
    if (!nextMusic.includes(value)) nextMusic.unshift(value);

    changed = true;
    return {
      ...m,
      card: {
        ...m.card,
        musicItems: nextMusic.slice(0, 8),
      },
    };
  });

  if (changed) {
    persist();
    emit();
  }

  return changed;
}

export function deleteMessage(threadId: string, messageId: string) {
  const arr = state.messages[threadId] || [];
  state.messages[threadId] = arr.filter((m) => m.id !== messageId);
  persist();
  emit();
}

export function reconcileMessage(threadId: string, optimisticId: string, backendItem: MsgItem) {
  if (!threadId) return;
  const arr = state.messages[threadId] || [];
  const withoutOptimistic = arr.filter((m) => m.id !== optimisticId);
  const withoutDuplicateBackend = withoutOptimistic.filter((m) => m.id !== backendItem.id);
  state.messages[threadId] = [{ ...backendItem, pending: false }, ...withoutDuplicateBackend];
  persist();
  emit();
}

export function clearThreadMessages(threadId: string) {
  if (!threadId) return;
  state.messages[threadId] = [];
  persist();
  emit();
}

export function clearThreadTextMessages(
  threadId: string
) {
  if (!threadId) return;

  const items =
    state.messages[threadId] || [];

  state.messages[threadId] =
    items.map((message) => {
      const text = String(
        message.text || ""
      );

      if (!text.trim()) {
        return message;
      }

      return {
        ...message,
        storageText:
          String(
            message.storageText || text
          ),
        text: "",
        viewerTextDeleted: true,
      };
    });

  persist();
  emit();
}

function shouldRemoveAssignmentCard(
  m: MsgItem,
  opts?: {
    cardIds?: Set<string>;
    clearAllAssignmentCards?: boolean;
    scheduleBatchId?: string;
  }
) {
  if (m.kind !== "assignment_card" || !m.card) return false;

  if (opts?.clearAllAssignmentCards) return true;

  const card = m.card as AssignmentCardPayload & Record<string, unknown>;
  const cardId = String(card.cardId || "").trim();
  const messageId = String(m.id || "").trim();
  const cardIdSet = opts?.cardIds;

  if (cardIdSet && cardIdSet.size > 0) {
    if (cardIdSet.has(cardId) || cardIdSet.has(messageId)) return true;

    const slotLabel = String((card as any).slotLabel || "").trim();
    const slotNumber = String((card as any).slotNumber || "").trim();
    for (const id of cardIdSet) {
      if (slotLabel && id.includes(slotLabel)) return true;
      if (slotNumber && id.includes(slotNumber)) return true;
    }
  }

  const scheduleBatchId = String(opts?.scheduleBatchId || "").trim();
  if (
    scheduleBatchId &&
    String((card as any).scheduleBatchId || "").trim() === scheduleBatchId
  ) {
    return true;
  }

  return false;
}

export function removeAssignmentCardsFromThread(
  threadId: string,
  opts?: {
    cardIds?: string[];
    clearAllAssignmentCards?: boolean;
    scheduleBatchId?: string;
  }
): { removedCount: number; removedIds: string[] } {
  if (!threadId) return { removedCount: 0, removedIds: [] };

  const arr = state.messages[threadId] || [];
  const cardIdSet = new Set(
    (opts?.cardIds || []).map((x) => String(x || "").trim()).filter(Boolean)
  );
  const hasFilter =
    !!opts?.clearAllAssignmentCards ||
    cardIdSet.size > 0 ||
    !!String(opts?.scheduleBatchId || "").trim();

  if (!hasFilter) return { removedCount: 0, removedIds: [] };

  const removedIds: string[] = [];
  const next = arr.filter((m) => {
    const shouldRemove = shouldRemoveAssignmentCard(m, {
      cardIds: cardIdSet,
      clearAllAssignmentCards: opts?.clearAllAssignmentCards,
      scheduleBatchId: opts?.scheduleBatchId,
    });
    if (shouldRemove) {
      removedIds.push(String(m.id || (m.card as any)?.cardId || ""));
    }
    return !shouldRemove;
  });

  const removedCount = arr.length - next.length;
  if (removedCount > 0) {
    state.messages[threadId] = next;
    persist();
    emit();
  }

  return { removedCount, removedIds: removedIds.filter(Boolean) };
}

export function removeAssignmentCardsFromThreads(
  threadIds: string[],
  opts?: {
    cardIds?: string[];
    clearAllAssignmentCards?: boolean;
    scheduleBatchId?: string;
  }
): { removedCount: number; removedIds: string[] } {
  const removedIds: string[] = [];
  let removedCount = 0;

  for (const threadId of threadIds) {
    const result = removeAssignmentCardsFromThread(threadId, opts);
    removedCount += result.removedCount;
    removedIds.push(...result.removedIds);
  }

  return { removedCount, removedIds };
}

export function useThread(threadId: string): { messages: MsgItem[]; meta?: ThreadMeta } {
  const [, force] = React.useState(0);

  React.useEffect(() => subscribe(() => force((x) => x + 1)), []);

  const snap = getSnapshot();
  return { meta: snap.threads[threadId], messages: snap.messages[threadId] || [] };
}

export function setThreadMessages(threadId: string, items: MsgItem[], meta?: { title?: string; sub?: string }) {
  if (!threadId) return;
  if (!state.threads[threadId]) {
    state.threads[threadId] = { id: threadId, title: meta?.title || "Thread", sub: meta?.sub || "" };
  }
  state.messages[threadId] = Array.isArray(items) ? items : [];
  persist();
  emit();
}
