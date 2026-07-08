import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

const STORE_FILE = "private_call_sessions.json";

export type PrivateCallStatus =
  | "ringing"
  | "accepted"
  | "declined"
  | "ended"
  | "timeout"
  | "failed";

export type PrivateCallSession = {
  id: string;
  churchId: string;
  roomName: string;
  callerUserId: string;
  callerName: string;
  callerAvatarUrl?: string;
  pastorUserId: string;
  pastorName: string;
  pastorAvatarUrl?: string;
  pastorSourceField: string;
  status: PrivateCallStatus;
  createdAt: string;
  updatedAt: string;
  ringExpiresAt: string;
  acceptedAt?: string;
  endedAt?: string;
  endedReason?: string;
};

type PrivateCallStore = {
  sessions: PrivateCallSession[];
};

const RING_TIMEOUT_MS = 45_000;

function defaultStore(): PrivateCallStore {
  return { sessions: [] };
}

function nowIso() {
  return new Date().toISOString();
}

function newCallId() {
  return `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pruneExpired(store: PrivateCallStore): PrivateCallStore {
  const now = Date.now();
  let changed = false;
  const sessions = store.sessions.map((session) => {
    if (session.status !== "ringing") return session;
    const expires = Date.parse(String(session.ringExpiresAt || ""));
    if (!Number.isFinite(expires) || expires > now) return session;
    changed = true;
    return {
      ...session,
      status: "timeout" as const,
      updatedAt: nowIso(),
      endedAt: nowIso(),
      endedReason: "ring-timeout",
    };
  });
  return changed ? { sessions } : store;
}

async function readStore(): Promise<PrivateCallStore> {
  const raw = await readJsonFile<PrivateCallStore>(STORE_FILE, defaultStore());
  return pruneExpired(raw);
}

async function writeStore(mutator: (current: PrivateCallStore) => PrivateCallStore) {
  return updateJsonFile<PrivateCallStore>(STORE_FILE, mutator, defaultStore());
}

export function buildPrivateCallRoomName(churchId: string, callId: string) {
  const cid = String(churchId || "").trim();
  const id = String(callId || "").trim();
  return `private-call-${cid}-${id}`;
}

export async function createPrivateCallSession(input: {
  churchId: string;
  callerUserId: string;
  callerName: string;
  callerAvatarUrl?: string;
  pastorUserId: string;
  pastorName: string;
  pastorAvatarUrl?: string;
  pastorSourceField: string;
}): Promise<PrivateCallSession> {
  const callId = newCallId();
  const createdAt = nowIso();
  const session: PrivateCallSession = {
    id: callId,
    churchId: String(input.churchId || "").trim(),
    roomName: buildPrivateCallRoomName(input.churchId, callId),
    callerUserId: String(input.callerUserId || "").trim(),
    callerName: String(input.callerName || "Church member").trim(),
    callerAvatarUrl: String(input.callerAvatarUrl || "").trim() || undefined,
    pastorUserId: String(input.pastorUserId || "").trim(),
    pastorName: String(input.pastorName || "Pastor").trim(),
    pastorAvatarUrl: String(input.pastorAvatarUrl || "").trim() || undefined,
    pastorSourceField: String(input.pastorSourceField || "").trim(),
    status: "ringing",
    createdAt,
    updatedAt: createdAt,
    ringExpiresAt: new Date(Date.now() + RING_TIMEOUT_MS).toISOString(),
  };

  await writeStore((current) => {
    const next = pruneExpired(current);
    return {
      sessions: [session, ...next.sessions.filter((s) => s.id !== session.id)].slice(0, 200),
    };
  });

  return session;
}

export async function getPrivateCallSession(callId: string): Promise<PrivateCallSession | null> {
  const store = await readStore();
  return store.sessions.find((s) => s.id === String(callId || "").trim()) || null;
}

export async function listPrivateCallSessionsForUser(userId: string): Promise<PrivateCallSession[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const store = await readStore();
  return store.sessions.filter(
    (s) => s.callerUserId === uid || s.pastorUserId === uid
  );
}

export async function listRingingCallsForPastor(pastorUserId: string): Promise<PrivateCallSession[]> {
  const uid = String(pastorUserId || "").trim();
  const store = await readStore();
  return store.sessions.filter((s) => s.pastorUserId === uid && s.status === "ringing");
}

export async function updatePrivateCallSession(
  callId: string,
  mutator: (session: PrivateCallSession) => PrivateCallSession
): Promise<PrivateCallSession | null> {
  let updated: PrivateCallSession | null = null;

  await writeStore((current) => {
    const store = pruneExpired(current);
    const idx = store.sessions.findIndex((s) => s.id === String(callId || "").trim());
    if (idx < 0) return store;

    const nextSession = mutator(store.sessions[idx]);
    updated = nextSession;
    const sessions = store.sessions.slice();
    sessions[idx] = nextSession;
    return { sessions };
  });

  return updated;
}
