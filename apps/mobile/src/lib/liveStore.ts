type LiveComment = {
  id: string;
  name: string;
  text: string;
};

type LiveRoom = {
  id: string;
  title: string;
  isLive: boolean;
  isPaused: boolean;
  micMuted: boolean;
  commentsHidden: boolean;
  viewerCount: number;
  membersCount: number;
  leadersCount: number;
  comments: LiveComment[];
};

type Listener = () => void;

let room: LiveRoom = {
  id: "room-1",
  title: "Youth",
  isLive: true,
  isPaused: false,
  micMuted: false,
  commentsHidden: false,
  viewerCount: 4,
  membersCount: 26,
  leadersCount: 4,
  comments: [
    { id: "1", name: "Diana", text: "Tuko pamoja live" },
    { id: "2", name: "Neema", text: "Amina 🙏" },
  ],
};

const listeners = new Set<Listener>();
const presenceByKey = new Map<string, { role: "host" | "viewer"; joinedAt: number }>();

function emit() {
  if (emitScheduled) return;
  emitScheduled = true;
  queueMicrotask(() => {
    emitScheduled = false;
    listeners.forEach((l) => l());
  });
}

let emitScheduled = false;

function recomputeViewerCount() {
  const activeCount = presenceByKey.size;
  const organicLift = room.isLive ? Math.min(3, Math.floor(room.comments.length / 4)) : 0;
  const minimumViewers = Math.max(1, room.leadersCount);
  const next = minimumViewers + activeCount + organicLift;
  room.viewerCount = Math.min(room.membersCount, Math.max(minimumViewers, next));
}

export function subscribeLiveRoom(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLiveRoom(seed?: { membersCount?: number; leadersCount?: number }) {
  const React = require("react");
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    if (seed?.membersCount && Number.isFinite(seed.membersCount)) {
      room.membersCount = Math.max(1, seed.membersCount);
    }
    if (seed?.leadersCount && Number.isFinite(seed.leadersCount)) {
      room.leadersCount = Math.max(1, Math.min(room.membersCount, seed.leadersCount));
    }
    recomputeViewerCount();

    const unsub = subscribeLiveRoom(() => setTick((x: number) => x + 1));
    return unsub;
  }, [seed?.membersCount, seed?.leadersCount]);

  return room;
}

export function joinLiveRoomSession(key: string, role: "host" | "viewer" = "viewer") {
  if (!key) return;
  presenceByKey.set(key, { role, joinedAt: Date.now() });
  recomputeViewerCount();
  emit();
}

export function leaveLiveRoomSession(key: string) {
  if (!key) return;
  if (!presenceByKey.has(key)) return;
  presenceByKey.delete(key);
  recomputeViewerCount();
  emit();
}

export function togglePause() {
  room.isPaused = !room.isPaused;
  emit();
}

export function toggleMic() {
  room.micMuted = !room.micMuted;
  emit();
}

export function toggleComments() {
  room.commentsHidden = !room.commentsHidden;
  emit();
}

export function addComment(text: string) {
  room.comments.unshift({
    id: String(Date.now()),
    name: "You",
    text,
  });
  emit();
}

export function endLive() {
  room.isLive = false;
  emit();
}

export function getLivePresenceSnapshot() {
  return {
    viewerCount: room.viewerCount,
    activeSessions: Array.from(presenceByKey.entries()).map(([key, value]) => ({
      key,
      ...value,
    })),
  };
}
