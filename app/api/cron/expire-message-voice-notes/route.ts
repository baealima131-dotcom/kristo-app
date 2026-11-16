import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import {
  deleteRoomAttachmentObjectByPublicUrl,
  getVideoStorageConfig,
} from "@/app/api/_lib/media/objectStorage";
import { readRoomMessagesJsonFile } from "@/app/api/_lib/store/roomMessageDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_NOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILES_PER_RUN = 2000;

function isAuthorized(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.get("authorization") || ""));
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function attachmentUrl(attachment: any) {
  return String(
    attachment?.url ||
      attachment?.uri ||
      attachment?.fileUri ||
      ""
  ).trim();
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!getVideoStorageConfig()) {
    return NextResponse.json(
      { ok: false, error: "Voice-note storage is not configured." },
      { status: 503 }
    );
  }

  try {
    const store = await readRoomMessagesJsonFile<Record<string, any[]>>(
      "room-messages.json",
      {}
    );
    const now = Date.now();
    const urls = new Set<string>();

    for (const messages of Object.values(store || {})) {
      for (const message of Array.isArray(messages) ? messages : []) {
        const createdAt = Number(message?.createdAt || 0);
        for (const attachment of Array.isArray(message?.attachments) ? message.attachments : []) {
          if (attachment?.voiceNote !== true) continue;
          const expiresAt = Number(attachment?.expiresAt || (createdAt + VOICE_NOTE_TTL_MS));
          if (!expiresAt || expiresAt > now) continue;
          const url = attachmentUrl(attachment);
          if (url) urls.add(url);
          if (urls.size >= MAX_FILES_PER_RUN) break;
        }
        if (urls.size >= MAX_FILES_PER_RUN) break;
      }
      if (urls.size >= MAX_FILES_PER_RUN) break;
    }

    let deleted = 0;
    let skipped = 0;
    const rows = [...urls];
    for (let offset = 0; offset < rows.length; offset += 20) {
      const batch = rows.slice(offset, offset + 20);
      const results = await Promise.allSettled(
        batch.map((url) => deleteRoomAttachmentObjectByPublicUrl(url))
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) deleted += 1;
        else skipped += 1;
      }
    }

    console.log("KRISTO_EXPIRED_VOICE_NOTES_CLEANED", {
      scannedRooms: Object.keys(store || {}).length,
      expiredFilesFound: rows.length,
      deleted,
      skipped,
    });

    return NextResponse.json({
      ok: true,
      scannedRooms: Object.keys(store || {}).length,
      expiredFilesFound: rows.length,
      deleted,
      skipped,
      limitReached: rows.length >= MAX_FILES_PER_RUN,
    });
  } catch (error: any) {
    console.error("KRISTO_EXPIRED_VOICE_NOTES_CLEANUP_FAILED", {
      message: String(error?.message || error),
    });
    return NextResponse.json(
      { ok: false, error: "Voice-note cleanup failed." },
      { status: 500 }
    );
  }
}
