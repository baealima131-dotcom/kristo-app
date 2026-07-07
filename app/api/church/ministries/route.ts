import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  isMinistryDatabaseError,
  readMinistryJsonFile as readJsonFile,
  updateMinistryJsonFile as updateJsonFile,
} from "@/app/api/_lib/store/ministryDb";
import { logAudit } from "@/app/api/_lib/audit";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import {
  requireChurchSubscriptionActive,
} from "@/app/api/_lib/churchSubscription";
import { getUserJoinedMinistries, logMinistryScope, resolveMinistryViewerUserId } from "@/app/api/_lib/ministryMembership";
import {
  MINISTRY_MEDIA_ACCESS_LIMIT,
  MINISTRY_MEDIA_ACCESS_LIMIT_CODE,
  countChurchMinistriesWithMediaAccess,
  extractMinistryMediaAccessFromBody,
  logMinistryMediaAccessLimit,
  materializeMinistryMediaAccessRecord,
  ministryMediaAccessLimitPayload,
  parseMinistryMediaAccessInput,
} from "@/lib/ministryMediaAccessLimit";
import {
  logMinistryMediaAccessLoad,
  logMinistryMediaAccessSave,
} from "@/lib/ministryMediaAccessTrace";

/* =========================
   TYPES
   ========================= */

type MinistryStatus = "Active" | "Paused";

type Ministry = {
  id: string;
  name: string;
  description?: string;
  avatarUri?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
  createdByUserId?: string;
  mediaAccess?: boolean;
};

type ApiErr = { ok: false; error: string; details?: unknown };
type ApiOk<T> = { ok: true; data: T };

const STORE_FILE = "ministries.json";

// VIP constraints (keeps data clean)
const NAME_MAX = 80;
const DESC_MAX = 700;

/* =========================
   HELPERS
   ========================= */

function json<T>(data: ApiOk<T> | ApiErr, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function nowIso() {
  return new Date().toISOString();
}

function isStatus(x: string): x is MinistryStatus {
  return x === "Active" || x === "Paused";
}

function parseStatus(input: unknown, fallback: MinistryStatus): MinistryStatus | null {
  if (input === undefined || input === null) return fallback;
  const s = String(input).trim();
  return isStatus(s) ? s : null;
}

function parseDescription(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  return s.length > DESC_MAX ? s.slice(0, DESC_MAX) : s;
}


function parseAvatarUri(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;

  const s = String(input).trim();
  if (!s) return undefined;

  const ok =
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("file://") ||
    s.startsWith("content://") ||
    s.startsWith("/");

  if (!ok) return undefined;

  return s.length > 1200 ? s.slice(0, 1200) : s;
}

function sanitizeName(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX) : s;
}

function id(prefix = "min") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function readAll(): Promise<Ministry[]> {
  const data = await readJsonFile<Ministry[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

function normalizeMinistryId(raw: unknown): string {
  try {
    return decodeURIComponent(String(raw || "").trim());
  } catch {
    return String(raw || "").trim();
  }
}

function normalizeChurchId(raw: unknown): string {
  return String(raw || "").trim();
}

function churchIdsMatch(stored: unknown, requested: string): boolean {
  return (
    normalizeChurchId(stored).toLowerCase() === normalizeChurchId(requested).toLowerCase()
  );
}

function findMinistryInChurch(
  all: Ministry[],
  churchId: string,
  requestedId: string
): Ministry | undefined {
  const normalizedId = normalizeMinistryId(requestedId);
  return all.find(
    (m) =>
      churchIdsMatch(m.churchId, churchId) &&
      normalizeMinistryId(m.id) === normalizedId
  );
}

function listMinistryIdsForChurch(all: Ministry[], churchId: string): string[] {
  return all
    .filter((m) => churchIdsMatch(m.churchId, churchId))
    .map((m) => String(m.id || ""))
    .filter(Boolean);
}

function logMinistryDeleteLookup(payload: Record<string, unknown>) {
  console.log("KRISTO_MINISTRY_DELETE_LOOKUP", payload);
}

const MINISTRY_MEMBERS_FILE = "ministry-members.json";

function ministryMemberMatchesMinistry(
  row: { churchId?: unknown; ministryId?: unknown },
  churchId: string,
  ministryId: string
): boolean {
  return (
    churchIdsMatch(row.churchId, churchId) &&
    normalizeMinistryId(row.ministryId) === normalizeMinistryId(ministryId)
  );
}

async function removeMinistryMembersForMinistry(
  churchId: string,
  ministryId: string
): Promise<number> {
  let removedCount = 0;

  await updateJsonFile<any[]>(
    MINISTRY_MEMBERS_FILE,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      const next = list.filter((row) => {
        if (ministryMemberMatchesMinistry(row, churchId, ministryId)) {
          removedCount += 1;
          return false;
        }
        return true;
      });
      return next;
    },
    []
  );

  return removedCount;
}

function withMinistryAvatarAliases<T extends Ministry>(ministry: T) {
  const avatarUri = String(ministry.avatarUri || "").trim();
  if (!avatarUri) return ministry;
  return {
    ...ministry,
    avatar: avatarUri,
    avatarUrl: avatarUri,
    ministryAvatarUrl: avatarUri,
  };
}

function materializeMinistryResponse<T extends Ministry & Record<string, unknown>>(row: T) {
  return withMinistryAvatarAliases(
    materializeMinistryMediaAccessRecord(row) as Ministry & Record<string, unknown>
  );
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "ministries", limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } } satisfies ApiErr,
      { status: 429 }
    );
  }
  return null;
}

function asBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return req.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function payloadFieldTypes(body: Record<string, unknown> | null) {
  const typeOf = (value: unknown) => {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value;
  };

  return {
    leadersType: typeOf(body?.leaders ?? body?.leaderIds),
    membersType: typeOf(body?.members ?? body?.memberIds),
    mediaAccessType: typeOf(body?.mediaAccess),
    metadataType: typeOf(body?.metadata ?? body?.settings),
  };
}

/* =========================
   GET /api/church/ministries
   ========================= */

export async function GET(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const url = new URL(req.url);
  const idParam = String(url.searchParams.get("id") || "").trim();
  const mineMode = url.searchParams.get("mine") === "1" || url.searchParams.get("mine") === "true";

  const all = await readAll();

  if (idParam) {
    const one = findMinistryInChurch(all, churchId, idParam);
    if (!one) {
      return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });
    }

    logMinistryMediaAccessLoad({
      ministryId: one.id,
      churchId,
      mediaAccess: one.mediaAccess === true,
      payloadStored: one,
      source: "api/church/ministries?id",
    });

    return json<Ministry>({
      ok: true,
      data: materializeMinistryResponse(one as Ministry & Record<string, unknown>),
    });
  }

  const churchMinistries = all.filter((m) => churchIdsMatch(m.churchId, churchId));

  logMinistryMediaAccessLoad({
    churchId,
    count: churchMinistries.length,
    source: "api/church/ministries",
    payloadStored: churchMinistries.map((m) => ({
      id: m.id,
      name: m.name,
      mediaAccess: m.mediaAccess === true,
    })),
  });

  if (mineMode) {
    const data = await getUserJoinedMinistries(churchId, viewer.userId);
    const joinedMinistryIds = data.map((m) => String(m.id || "")).filter(Boolean);
    const identity = await resolveMinistryViewerUserId(viewer.userId);

    logMinistryScope("KRISTO_MY_MINISTRIES_SCOPE", {
      userId: identity.rawUserId,
      resolvedUserId: identity.resolvedUserId,
      matchUserIds: identity.matchUserIds,
      churchId,
      serverRole: viewer.role,
      scope: "joined",
      joinedMinistryIds,
      count: data.length,
    });

    return json<Ministry[]>({
      ok: true,
      data: data.map((m) => materializeMinistryResponse(m as Ministry & Record<string, unknown>)),
    });
  }

  return json<Ministry[]>({
    ok: true,
    data: churchMinistries.map((m) => materializeMinistryResponse(m as Ministry & Record<string, unknown>)),
  });
}

/* =========================
   POST /api/church/ministries
   body: { name, description?, status? }
   ========================= */

export async function POST(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Ministry_Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const viewerUserId = String(viewer?.userId || "").trim();
  const viewerRole = String(viewer?.role || "").trim();

  const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
    endpoint: "/api/church/ministries",
    churchId,
    userId: viewerUserId,
    role: viewerRole,
    action: "create_ministry",
  });
  if (subscriptionBlocked) return subscriptionBlocked;

  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  const name = sanitizeName(body.name);
  if (!name) return json({ ok: false, error: "Ministry name is required" } satisfies ApiErr, { status: 400 });

  const status = parseStatus(body.status, "Active");
  if (!status) return json({ ok: false, error: "Invalid status" } satisfies ApiErr, { status: 400 });

  const description = parseDescription(body.description);
  const avatarUri = parseAvatarUri(body.avatarUri);
  const rawMediaAccessInput = extractMinistryMediaAccessFromBody(body);
  const mediaAccess = parseMinistryMediaAccessInput(rawMediaAccessInput);
  const fieldTypes = payloadFieldTypes(body);

  console.log("KRISTO_MINISTRY_SAVE_START", {
    churchId,
    userId: viewer.userId,
    nameLength: name.length,
    status,
    mediaAccess,
    ...fieldTypes,
  });

  logMinistryMediaAccessSave({
    churchId,
    mediaAccess,
    payloadSent: { name, status, description, mediaAccess, rawMediaAccessInput },
    phase: "request",
    source: "api/church/ministries POST",
  });

  if (mediaAccess) {
    const mediaSubscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/ministries",
      churchId,
      userId: viewerUserId,
      role: viewerRole,
      action: "grant_ministry_media_access",
    });
    if (mediaSubscriptionBlocked) return mediaSubscriptionBlocked;
  }

  const created = materializeMinistryMediaAccessRecord({
    id: id(),
    name,
    description,
    avatarUri,
    mediaAccess,
    status,
    churchId,
    createdByUserId: viewer.userId,
    createdAt: nowIso(),
  });

  try {
    await updateJsonFile<Ministry[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        if (mediaAccess) {
          const currentMediaAccessCount = countChurchMinistriesWithMediaAccess(list, churchId);
          if (currentMediaAccessCount >= MINISTRY_MEDIA_ACCESS_LIMIT) {
            logMinistryMediaAccessLimit({
              churchId,
              userId: viewerUserId,
              currentMediaAccessCount,
              action: "create_ministry",
            });
            throw new Error(MINISTRY_MEDIA_ACCESS_LIMIT_CODE);
          }
        }
        list.unshift(created);
        return list;
      },
      []
    );

    // Pastor/creator is always member #1 and senior leader of every ministry.
    await updateJsonFile<any[]>(
      "ministry-members.json",
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const userId = String(viewer.userId || "").trim();

        if (!userId) return list;

        const exists = list.some(
          (mm: any) =>
            String(mm?.churchId || "") === String(churchId) &&
            String(mm?.ministryId || "") === String(created.id) &&
            String(mm?.userId || "") === userId
        );

        if (exists) return list;

        list.unshift({
          id: `mm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          churchId,
          ministryId: created.id,
          userId,
          role: "Leader",
          createdAt: nowIso(),
        });

        return list;
      },
      []
    );

    await logAudit({
      req,
      viewer,
      churchId,
      action: "MINISTRY_CREATE",
      targetType: "ministry",
      targetId: created.id,
      message: `${viewer.name || viewer.userId} created ministry ${name}.`,
      meta: { name, status, description, avatarUri, mediaAccess: created.mediaAccess },
    } as any);

    const allAfterPersist = await readAll();
    const stored = findMinistryInChurch(allAfterPersist, churchId, created.id);
    const responseMinistry = materializeMinistryResponse(
      (stored || created) as Ministry & Record<string, unknown>
    );

    if (mediaAccess && responseMinistry.mediaAccess !== true) {
      console.log("KRISTO_MINISTRY_MEDIA_ACCESS_PERSIST_FAILED", {
        churchId,
        ministryId: created.id,
        requestedMediaAccess: true,
        storedMediaAccess: responseMinistry.mediaAccess,
        storedRecord: stored,
      });
      return json(
        {
          ok: false,
          error: "Failed to persist ministry media access",
        } satisfies ApiErr,
        { status: 500 }
      );
    }

    console.log("KRISTO_MINISTRY_SAVE_DONE", {
      churchId,
      userId: viewer.userId,
      ministryId: responseMinistry.id,
      mediaAccess: responseMinistry.mediaAccess,
      ...fieldTypes,
    });

    logMinistryMediaAccessSave({
      ministryId: responseMinistry.id,
      churchId,
      mediaAccess: responseMinistry.mediaAccess === true,
      payloadSent: { name, status, description, mediaAccess, rawMediaAccessInput },
      payloadStored: responseMinistry,
      phase: "persist",
      source: "api/church/ministries POST",
    });

    logMinistryMediaAccessSave({
      ministryId: responseMinistry.id,
      churchId,
      mediaAccess: responseMinistry.mediaAccess === true,
      payloadSent: { name, status, description, mediaAccess, rawMediaAccessInput },
      payloadStored: responseMinistry,
      phase: "response",
      source: "api/church/ministries POST",
    });

    return json<Ministry>({ ok: true, data: responseMinistry }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "ministry_save_failed");

    if (message === MINISTRY_MEDIA_ACCESS_LIMIT_CODE) {
      return json(ministryMediaAccessLimitPayload(), { status: 403 });
    }

    console.log("KRISTO_MINISTRY_SAVE_ERROR", {
      churchId,
      userId: viewer.userId,
      ministryId: created.id,
      error: message,
      ministryDatabaseError: isMinistryDatabaseError(error),
      ...fieldTypes,
    });

    const statusCode = isMinistryDatabaseError(error) ? 503 : 500;
    return json(
      {
        ok: false,
        error: isMinistryDatabaseError(error) ? "Ministry database not configured" : message,
      } satisfies ApiErr,
      { status: statusCode }
    );
  }
}

/* =========================
   PATCH /api/church/ministries?id=...
   body: { name?, description?, status? }
   ========================= */

export async function PATCH(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const viewerUserId = String(viewer?.userId || "").trim();

  const url = new URL(req.url);
  const mid = String(url.searchParams.get("id") || "").trim();
  if (!mid) return json({ ok: false, error: "Missing id" } satisfies ApiErr, { status: 400 });

  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  if (body.mediaAccess !== undefined && parseMinistryMediaAccessInput(extractMinistryMediaAccessFromBody(body))) {
    const viewerRole = String(viewer?.role || "").trim();
    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/ministries",
      churchId,
      userId: viewerUserId,
      role: viewerRole,
      action: "grant_ministry_media_access",
    });
    if (subscriptionBlocked) return subscriptionBlocked;
  }

  let updated: Ministry | null = null;
  let notFound = false;

  // for VIP audit (detect status toggle vs general update)
  let prevStatus: MinistryStatus | null = null;
  let nextStatusForAudit: MinistryStatus | null = null;

  try {
    await updateJsonFile<Ministry[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const idx = list.findIndex(
          (m) => normalizeMinistryId(m.id) === normalizeMinistryId(mid) && churchIdsMatch(m.churchId, churchId)
        );

        if (idx < 0) {
          notFound = true;
          return list;
        }

        const cur = list[idx];

        const nextName =
          body.name !== undefined ? sanitizeName(body.name) : cur.name;

        if (!nextName) throw new Error("Ministry name is required");

        const nextStatus = parseStatus(body.status, cur.status);
        if (!nextStatus) throw new Error("Invalid status");

        const nextDescription =
          body.description !== undefined ? parseDescription(body.description) : cur.description;

        const nextMediaAccess =
          body.mediaAccess !== undefined
            ? parseMinistryMediaAccessInput(extractMinistryMediaAccessFromBody(body))
            : parseMinistryMediaAccessInput((cur as any).mediaAccess);

        const curHadMediaAccess = !!(cur as any).mediaAccess;
        const enablingMediaAccess = nextMediaAccess && !curHadMediaAccess;
        if (enablingMediaAccess) {
          const currentMediaAccessCount = countChurchMinistriesWithMediaAccess(list, churchId, mid);
          if (currentMediaAccessCount >= MINISTRY_MEDIA_ACCESS_LIMIT) {
            logMinistryMediaAccessLimit({
              churchId,
              userId: viewerUserId,
              currentMediaAccessCount,
              action: "update_ministry_enable_media_access",
            });
            throw new Error(MINISTRY_MEDIA_ACCESS_LIMIT_CODE);
          }
        }

        const nextAvatarUri =
          body.avatarUri !== undefined ? parseAvatarUri(body.avatarUri) : cur.avatarUri;

        prevStatus = cur.status;
        nextStatusForAudit = nextStatus;

        updated = materializeMinistryMediaAccessRecord({
          ...cur,
          name: nextName,
          status: nextStatus,
          description: nextDescription,
          avatarUri: nextAvatarUri,
          mediaAccess: nextMediaAccess,
          updatedAt: nowIso(),
        } as Ministry & Record<string, unknown>);

        list[idx] = updated;
        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Update failed";
    if (msg === MINISTRY_MEDIA_ACCESS_LIMIT_CODE) {
      return json(ministryMediaAccessLimitPayload(), { status: 403 });
    }
    if (msg === "Ministry name is required" || msg === "Invalid status") {
      return json({ ok: false, error: msg } satisfies ApiErr, { status: 400 });
    }
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  if (notFound || !updated) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  const u = updated as any as Ministry;

  logMinistryMediaAccessSave({
    ministryId: u.id,
    churchId,
    mediaAccess: u.mediaAccess === true,
    payloadSent: body,
    payloadStored: u,
    phase: "persist",
    source: "api/church/ministries PATCH",
  });

  const statusToggled = !!(prevStatus && nextStatusForAudit && prevStatus !== nextStatusForAudit);

  await logAudit({
    req,
    viewer,
    churchId,
    action: statusToggled ? "MINISTRY_STATUS_TOGGLE" : "MINISTRY_UPDATE",
    targetType: "ministry",
    targetId: u.id,
    message: statusToggled
      ? `${viewer.name || viewer.userId} toggled ministry status to ${u.status} (${u.name}).`
      : `${viewer.name || viewer.userId} updated ministry ${u.name}.`,
    meta: { name: u.name, status: u.status, description: u.description, avatarUri: u.avatarUri, mediaAccess: (u as any).mediaAccess },
  } as any);

  return json<Ministry>({ ok: true, data: materializeMinistryResponse(u as Ministry & Record<string, unknown>) });
}

/* =========================
   DELETE /api/church/ministries?id=...
   ========================= */

export async function DELETE(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const url = new URL(req.url);
  const requestedId = String(url.searchParams.get("id") || "").trim();
  if (!requestedId) return json({ ok: false, error: "Missing id" } satisfies ApiErr, { status: 400 });

  const allBefore = await readAll();
  const lookup = findMinistryInChurch(allBefore, churchId, requestedId);
  const normalizedId = normalizeMinistryId(requestedId);

  logMinistryDeleteLookup({
    requestedId,
    normalizedId,
    found: Boolean(lookup),
    matchedId: lookup?.id || null,
    matchedChurchId: lookup?.churchId || null,
    guardChurchId: churchId,
    userId: viewer.userId,
    ministryIdsAvailable: listMinistryIdsForChurch(allBefore, churchId),
  });

  if (!lookup) {
    const orphanMembersRemoved = await removeMinistryMembersForMinistry(churchId, normalizedId);
    if (orphanMembersRemoved > 0) {
      console.log("KRISTO_MINISTRY_DELETE_ORPHAN_CLEANUP", {
        requestedId,
        normalizedId,
        churchId,
        userId: viewer.userId,
        orphanMembersRemoved,
      });

      await logAudit({
        req,
        viewer,
        churchId,
        action: "MINISTRY_DELETE",
        targetType: "ministry",
        targetId: normalizedId,
        message: `${viewer.name || viewer.userId} deleted orphaned ministry membership data (${orphanMembersRemoved} members).`,
        meta: { orphanMembersRemoved, requestedId: normalizedId },
      } as any);

      return json({
        ok: true,
        data: { id: normalizedId, orphanCleanup: true, membersRemoved: orphanMembersRemoved },
      });
    }

    return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });
  }

  const canonicalId = String(lookup.id || normalizedId);
  let removed: Ministry | null = null;

  try {
    await updateJsonFile<Ministry[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const idx = list.findIndex(
          (m) => normalizeMinistryId(m.id) === canonicalId && churchIdsMatch(m.churchId, churchId)
        );
        if (idx < 0) return list;

        removed = list[idx];
        return list.filter(
          (m) =>
            !(normalizeMinistryId(m.id) === canonicalId && churchIdsMatch(m.churchId, churchId))
        );
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  if (!removed) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  const r = removed as any as Ministry;

  const membersRemoved = await removeMinistryMembersForMinistry(churchId, canonicalId);
  if (membersRemoved > 0) {
    console.log("KRISTO_MINISTRY_DELETE_MEMBERS_CASCADE", {
      ministryId: r.id,
      churchId,
      membersRemoved,
    });
  }

  await logAudit({
    req,
    viewer,
    churchId,
    action: "MINISTRY_DELETE",
    targetType: "ministry",
    targetId: r.id,
    message: `${viewer.name || viewer.userId} deleted ministry ${r.name}.`,
    meta: { name: r.name },
  } as any);

  return json({ ok: true, data: { id: r.id } });
}
