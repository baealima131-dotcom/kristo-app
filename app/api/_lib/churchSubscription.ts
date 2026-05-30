import { NextResponse } from "next/server";

import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type ChurchMediaRecord = {
  churchId: string;
  mediaName?: string;
  category?: string;
  subCategory?: string;
  targetAudience?: string;
  language?: string;
  country?: string;
  contentStyle?: string;
  bio?: string;
  tags?: string[];
  hosts?: Array<Record<string, unknown>>;
  subscriptionActive?: boolean;
  subscriptionStatus?: string;
  subscriptionActivatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

const STORE_FILE = "church-media.json";

export function subscriptionRequiredResponse() {
  return NextResponse.json({ ok: false, error: "Subscription required" }, { status: 403 });
}

export function isDevSubscriptionBypassEnabled() {
  return process.env.KRISTO_DEV_SUBSCRIPTION_BYPASS === "1";
}

export function isActiveChurchSubscription(record: ChurchMediaRecord | null | undefined) {
  if (isDevSubscriptionBypassEnabled()) return true;
  if (!record) return false;
  if (record.subscriptionActive === true) return true;

  const status = String(record.subscriptionStatus || "")
    .trim()
    .toLowerCase();

  return status === "active" || status === "trialing";
}

export async function readChurchMediaRecords(): Promise<ChurchMediaRecord[]> {
  const rows = await readJsonFile<ChurchMediaRecord[]>(STORE_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

export async function getChurchMediaRecord(churchId: string): Promise<ChurchMediaRecord | null> {
  const id = String(churchId || "").trim();
  if (!id) return null;
  const rows = await readChurchMediaRecords();
  return rows.find((row) => String(row.churchId || "") === id) || null;
}

export async function upsertChurchMediaRecord(
  churchId: string,
  patch: Partial<ChurchMediaRecord>
): Promise<ChurchMediaRecord> {
  const id = String(churchId || "").trim();
  if (!id) throw new Error("churchId is required");

  const now = new Date().toISOString();
  let saved: ChurchMediaRecord = {
    churchId: id,
    subscriptionActive: false,
    subscriptionStatus: "inactive",
    createdAt: now,
    updatedAt: now,
  };

  await updateJsonFile<ChurchMediaRecord[]>(
    STORE_FILE,
    (current) => {
      const list = Array.isArray(current) ? [...current] : [];
      const idx = list.findIndex((row) => String(row.churchId || "") === id);
      const prev = idx >= 0 ? list[idx] : null;

      saved = {
        ...(prev || {}),
        ...patch,
        churchId: id,
        createdAt: String(prev?.createdAt || patch.createdAt || now),
        updatedAt: now,
      };

      if (idx >= 0) list[idx] = saved;
      else list.unshift(saved);

      return list;
    },
    []
  );

  return saved;
}

export async function requireChurchSubscription(churchId: string) {
  const record = await getChurchMediaRecord(churchId);
  if (isActiveChurchSubscription(record)) return null;
  return subscriptionRequiredResponse();
}

function actionLooksLikeSchedule(action: string) {
  const value = String(action || "")
    .trim()
    .toLowerCase();

  if (!value) return false;
  if (value === "claim_schedule_slot") return false;
  if (value === "clear_media_schedules") return false;
  return value.includes("schedule");
}

export function isScheduleCreationBody(body: unknown) {
  if (!body || typeof body !== "object") return false;

  const payload = body as Record<string, unknown>;
  const action = String(payload.action || "").trim().toLowerCase();
  const source = String(payload.source || "")
    .trim()
    .toLowerCase();
  const scheduleType = String(payload.scheduleType || "")
    .trim()
    .toLowerCase();

  if (action === "update-schedule-slots") return false;
  if (action === "claim_schedule_slot") return false;

  if (actionLooksLikeSchedule(action)) return true;
  if (source.includes("schedule")) return true;
  if (scheduleType.includes("schedule") || scheduleType.includes("live-slots")) return true;
  if (Array.isArray(payload.scheduleSlots) && payload.scheduleSlots.length > 0) return true;

  if (String(payload.liveId || "").trim() && source.includes("media")) return true;

  return false;
}

export function isMinistryScheduleBody(body: unknown) {
  if (!body || typeof body !== "object") return false;

  const payload = body as Record<string, unknown>;
  const source = String(payload.source || "")
    .trim()
    .toLowerCase();
  const scheduleType = String(payload.scheduleType || "")
    .trim()
    .toLowerCase();

  return source.includes("ministry-schedule") || scheduleType.includes("ministry");
}

export function requiresScheduleSubscription(body: unknown) {
  return isScheduleCreationBody(body) || isMinistryScheduleBody(body);
}
