// app/api/_lib/audit.ts
import type { NextRequest } from "next/server";
import type { Viewer } from "@/app/api/_lib/auth";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";

/**
 * Audit Log (VIP - real)
 * - JSON storage under /data
 * - append-only (newest first)
 * - church-scoped
 * - best-effort (never throws)
 */

export type AuditAction =
  | "MINISTRY_CREATE"
  | "MINISTRY_UPDATE"
  | "MINISTRY_DELETE"
  | "MINISTRY_STATUS_TOGGLE"
  | "CHURCH_MEMBER_ADD"
  | "CHURCH_MEMBER_UPDATE"
  | "CHURCH_MEMBER_DELETE"
  | "MINISTRY_MEMBER_ADD"
  | "MINISTRY_MEMBER_ROLE_CHANGE"
  | "MINISTRY_MEMBER_REMOVE"
  | "NOTIFICATION_CREATE"
  | "NOTIFICATION_MARK_READ"
  | "NOTIFICATION_DELETE"
  | "GENERIC";

export type AuditEntry = {
  id: string;
  churchId: string;
  action: AuditAction;

  actorUserId: string;
  actorRole?: string;
  actorName?: string;

  targetId?: string;
  targetType?: string;

  message?: string;
  meta?: Record<string, any>;

  ip?: string;
  userAgent?: string;

  createdAt: string;
};

const STORE_FILE = "audit_log.json";
const CAP = 5000;

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "aud") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pickHeader(req: NextRequest, key: string) {
  return (
    req.headers.get(key) ||
    req.headers.get(key.toLowerCase()) ||
    req.headers.get(key.toUpperCase()) ||
    ""
  );
}

/**
 * logAudit
 * - best effort only
 * - no throw
 */
export async function logAudit(args: {
  req: NextRequest;
  viewer: Viewer;
  churchId: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  message?: string;
  meta?: Record<string, any>;
}) {
  try {
    const { req, viewer, churchId, action, targetType, targetId, message, meta } = args;

    const ip =
      pickHeader(req, "x-forwarded-for") ||
      pickHeader(req, "x-real-ip") ||
      undefined;

    const ua = pickHeader(req, "user-agent") || undefined;

    const entry: AuditEntry = {
      id: id(),
      churchId,
      action,
      actorUserId: viewer.userId,
      actorRole: viewer.role,
      actorName: viewer.name,

      targetType,
      targetId,

      message,
      meta,

      ip: ip ? String(ip).split(",")[0].trim() : undefined,
      userAgent: ua ? String(ua).trim() : undefined,

      createdAt: nowIso(),
    };

    const all = await readJsonFile<AuditEntry[]>(STORE_FILE, []);
    const list = Array.isArray(all) ? all : [];

    list.unshift(entry);

    await writeJsonFile(STORE_FILE, list.slice(0, CAP));
  } catch {
    // swallow (best effort)
  }
}

export async function readAudit(churchId: string): Promise<AuditEntry[]> {
  const all = await readJsonFile<AuditEntry[]>(STORE_FILE, []);
  const list = Array.isArray(all) ? all : [];
  return list.filter((x) => x.churchId === churchId);
}
