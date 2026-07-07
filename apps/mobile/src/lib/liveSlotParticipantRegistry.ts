export type LiveSlotParticipantSnapshot = {
  joined: boolean;
  cameraEnabled: boolean;
  disconnected: boolean;
  lastSeenAt: number;
};

const participantStore: Record<string, LiveSlotParticipantSnapshot> = {};
const everJoinedStore: Record<string, boolean> = {};
const cameraPausedOverrideByUserId: Record<string, boolean> = {};

export function extractUserIdFromLiveKitIdentity(identity: string): string {
  return String(identity || "")
    .split("-slot-")[0]
    .split("-viewer")[0]
    .split("-mic")[0]
    .replace(/[^a-zA-Z0-9_]/g, "");
}

function participantHasCameraEnabled(participant: any): boolean {
  if (!participant) return false;
  if (typeof participant?.isCameraEnabled === "boolean" && !participant.isCameraEnabled) {
    return false;
  }
  try {
    const pubs = Array.from(participant?.trackPublications?.values?.() || []) as any[];
    return pubs.some((pub) => {
      const kind = String(pub?.kind || pub?.track?.kind || "").toLowerCase();
      const source = String(pub?.source || "").toLowerCase();
      const isVideo = kind === "video" || source.includes("camera");
      if (!isVideo) return false;
      if (pub?.isMuted === true || pub?.muted === true) return false;
      const track = pub?.track;
      if (!track) return false;
      if (track?.isMuted === true) return false;
      if (track?.mediaStreamTrack?.enabled === false) return false;
      return true;
    });
  } catch {
    return false;
  }
}

export function syncLiveSlotParticipantsFromRoom(room: any) {
  if (!room) return;
  const now = Date.now();
  const seen = new Set<string>();

  const ingest = (participant: any) => {
    const userId = extractUserIdFromLiveKitIdentity(String(participant?.identity || ""));
    if (!userId) return;
    seen.add(userId);
    let cameraEnabled = participantHasCameraEnabled(participant);
    if (isLiveSlotParticipantCameraPausedOverride(userId)) {
      cameraEnabled = false;
    }
    participantStore[userId] = {
      joined: true,
      cameraEnabled,
      disconnected: false,
      lastSeenAt: now,
    };
    everJoinedStore[userId] = true;
  };

  ingest((room as any)?.localParticipant);
  const remotes = Array.from((room as any)?.remoteParticipants?.values?.() || []);
  remotes.forEach((participant) => ingest(participant));

  Object.keys(everJoinedStore).forEach((userId) => {
    if (seen.has(userId)) return;
    if (!everJoinedStore[userId]) return;
    participantStore[userId] = {
      joined: false,
      cameraEnabled: false,
      disconnected: true,
      lastSeenAt: participantStore[userId]?.lastSeenAt || now,
    };
  });
}

export function getLiveSlotParticipantState(
  userId: string
): LiveSlotParticipantSnapshot | null {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  return participantStore[uid] || null;
}

export function isRemoteParticipantInRoom(room: any, userId: string): boolean {
  const uid = String(userId || "").trim();
  if (!uid || !room) return false;
  try {
    const remotes = Array.from((room as any)?.remoteParticipants?.values?.() || []) as any[];
    return remotes.some(
      (participant) =>
        extractUserIdFromLiveKitIdentity(String(participant?.identity || "")) === uid
    );
  } catch {
    return false;
  }
}

export function setLiveSlotParticipantCameraPausedOverride(
  userId: string,
  paused: boolean
) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (paused) {
    cameraPausedOverrideByUserId[uid] = true;
  } else {
    delete cameraPausedOverrideByUserId[uid];
  }
  const existing = participantStore[uid];
  if (existing) {
    participantStore[uid] = {
      ...existing,
      cameraEnabled: !paused,
      lastSeenAt: Date.now(),
    };
  }
}

export function isLiveSlotParticipantCameraPausedOverride(userId: string): boolean {
  return cameraPausedOverrideByUserId[String(userId || "").trim()] === true;
}

export function resetLiveSlotParticipantRegistry() {
  Object.keys(participantStore).forEach((key) => delete participantStore[key]);
  Object.keys(everJoinedStore).forEach((key) => delete everJoinedStore[key]);
  Object.keys(cameraPausedOverrideByUserId).forEach(
    (key) => delete cameraPausedOverrideByUserId[key]
  );
}
