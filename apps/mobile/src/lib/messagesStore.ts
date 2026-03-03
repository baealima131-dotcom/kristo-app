import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";

export type MsgAttachment = {
  id: string;
  kind: "image" | "file";
  uri: string;
  name: string;
  mime: string;
  size?: number;
};

export type MsgItem = {
  id: string;
  threadId: string;
  sender: "me" | "other";
  displayName?: string;
  text?: string;
  attachments?: MsgAttachment[];
  createdAt: number;
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

const KEY = "kristo_messages_store_v1";

let state: StoreState = {
  threads: {},
  messages: {},
};

let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of Array.from(listeners)) l();
}

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

  // seed if empty
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
  return () => { listeners.delete(fn); };
}

export function getSnapshot(): StoreState {
  return state;
}

export function ensureThread(id: string, meta: { title: string; sub: string }) {
  if (!id) return;

  if (!state.threads[id]) {
    state.threads[id] = { id, title: meta.title || "Thread", sub: meta.sub || "" };
    if (!state.messages[id]) state.messages[id] = [];
    persist();
    emit();
  } else {
    const t = state.threads[id];
    const nextTitle = meta.title || t.title;
    const nextSub = meta.sub || t.sub;
    if (nextTitle !== t.title || nextSub !== t.sub) {
      state.threads[id] = { ...t, title: nextTitle, sub: nextSub };
      persist();
      emit();
    }
  }
}

export function sendMessage(
  threadId: string,
  payload: { text?: string; attachments?: MsgAttachment[] },
  opts?: { seedOther?: boolean; name?: string }
) {
  if (!threadId) return;
  if (!state.messages[threadId]) state.messages[threadId] = [];
  if (!state.threads[threadId]) ensureThread(threadId, { title: "Thread", sub: "" });

  const now = Date.now();
  const id = `msg_${now}_${Math.random().toString(16).slice(2)}`;

  const item: MsgItem = {
    id,
    threadId,
    sender: opts?.seedOther ? "other" : "me",
    displayName: opts?.seedOther ? opts?.name || "User" : "Me",
    text: payload.text || "",
    attachments: payload.attachments?.length ? payload.attachments : undefined,
    createdAt: now,
  };

  // inverted list friendly (newest first)
  state.messages[threadId] = [item, ...(state.messages[threadId] || [])];
  persist();
  emit();

  // simple auto-reply for demo (only when user sends)
  if (!opts?.seedOther) {
    const rid = `msg_${now + 1}_${Math.random().toString(16).slice(2)}`;
    const other: MsgItem = {
      id: rid,
      threadId,
      sender: "other",
      displayName: state.threads[threadId]?.title?.includes("Pastor") ? "Pastor" : "Leader",
      text: "Nimepokea. Nitajibu sasa hivi.",
      createdAt: now + 1,
    };
    state.messages[threadId] = [other, ...(state.messages[threadId] || [])];
    persist();
    emit();
  }
}

export function deleteMessage(threadId: string, messageId: string) {
  const arr = state.messages[threadId] || [];
  state.messages[threadId] = arr.filter((m) => m.id !== messageId);
  persist();
  emit();
}

export function useThread(threadId: string): { messages: MsgItem[]; meta?: ThreadMeta } {
  const [, force] = React.useState(0);

  React.useEffect(() => subscribe(() => force((x) => x + 1)), []);

  const snap = getSnapshot();
  return { meta: snap.threads[threadId], messages: snap.messages[threadId] || [] };
}
