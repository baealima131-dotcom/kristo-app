import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import {
  isFeedChurchBlockDatabaseError,
  listViewerChurchBlocks,
  removeViewerChurchBlock,
  upsertViewerChurchBlock,
  type ChurchFeedActionType,
} from "@/app/api/_lib/store/feedChurchBlockDb";
import { createModerationEvent } from "@/app/api/_lib/store/moderationEventsDb";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function cleanChurchId(raw: unknown) {
  return String(raw || "").trim().toUpperCase();
}

function parseActionType(raw: unknown): ChurchFeedActionType | null {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "hide" || value === "block") return value;
  return null;
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const records = await listViewerChurchBlocks(ctxOrRes.viewer.userId);
    const hiddenChurchIds = records
      .filter((row) => row.actionType === "hide")
      .map((row) => row.churchId);
    const blockedChurchIds = records
      .filter((row) => row.actionType === "block")
      .map((row) => row.churchId);
    const feedExcludedChurchIds = records.map((row) => row.churchId);

    return json({
      ok: true,
      data: {
        records: records.map((row) => ({
          churchId: row.churchId,
          actionType: row.actionType,
          reason: row.reason || "",
          updatedAt: row.updatedAt,
        })),
        hiddenChurchIds,
        blockedChurchIds,
        feedExcludedChurchIds,
      },
    });
  } catch (error) {
    if (isFeedChurchBlockDatabaseError(error)) {
      return json({ ok: false, error: "Church block store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/block-church] GET failed", error);
    return json({ ok: false, error: "Failed to load church blocks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const churchId = cleanChurchId(body?.churchId);
  const actionType = parseActionType(body?.actionType);
  const reason = String(body?.reason || "").trim();

  if (!churchId) {
    return json({ ok: false, error: "churchId required" }, { status: 400 });
  }
  if (!actionType) {
    return json({ ok: false, error: "actionType must be hide or block" }, { status: 400 });
  }

  try {
    const record = await upsertViewerChurchBlock({
      viewerUserId: ctxOrRes.viewer.userId,
      churchId,
      actionType,
      reason,
    });

    await createModerationEvent({
      eventType: actionType === "block" ? "block_church" : "hide_church",
      actorUserId: ctxOrRes.viewer.userId,
      actorChurchId: ctxOrRes.churchId || "",
      targetChurchId: churchId,
      reason: reason || (actionType === "block" ? "Blocked church from feed" : "Hidden church from feed"),
      details: "",
    }).catch(() => {});

    return json({
      ok: true,
      data: {
        churchId: record.churchId,
        actionType: record.actionType,
      },
    });
  } catch (error) {
    if (isFeedChurchBlockDatabaseError(error)) {
      return json({ ok: false, error: "Church block store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/block-church] POST failed", error);
    return json({ ok: false, error: "Failed to update church block" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  let churchId = cleanChurchId(url.searchParams.get("churchId"));

  if (!churchId) {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    churchId = cleanChurchId(body?.churchId);
  }

  if (!churchId) {
    return json({ ok: false, error: "churchId required" }, { status: 400 });
  }

  try {
    const removed = await removeViewerChurchBlock(ctxOrRes.viewer.userId, churchId);
    return json({ ok: true, removed });
  } catch (error) {
    if (isFeedChurchBlockDatabaseError(error)) {
      return json({ ok: false, error: "Church block store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/block-church] DELETE failed", error);
    return json({ ok: false, error: "Failed to remove church block" }, { status: 500 });
  }
}
