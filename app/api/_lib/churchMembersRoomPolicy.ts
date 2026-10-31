import { promises as fs } from "fs";
import path from "path";
import {
  deleteStorageObjects,
  getVideoStorageConfig,
  storageKeyFromPublicUrl,
} from "@/app/api/_lib/media/objectStorage";

/**
 * Church Members room (Church Live Control, roomId "church-media-room") policy:
 * - Voice notes expire 7 days after they are sent; the message and its audio file are deleted.
 * - Members see only the last 7 days of messages (server time). Older text messages are hidden
 *   from members, not deleted; leaders keep the full history. Live slot cards are schedule
 *   items, not chat history, so they are never hidden by this window.
 */
export const CHURCH_MEMBERS_ROOM_ID = "church-media-room";
export const VOICE_NOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEMBER_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const VOICE_NOTE_MAX_DURATION_MS = 5 * 60 * 1000;

/** Only files uploaded through the room attachment route may be deleted by the voice-note purge. */
const ROOM_ATTACHMENT_KEY_PREFIX = "uploads/room-attachments/";

const FULL_HISTORY_ROLES = new Set(["leader", "ministry_leader", "church_admin", "pastor", "system_admin"]);

export function isChurchMembersRoom(roomId: unknown) {
  return String(roomId || "").trim() === CHURCH_MEMBERS_ROOM_ID;
}

export function isVoiceNoteMessage(m: any) {
  return String(m?.kind || "") === "voice_note";
}

export function isAudioAttachment(att: any) {
  const mime = String(att?.mime || att?.mimeType || "").toLowerCase();
  return mime.startsWith("audio/") && Boolean(String(att?.url || "").trim());
}

export function voiceNoteExpiresAt(createdAt: number) {
  return createdAt + VOICE_NOTE_TTL_MS;
}

export function isExpiredVoiceNote(m: any, nowMs: number) {
  if (!isVoiceNoteMessage(m)) return false;
  const expiresAt = Number(m?.expiresAt || 0) || voiceNoteExpiresAt(Number(m?.createdAt || 0));
  return expiresAt <= nowMs;
}

/** Oldest createdAt a viewer may see, or null for full history (leaders). */
export function memberHistoryCutoffMs(churchRole: string, nowMs: number): number | null {
  const role = String(churchRole || "").trim().toLowerCase();
  if (FULL_HISTORY_ROLES.has(role)) return null;
  return nowMs - MEMBER_HISTORY_WINDOW_MS;
}

export function isVisibleUnderHistoryWindow(m: any, cutoffMs: number | null) {
  if (cutoffMs == null) return true;
  if (String(m?.kind || "") === "assignment_card") return true;
  return Number(m?.createdAt || 0) >= cutoffMs;
}

function roomAttachmentKeyFromUrl(url: string): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const fromStorage = storageKeyFromPublicUrl(raw);
  const key = fromStorage || (raw.startsWith("/uploads/") ? raw.slice(1) : "");
  if (!key || !key.startsWith(ROOM_ATTACHMENT_KEY_PREFIX) || key.includes("..")) return null;
  return key;
}

/**
 * Deletes the audio files of expired voice notes. Returns the ids of messages whose files are
 * gone (or had no deletable file); messages whose deletion failed are kept for the next purge.
 */
export async function deleteVoiceNoteFiles(messages: any[]): Promise<Set<string>> {
  const done = new Set<string>();
  const useObjectStorage = Boolean(getVideoStorageConfig());
  const remote: { id: string; key: string }[] = [];

  for (const m of messages) {
    const id = String(m?.id || "");
    const keys = (Array.isArray(m?.attachments) ? m.attachments : [])
      .map((att: any) => roomAttachmentKeyFromUrl(String(att?.url || att?.uri || "")))
      .filter((key: string | null): key is string => Boolean(key));
    if (useObjectStorage) {
      if (!keys.length) done.add(id);
      for (const key of keys) remote.push({ id, key });
      continue;
    }
    // Local development: files live under public/uploads.
    let ok = true;
    for (const key of keys) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", key));
      } catch (e: any) {
        if (e?.code !== "ENOENT") ok = false;
      }
    }
    if (ok) done.add(id);
  }

  if (remote.length) {
    try {
      const failedKeys = await deleteStorageObjects(remote.map((r) => r.key));
      const failedIds = new Set(remote.filter((r) => failedKeys.has(r.key)).map((r) => r.id));
      for (const r of remote) if (!failedIds.has(r.id)) done.add(r.id);
    } catch (e) {
      console.log("KRISTO_VOICE_NOTE_STORAGE_DELETE_FAILED", { error: String((e as any)?.message || e) });
    }
  }
  return done;
}
