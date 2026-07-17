import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
  hasDurableStore,
  isVercelRuntime,
} from "@/app/api/_lib/store/authDb";
import {
  computeSafetyCaseIntelligence,
  type CaseIntelligenceRawInput,
  type SafetyCaseIntelligence,
} from "@/app/api/_lib/safetyCaseIntelligenceEngine";

neonConfig.fetchConnectionCache = true;

export type { SafetyCaseIntelligence };

export type SafetyReportStatus =
  | "open"
  | "assigned"
  | "in_review"
  | "resolved"
  | "escalated"
  | "dismissed"
  | "enforcement_pending"
  | "recovery_required";

export type SafetyReportPriority =
  | "low"
  | "normal"
  | "high"
  | "critical";

export type SafetyReportDecisionType =
  | "no_violation"
  | "warning"
  | "remove_content"
  | "restrict_account"
  | "suspend_account"
  | "permanent_ban"
  | "escalate";

export type SafetyDecisionActorRole =
  | "agent"
  | "supervisor"
  | "system_admin";


export type SafetyReportSourceType =
  | "direct_message"
  | "room_message"
  | "church_feed"
  | "profile"
  | "live"
  | "other";

export type SafetyReportTargetType =
  | "account"
  | "post"
  | "comment"
  | "message"
  | "church"
  | "live"
  | "other";

export type SafetyReportRecord = {
  id: string;
  reportCode: string;

  reporterUserId: string;
  reporterKristoId: string;

  reportedUserId?: string;
  reportedKristoId?: string;

  churchId: string;

  sourceType: SafetyReportSourceType;
  sourceId?: string;
  sourceRoomId?: string;
  sourceMessageId?: string;

  targetType: SafetyReportTargetType;
  targetId?: string;
  targetTitle?: string;
  targetSubtitle?: string;
  targetPreview?: string;
  targetOwnerUserId?: string;
  targetOwnerKristoId?: string;
  targetOwnerName?: string;
  targetOwnerAvatarUri?: string;
  targetMediaType?:
    | "video"
    | "image"
    | "audio"
    | "text";
  targetThumbnailUri?: string;

  category: string;
  reason: string;
  description?: string;

  priority: SafetyReportPriority;
  status: SafetyReportStatus;

  assignedSupervisorUserId?: string;
  assignedAgentUserId?: string;

  decisionType?: SafetyReportDecisionType;
  decisionReason?: string;
  decisionNotes?: string;
  decisionConfidence?: number;
  decisionDurationDays?: number;
  decidedByUserId?: string;
  decidedByRole?: SafetyDecisionActorRole;
  decisionAt?: string;

  aiRecommendation?: SafetyReportDecisionType;
  aiConfidence?: number;

  createdAt: string;
  updatedAt: string;
  assignedAt?: string;
  resolvedAt?: string;
};


export type SafetyAgentDashboard = {
  counts: {
    totalAssigned: number;
    open: number;
    inReview: number;
    resolved: number;
    highPriority: number;
  };
  reports: SafetyReportRecord[];
};

export type SafetySupervisorDashboard = {
  counts: {
    assigned: number;
    open: number;
    inReview: number;
    resolved: number;
    highPriority: number;
    escalated: number;
    activeAgents: number;
    pendingAgents: number;
  };
  reports: SafetyReportRecord[];
  agents: Array<{
    userId: string;
    kristoId?: string;
    churchId: string;
    status: "active" | "pending" | "paused";
    open: number;
    inReview: number;
    resolved: number;
    totalAssigned: number;
  }>;
};

type SafetyReportRow = {
  id: string;
  report_code: string;
  reporter_user_id: string;
  reporter_kristo_id: string;
  reported_user_id: string | null;
  reported_kristo_id: string | null;
  church_id: string;
  source_type: string;
  source_id: string | null;
  source_room_id: string | null;
  source_message_id: string | null;
  target_type?: string | null;
  target_id?: string | null;
  target_title?: string | null;
  target_subtitle?: string | null;
  target_preview?: string | null;
  target_owner_user_id?: string | null;
  target_owner_kristo_id?: string | null;
  target_owner_name?: string | null;
  target_owner_avatar_uri?: string | null;
  target_media_type?: string | null;
  target_thumbnail_uri?: string | null;
  category: string;
  reason: string;
  description: string | null;
  priority: string;
  status: string;
  assigned_supervisor_user_id: string | null;
  assigned_agent_user_id: string | null;

  decision_type?: string | null;
  decision_reason?: string | null;
  decision_notes?: string | null;
  decision_confidence?: number | string | null;
  decision_duration_days?: number | string | null;
  decided_by_user_id?: string | null;
  decided_by_role?: string | null;
  decision_at?: string | Date | null;

  ai_recommendation?: string | null;
  ai_confidence?: number | string | null;

  created_at: string | Date;
  updated_at: string | Date;
  assigned_at: string | Date | null;
  resolved_at: string | Date | null;
};

type SupervisorAgentRow = {
  id: string;
  supervisor_user_id: string;
  agent_user_id: string;
  agent_kristo_id: string | null;
  church_id: string;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();

    if (!url) {
      throw new Error(
        "DATABASE_URL not configured"
      );
    }

    sqlClient = neon(url);
  }

  return sqlClient;
}

function usePostgres() {
  return hasDurableStore();
}

function nowIso() {
  return new Date().toISOString();
}

function randomCodeSegment(length = 6) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let output = "";

  for (let index = 0; index < length; index += 1) {
    output += chars[
      Math.floor(
        Math.random() * chars.length
      )
    ];
  }

  return output;
}

export function createSafetyReportCode(
  date = new Date()
) {
  const year = String(
    date.getUTCFullYear()
  ).slice(-2);

  const month = String(
    date.getUTCMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getUTCDate()
  ).padStart(2, "0");

  return (
    `RPT-${year}${month}${day}-` +
    randomCodeSegment(6)
  );
}

function createSafetyReportId() {
  return (
    `srep_${Date.now().toString(36)}_` +
    Math.random().toString(36).slice(2, 9)
  );
}

function createSupervisorAgentId() {
  return (
    `sagt_${Date.now().toString(36)}_` +
    Math.random().toString(36).slice(2, 9)
  );
}

function normalizeStatus(
  value: unknown
): SafetyReportStatus {
  const status =
    String(value || "open")
      .trim()
      .toLowerCase();

  if (
    status === "assigned" ||
    status === "in_review" ||
    status === "resolved" ||
    status === "escalated" ||
    status === "dismissed" ||
    status === "enforcement_pending" ||
    status === "recovery_required"
  ) {
    return status;
  }

  return "open";
}

function normalizeDecisionType(
  value: unknown
): SafetyReportDecisionType | undefined {
  const normalized =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    normalized === "no_violation" ||
    normalized === "warning" ||
    normalized === "remove_content" ||
    normalized === "restrict_account" ||
    normalized === "suspend_account" ||
    normalized === "permanent_ban" ||
    normalized === "escalate"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeDecisionActorRole(
  value: unknown
): SafetyDecisionActorRole | undefined {
  const normalized =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    normalized === "agent" ||
    normalized === "supervisor" ||
    normalized === "system_admin"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeOptionalNumber(
  value: unknown
): number | undefined {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function normalizeTargetType(
  value: unknown
): SafetyReportTargetType {
  const targetType =
    String(value || "other")
      .trim()
      .toLowerCase();

  if (
    targetType === "account" ||
    targetType === "post" ||
    targetType === "comment" ||
    targetType === "message" ||
    targetType === "church" ||
    targetType === "live"
  ) {
    return targetType;
  }

  return "other";
}

function normalizeTargetMediaType(
  value: unknown
):
  | "video"
  | "image"
  | "audio"
  | "text"
  | undefined {
  const normalized =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    normalized === "video" ||
    normalized === "image" ||
    normalized === "audio" ||
    normalized === "text"
  ) {
    return normalized;
  }

  return undefined;
}

function cleanTargetText(
  value: unknown,
  maxLength: number
): string | undefined {
  const text =
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  if (!text) return undefined;

  return text.slice(
    0,
    Math.max(1, maxLength)
  );
}

function normalizePriority(
  value: unknown
): SafetyReportPriority {
  const priority =
    String(value || "normal")
      .trim()
      .toLowerCase();

  if (
    priority === "low" ||
    priority === "high" ||
    priority === "critical"
  ) {
    return priority;
  }

  return "normal";
}

function rowToReport(
  row: SafetyReportRow
): SafetyReportRecord {
  return {
    id: String(row.id || "").trim(),
    reportCode:
      String(row.report_code || "")
        .trim()
        .toUpperCase(),

    reporterUserId:
      String(row.reporter_user_id || "")
        .trim(),

    reporterKristoId:
      String(row.reporter_kristo_id || "")
        .trim()
        .toUpperCase(),

    reportedUserId:
      String(row.reported_user_id || "")
        .trim() || undefined,

    reportedKristoId:
      String(row.reported_kristo_id || "")
        .trim()
        .toUpperCase() || undefined,

    churchId:
      String(row.church_id || "").trim(),

    sourceType:
      String(
        row.source_type || "other"
      ) as SafetyReportSourceType,

    sourceId:
      String(row.source_id || "").trim() ||
      undefined,

    sourceRoomId:
      String(
        row.source_room_id || ""
      ).trim() || undefined,

    sourceMessageId:
      String(
        row.source_message_id || ""
      ).trim() || undefined,

    targetType:
      normalizeTargetType(
        row.target_type
      ),

    targetId:
      cleanTargetText(
        row.target_id,
        300
      ),

    targetTitle:
      cleanTargetText(
        row.target_title,
        240
      ),

    targetSubtitle:
      cleanTargetText(
        row.target_subtitle,
        300
      ),

    targetPreview:
      cleanTargetText(
        row.target_preview,
        600
      ),

    targetOwnerUserId:
      cleanTargetText(
        row.target_owner_user_id,
        240
      ),

    targetOwnerKristoId:
      cleanTargetText(
        row.target_owner_kristo_id,
        100
      )?.toUpperCase(),

    targetOwnerName:
      cleanTargetText(
        row.target_owner_name,
        240
      ),

    targetOwnerAvatarUri:
      cleanTargetText(
        row.target_owner_avatar_uri,
        4000
      ),

    targetMediaType:
      normalizeTargetMediaType(
        row.target_media_type
      ),

    targetThumbnailUri:
      cleanTargetText(
        row.target_thumbnail_uri,
        4000
      ),

    category:
      String(row.category || "other")
        .trim(),

    reason:
      String(row.reason || "").trim(),

    description:
      String(row.description || "").trim() ||
      undefined,

    priority:
      normalizePriority(row.priority),

    status:
      normalizeStatus(row.status),

    assignedSupervisorUserId:
      String(
        row.assigned_supervisor_user_id || ""
      ).trim() || undefined,

    assignedAgentUserId:
      String(
        row.assigned_agent_user_id || ""
      ).trim() || undefined,

    decisionType:
      normalizeDecisionType(
        row.decision_type
      ),

    decisionReason:
      cleanTargetText(
        row.decision_reason,
        4000
      ),

    decisionNotes:
      cleanTargetText(
        row.decision_notes,
        12000
      ),

    decisionConfidence:
      normalizeOptionalNumber(
        row.decision_confidence
      ),

    decisionDurationDays:
      normalizeOptionalNumber(
        row.decision_duration_days
      ),

    decidedByUserId:
      cleanTargetText(
        row.decided_by_user_id,
        240
      ),

    decidedByRole:
      normalizeDecisionActorRole(
        row.decided_by_role
      ),

    decisionAt:
      row.decision_at
        ? new Date(
            row.decision_at
          ).toISOString()
        : undefined,

    aiRecommendation:
      normalizeDecisionType(
        row.ai_recommendation
      ),

    aiConfidence:
      normalizeOptionalNumber(
        row.ai_confidence
      ),

    createdAt:
      new Date(row.created_at).toISOString(),

    updatedAt:
      new Date(row.updated_at).toISOString(),

    assignedAt:
      row.assigned_at
        ? new Date(
            row.assigned_at
          ).toISOString()
        : undefined,

    resolvedAt:
      row.resolved_at
        ? new Date(
            row.resolved_at
          ).toISOString()
        : undefined,
  };
}

export async function ensureSafetyReportSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_safety_reports (
          id TEXT PRIMARY KEY,
          report_code TEXT NOT NULL UNIQUE,

          reporter_user_id TEXT NOT NULL,
          reporter_kristo_id TEXT NOT NULL,

          reported_user_id TEXT,
          reported_kristo_id TEXT,

          church_id TEXT NOT NULL,

          source_type TEXT NOT NULL DEFAULT 'other',
          source_id TEXT,
          source_room_id TEXT,
          source_message_id TEXT,

          target_type TEXT NOT NULL DEFAULT 'other',
          target_id TEXT,
          target_title TEXT,
          target_subtitle TEXT,
          target_preview TEXT,
          target_owner_user_id TEXT,
          target_owner_kristo_id TEXT,
          target_owner_name TEXT,
          target_owner_avatar_uri TEXT,
          target_media_type TEXT,
          target_thumbnail_uri TEXT,

          category TEXT NOT NULL DEFAULT 'other',
          reason TEXT NOT NULL,
          description TEXT,

          priority TEXT NOT NULL DEFAULT 'normal',
          status TEXT NOT NULL DEFAULT 'open',

          assigned_supervisor_user_id TEXT,
          assigned_agent_user_id TEXT,

          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          assigned_at TIMESTAMPTZ,
          resolved_at TIMESTAMPTZ,

          CONSTRAINT kristo_safety_reports_status_check
            CHECK (
              status IN (
                'open',
                'assigned',
                'in_review',
                'resolved',
                'escalated',
                'dismissed',
                'enforcement_pending',
                'recovery_required'
              )
            ),

          CONSTRAINT kristo_safety_reports_priority_check
            CHECK (
              priority IN (
                'low',
                'normal',
                'high',
                'critical'
              )
            )
        )
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'other'
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_id TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_title TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_subtitle TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_preview TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_owner_user_id TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_owner_kristo_id TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_owner_name TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_owner_avatar_uri TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_media_type TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS target_thumbnail_uri TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decision_type TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decision_reason TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decision_notes TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decision_confidence INTEGER
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decision_duration_days INTEGER
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decided_by_user_id TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decided_by_role TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS ai_recommendation TEXT
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD COLUMN IF NOT EXISTS ai_confidence INTEGER
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        DROP CONSTRAINT IF EXISTS
          kristo_safety_reports_status_check
      `;

      await sql`
        ALTER TABLE kristo_safety_reports
        ADD CONSTRAINT kristo_safety_reports_status_check
          CHECK (
            status IN (
              'open',
              'assigned',
              'in_review',
              'resolved',
              'escalated',
              'dismissed',
              'enforcement_pending',
              'recovery_required'
            )
          )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS
          kristo_safety_reconciliations (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            target_post_id TEXT,
            actor_user_id TEXT NOT NULL,
            actor_role TEXT NOT NULL,
            decision_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            notes TEXT,
            confidence INTEGER,
            content_deleted_at TIMESTAMPTZ,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            metadata_json TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,

            CONSTRAINT kristo_safety_reconciliations_status_check
              CHECK (
                status IN (
                  'pending',
                  'completed',
                  'failed'
                )
              )
          )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          kristo_safety_reconciliations_report_kind_uidx
        ON kristo_safety_reconciliations (
          report_id,
          kind
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          kristo_safety_reconciliations_pending_idx
        ON kristo_safety_reconciliations (
          status,
          updated_at ASC
        )
        WHERE status IN ('pending', 'failed')
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_safety_report_events (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          actor_user_id TEXT,
          actor_role TEXT,
          title TEXT NOT NULL,
          details TEXT,
          metadata_json TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          kristo_safety_report_events_report_idx
        ON kristo_safety_report_events (
          report_id,
          created_at DESC
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_safety_system_settings (
          setting_key TEXT PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          updated_by_user_id TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        INSERT INTO kristo_safety_system_settings (
          setting_key,
          enabled,
          updated_at
        )
        VALUES (
          'auto_work',
          FALSE,
          NOW()
        )
        ON CONFLICT (setting_key)
        DO NOTHING
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_supervisor_idx
        ON kristo_safety_reports (
          assigned_supervisor_user_id,
          status,
          created_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_agent_idx
        ON kristo_safety_reports (
          assigned_agent_user_id,
          status,
          created_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_reporter_idx
        ON kristo_safety_reports (
          reporter_user_id,
          created_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_reporter_kristo_idx
        ON kristo_safety_reports (
          reporter_kristo_id,
          created_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_queue_idx
        ON kristo_safety_reports (
          status,
          created_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_target_idx
        ON kristo_safety_reports (
          target_id,
          target_type,
          created_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_reports_source_idx
        ON kristo_safety_reports (
          source_id,
          source_type,
          created_at DESC
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS kristo_safety_supervisor_agents (
          id TEXT PRIMARY KEY,
          supervisor_user_id TEXT NOT NULL,
          agent_user_id TEXT NOT NULL,
          agent_kristo_id TEXT,
          church_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CONSTRAINT kristo_safety_supervisor_agents_status_check
            CHECK (
              status IN (
                'active',
                'pending',
                'paused'
              )
            )
        )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_safety_supervisor_agents_unique_idx
        ON kristo_safety_supervisor_agents (
          supervisor_user_id,
          agent_user_id,
          church_id
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS kristo_safety_supervisor_agents_supervisor_idx
        ON kristo_safety_supervisor_agents (
          supervisor_user_id,
          status
        )
      `;
    })();
  }

  await schemaReady;
}

export async function ensureSafetyReportStoreReady() {
  if (
    isVercelRuntime() &&
    !hasDurableStore()
  ) {
    throw new Error(
      "Safety report database not configured"
    );
  }

  if (usePostgres()) {
    await ensureSafetyReportSchema();
  }
}

export async function dbCreateSafetyReport(
  input: {
    reporterUserId: string;
    reporterKristoId: string;

    reportedUserId?: string;
    reportedKristoId?: string;

    churchId: string;

    sourceType?: SafetyReportSourceType;
    sourceId?: string;
    sourceRoomId?: string;
    sourceMessageId?: string;

    targetType?: SafetyReportTargetType;
    targetId?: string;
    targetTitle?: string;
    targetSubtitle?: string;
    targetPreview?: string;
    targetOwnerUserId?: string;
    targetOwnerKristoId?: string;
    targetOwnerName?: string;
    targetOwnerAvatarUri?: string;
    targetMediaType?:
      | "video"
      | "image"
      | "audio"
      | "text";
    targetThumbnailUri?: string;

    category: string;
    reason: string;
    description?: string;

    priority?: SafetyReportPriority;
  }
): Promise<SafetyReportRecord> {
  const reporterUserId =
    String(
      input.reporterUserId || ""
    ).trim();

  const reporterKristoId =
    String(
      input.reporterKristoId || ""
    )
      .trim()
      .toUpperCase();

  const churchId =
    String(input.churchId || "").trim();

  const reason =
    String(input.reason || "").trim();

  if (!reporterUserId) {
    throw new Error(
      "reporterUserId required"
    );
  }

  if (!reporterKristoId) {
    throw new Error(
      "Reporter KRISTO ID required"
    );
  }

  if (!churchId) {
    throw new Error(
      "Church ID required"
    );
  }

  if (!reason) {
    throw new Error(
      "Report reason required"
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();
  const id = createSafetyReportId();
  const now = nowIso();

  let reportCode =
    createSafetyReportCode();

  for (
    let attempt = 0;
    attempt < 5;
    attempt += 1
  ) {
    try {
      const rows = (await sql`
        INSERT INTO kristo_safety_reports (
          id,
          report_code,

          reporter_user_id,
          reporter_kristo_id,

          reported_user_id,
          reported_kristo_id,

          church_id,

          source_type,
          source_id,
          source_room_id,
          source_message_id,

          target_type,
          target_id,
          target_title,
          target_subtitle,
          target_preview,
          target_owner_user_id,
          target_owner_kristo_id,
          target_owner_name,
          target_owner_avatar_uri,
          target_media_type,
          target_thumbnail_uri,

          category,
          reason,
          description,

          priority,
          status,

          created_at,
          updated_at
        ) VALUES (
          ${id},
          ${reportCode},

          ${reporterUserId},
          ${reporterKristoId},

          ${
            String(
              input.reportedUserId || ""
            ).trim() || null
          },

          ${
            String(
              input.reportedKristoId || ""
            )
              .trim()
              .toUpperCase() || null
          },

          ${churchId},

          ${
            String(
              input.sourceType || "other"
            ).trim()
          },

          ${
            String(
              input.sourceId || ""
            ).trim() || null
          },

          ${
            String(
              input.sourceRoomId || ""
            ).trim() || null
          },

          ${
            String(
              input.sourceMessageId || ""
            ).trim() || null
          },

          ${
            normalizeTargetType(
              input.targetType
            )
          },

          ${
            cleanTargetText(
              input.targetId,
              300
            ) || null
          },

          ${
            cleanTargetText(
              input.targetTitle,
              240
            ) || null
          },

          ${
            cleanTargetText(
              input.targetSubtitle,
              300
            ) || null
          },

          ${
            cleanTargetText(
              input.targetPreview,
              600
            ) || null
          },

          ${
            cleanTargetText(
              input.targetOwnerUserId,
              240
            ) || null
          },

          ${
            cleanTargetText(
              input.targetOwnerKristoId,
              100
            )?.toUpperCase() || null
          },

          ${
            cleanTargetText(
              input.targetOwnerName,
              240
            ) || null
          },

          ${
            cleanTargetText(
              input.targetOwnerAvatarUri,
              4000
            ) || null
          },

          ${
            normalizeTargetMediaType(
              input.targetMediaType
            ) || null
          },

          ${
            cleanTargetText(
              input.targetThumbnailUri,
              4000
            ) || null
          },

          ${
            String(
              input.category || "other"
            ).trim()
          },

          ${reason},

          ${
            String(
              input.description || ""
            ).trim() || null
          },

          ${
            normalizePriority(
              input.priority
            )
          },

          'open',

          ${now},
          ${now}
        )

        RETURNING
          id,
          report_code,
          reporter_user_id,
          reporter_kristo_id,
          reported_user_id,
          reported_kristo_id,
          church_id,
          source_type,
          source_id,
          source_room_id,
          source_message_id,
          target_type,
          target_id,
          target_title,
          target_subtitle,
          target_preview,
          target_owner_user_id,
          target_owner_kristo_id,
          target_owner_name,
          target_owner_avatar_uri,
          target_media_type,
          target_thumbnail_uri,
          category,
          reason,
          description,
          priority,
          status,
          assigned_supervisor_user_id,
          assigned_agent_user_id,
          created_at,
          updated_at,
          assigned_at,
          resolved_at
      `) as SafetyReportRow[];

      const row = rows[0];

      if (!row) {
        throw new Error(
          "Safety report was not created"
        );
      }

      const createdReport =
        rowToReport(row);

      console.log(
        JSON.stringify({
          scope: "kristo_safety",
          event: "report_created",
          reportId: createdReport.id,
          reportCode:
            createdReport.reportCode,
          reporterUserId:
            createdReport.reporterUserId,
          churchId:
            createdReport.churchId,
          sourceType:
            createdReport.sourceType,
          targetType:
            createdReport.targetType,
          targetId:
            createdReport.targetId ||
            null,
          priority:
            createdReport.priority,
          at: new Date().toISOString(),
        })
      );

      try {
        const autoAssignment =
          await dbAutoAssignNewSafetyReport(
            createdReport.id
          );

        if (
          autoAssignment.assigned &&
          autoAssignment.supervisorUserId
        ) {
          console.log(
            JSON.stringify({
              scope: "kristo_safety",
              event: "report_assigned",
              reportId:
                createdReport.id,
              reportCode:
                createdReport.reportCode,
              assignedSupervisorUserId:
                autoAssignment.supervisorUserId,
              mode: "auto_work",
              at: new Date().toISOString(),
            })
          );

          return {
            ...createdReport,
            status: "assigned",
            assignedSupervisorUserId:
              autoAssignment.supervisorUserId,
            assignedAt: now,
            updatedAt: now,
          };
        }
      } catch (autoWorkError: any) {
        /*
         * Report creation must still succeed
         * even if Auto Work temporarily fails.
         */
        console.error(
          "KRISTO_SAFETY_AUTO_WORK_CREATE_HOOK_FAILED",
          {
            reportId:
              createdReport.id,

            error: String(
              autoWorkError?.message ||
              autoWorkError
            ),
          }
        );
      }

      return createdReport;
    } catch (error: any) {
      const message =
        String(
          error?.message || error || ""
        ).toLowerCase();

      if (
        message.includes("report_code") ||
        message.includes("unique")
      ) {
        reportCode =
          createSafetyReportCode();

        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Could not generate unique report code"
  );
}

export async function dbAssignReportToSupervisor(
  input: {
    reportId: string;
    supervisorUserId: string;
  }
) {
  const reportId =
    String(input.reportId || "").trim();

  const supervisorUserId =
    String(
      input.supervisorUserId || ""
    ).trim();

  if (!reportId || !supervisorUserId) {
    throw new Error(
      "Report and supervisor are required"
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();
  const now = nowIso();

  const rows = (await sql`
    UPDATE kristo_safety_reports
    SET
      assigned_supervisor_user_id =
        ${supervisorUserId},
      assigned_agent_user_id = NULL,
      status = 'assigned',
      assigned_at = ${now},
      updated_at = ${now}
    WHERE id = ${reportId}
    RETURNING
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
  `) as SafetyReportRow[];

  if (!rows[0]) {
    throw new Error("Report not found");
  }

  return rowToReport(rows[0]);
}

export async function dbAssignReportToAgent(
  input: {
    reportId: string;
    supervisorUserId: string;
    agentUserId: string;
  }
) {
  const reportId =
    String(input.reportId || "").trim();

  const supervisorUserId =
    String(
      input.supervisorUserId || ""
    ).trim();

  const agentUserId =
    String(
      input.agentUserId || ""
    ).trim();

  if (
    !reportId ||
    !supervisorUserId ||
    !agentUserId
  ) {
    throw new Error(
      "Report, supervisor and agent are required"
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();
  const now = nowIso();

  const rows = (await sql`
    UPDATE kristo_safety_reports
    SET
      assigned_agent_user_id =
        ${agentUserId},
      status = 'assigned',
      assigned_at =
        COALESCE(assigned_at, ${now}),
      updated_at = ${now}
    WHERE id = ${reportId}
      AND assigned_supervisor_user_id =
        ${supervisorUserId}
    RETURNING
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
  `) as SafetyReportRow[];

  if (!rows[0]) {
    throw new Error(
      "Report not found or not assigned to this supervisor"
    );
  }

  const assigned =
    rowToReport(rows[0]);

  console.log(
    JSON.stringify({
      scope: "kristo_safety",
      event: "report_assigned",
      reportId: assigned.id,
      reportCode: assigned.reportCode,
      assignedSupervisorUserId:
        String(
          input.supervisorUserId || ""
        ).trim(),
      assignedAgentUserId:
        String(
          input.agentUserId || ""
        ).trim(),
      mode: "supervisor_to_agent",
      at: new Date().toISOString(),
    })
  );

  return assigned;
}


export async function dbAssignReportsToAgent(
  input: {
    supervisorUserId: string;
    agentUserId: string;
    count: number;
  }
): Promise<SafetyReportRecord[]> {
  const supervisorUserId =
    String(
      input.supervisorUserId || ""
    ).trim();

  const agentUserId =
    String(
      input.agentUserId || ""
    ).trim();

  const requestedCount =
    Math.floor(
      Number(input.count) || 0
    );

  if (
    !supervisorUserId ||
    !agentUserId ||
    requestedCount < 1
  ) {
    throw new Error(
      "Supervisor, agent and a valid report count are required"
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();
  const now = nowIso();

  /*
   * Atomic queue assignment:
   * - only reports belonging to this supervisor
   * - only reports not already assigned to an agent
   * - completed reports are excluded
   * - serious reports are selected first
   * - no hard-coded maximum
   */
  const rows = (await sql`
    WITH candidates AS (
      SELECT id
      FROM kristo_safety_reports
      WHERE
        assigned_supervisor_user_id =
          ${supervisorUserId}
        AND assigned_agent_user_id IS NULL
        AND status NOT IN (
          'resolved',
          'dismissed'
        )
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        created_at ASC
      LIMIT ${requestedCount}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE kristo_safety_reports AS report
    SET
      assigned_agent_user_id =
        ${agentUserId},
      status = 'assigned',
      assigned_at =
        COALESCE(
          report.assigned_at,
          ${now}
        ),
      updated_at = ${now}
    FROM candidates
    WHERE report.id = candidates.id
    RETURNING
      report.id,
      report.report_code,
      report.reporter_user_id,
      report.reporter_kristo_id,
      report.reported_user_id,
      report.reported_kristo_id,
      report.church_id,
      report.source_type,
      report.source_id,
      report.source_room_id,
      report.source_message_id,
      report.target_type,
      report.target_id,
      report.target_title,
      report.target_subtitle,
      report.target_preview,
      report.target_owner_user_id,
      report.target_owner_kristo_id,
      report.target_owner_name,
      report.target_owner_avatar_uri,
      report.target_media_type,
      report.target_thumbnail_uri,
      report.category,
      report.reason,
      report.description,
      report.priority,
      report.status,
      report.assigned_supervisor_user_id,
      report.assigned_agent_user_id,
      report.created_at,
      report.updated_at,
      report.assigned_at,
      report.resolved_at
  `) as SafetyReportRow[];

  return rows.map(rowToReport);
}

export async function dbCreateSupervisorAgent(
  input: {
    supervisorUserId: string;
    agentUserId: string;
    agentKristoId?: string;
    churchId: string;
    status?: "active" | "pending";
  }
) {
  const supervisorUserId =
    String(
      input.supervisorUserId || ""
    ).trim();

  const agentUserId =
    String(input.agentUserId || "").trim();

  const churchId =
    String(input.churchId || "").trim();

  if (
    !supervisorUserId ||
    !agentUserId ||
    !churchId
  ) {
    throw new Error(
      "Supervisor, agent and church are required"
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();
  const id = createSupervisorAgentId();
  const now = nowIso();
  const status =
    input.status === "pending"
      ? "pending"
      : "active";

  const rows = (await sql`
    INSERT INTO kristo_safety_supervisor_agents (
      id,
      supervisor_user_id,
      agent_user_id,
      agent_kristo_id,
      church_id,
      status,
      created_at,
      updated_at
    ) VALUES (
      ${id},
      ${supervisorUserId},
      ${agentUserId},
      ${
        String(
          input.agentKristoId || ""
        )
          .trim()
          .toUpperCase() || null
      },
      ${churchId},
      ${status},
      ${now},
      ${now}
    )

    ON CONFLICT (
      supervisor_user_id,
      agent_user_id,
      church_id
    ) DO UPDATE SET
      agent_kristo_id =
        COALESCE(
          EXCLUDED.agent_kristo_id,
          kristo_safety_supervisor_agents.agent_kristo_id
        ),
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at

    RETURNING
      id,
      supervisor_user_id,
      agent_user_id,
      agent_kristo_id,
      church_id,
      status,
      created_at,
      updated_at
  `) as SupervisorAgentRow[];

  return rows[0];
}

export async function
dbRemoveSupervisorAgent(
  input: {
    supervisorUserId: string;
    agentUserId: string;
    churchId: string;
  }
): Promise<{
  removed: boolean;
}> {
  const supervisorUserId =
    String(
      input.supervisorUserId || ""
    ).trim();

  const agentUserId =
    String(
      input.agentUserId || ""
    ).trim();

  const churchId =
    String(
      input.churchId || ""
    ).trim();

  if (
    !supervisorUserId ||
    !agentUserId ||
    !churchId
  ) {
    return {
      removed: false,
    };
  }

  await ensureSafetyReportSchema();

  const sql = getSql();

  const rows = (await sql`
    DELETE FROM
      kristo_safety_supervisor_agents
    WHERE
      supervisor_user_id =
        ${supervisorUserId}
      AND agent_user_id =
        ${agentUserId}
      AND church_id =
        ${churchId}
    RETURNING id
  `) as Array<{
    id: string;
  }>;

  return {
    removed: rows.length > 0,
  };
}


export async function
dbHasActiveSafetyAgentRelationship(
  agentUserIdInput: string
): Promise<boolean> {
  const agentUserId =
    String(
      agentUserIdInput || ""
    ).trim();

  if (!agentUserId) {
    return false;
  }

  await ensureSafetyReportSchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT EXISTS (
      SELECT 1
      FROM
        kristo_safety_supervisor_agents
      WHERE
        agent_user_id =
          ${agentUserId}
        AND status = 'active'
    ) AS has_active_relationship
  `) as Array<{
    has_active_relationship:
      boolean;
  }>;

  return (
    rows[0]
      ?.has_active_relationship === true
  );
}



export async function
dbGetSafetyAgentDashboard(
  agentUserIdInput: string
): Promise<SafetyAgentDashboard> {
  await ensureSafetyReportStoreReady();

  const sql = getSql();

  const agentUserId =
    String(
      agentUserIdInput || ""
    ).trim();

  if (!agentUserId) {
    throw new Error(
      "Safety Agent user ID is required."
    );
  }

  const rows = (await sql`
    SELECT
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
    FROM kristo_safety_reports
    WHERE assigned_agent_user_id =
      ${agentUserId}
    ORDER BY
      CASE status
        WHEN 'in_review' THEN 1
        WHEN 'assigned' THEN 2
        WHEN 'open' THEN 3
        WHEN 'escalated' THEN 4
        WHEN 'resolved' THEN 5
        ELSE 6
      END,
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      updated_at DESC
  `) as SafetyReportRow[];

  const reports =
    rows.map(rowToReport);

  return {
    counts: {
      totalAssigned:
        reports.length,

      open:
        reports.filter(
          (report) =>
            report.status === "open" ||
            report.status === "assigned"
        ).length,

      inReview:
        reports.filter(
          (report) =>
            report.status === "in_review"
        ).length,

      resolved:
        reports.filter(
          (report) =>
            report.status === "resolved"
        ).length,

      highPriority:
        reports.filter(
          (report) =>
            report.priority === "critical" ||
            report.priority === "high"
        ).length,
    },

    reports,
  };
}

export async function dbGetSafetySupervisorDashboard(
  supervisorUserId: string
): Promise<SafetySupervisorDashboard> {
  const uid =
    String(supervisorUserId || "").trim();

  if (!uid) {
    throw new Error(
      "Supervisor user ID required"
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();

  const reports = (await sql`
    SELECT
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
    FROM kristo_safety_reports
    WHERE assigned_supervisor_user_id =
      ${uid}
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        ELSE 4
      END,
      created_at DESC
    LIMIT 300
  `) as SafetyReportRow[];

  const agentRows = (await sql`
    SELECT
      id,
      supervisor_user_id,
      agent_user_id,
      agent_kristo_id,
      church_id,
      status,
      created_at,
      updated_at
    FROM kristo_safety_supervisor_agents
    WHERE supervisor_user_id = ${uid}
    ORDER BY
      CASE status
        WHEN 'active' THEN 1
        WHEN 'pending' THEN 2
        ELSE 3
      END,
      created_at DESC
  `) as SupervisorAgentRow[];

  const reportRecords =
    reports.map(rowToReport);

  const agents = await Promise.all(
    agentRows.map(async (agent) => {
      const agentUserId =
        String(
          agent.agent_user_id || ""
        ).trim();

      const agentKristoId =
        String(
          agent.agent_kristo_id || ""
        )
          .trim()
          .toUpperCase();

      const assigned =
        reportRecords.filter(
          (report) =>
            report.assignedAgentUserId ===
            agentUserId
        );

      /*
       * Resolve the agent's canonical profile.
       *
       * Some legacy Safety Agent rows can contain
       * a linked user ID that does not directly match
       * the kristo_profiles.user_id key. Kristo ID is
       * therefore the reliable secondary identity key.
       */
      return {
        userId:
          agentUserId,

        kristoId:
          agentKristoId ||
          undefined,
churchId:
          String(
            agent.church_id || ""
          ).trim(),

        status:
          (
            agent.status === "pending" ||
            agent.status === "paused"
              ? agent.status
              : "active"
          ) as
            | "active"
            | "pending"
            | "paused",

        open:
          assigned.filter(
            (report) =>
              report.status === "open" ||
              report.status === "assigned"
          ).length,

        inReview:
          assigned.filter(
            (report) =>
              report.status ===
              "in_review"
          ).length,

        resolved:
          assigned.filter(
            (report) =>
              report.status ===
              "resolved"
          ).length,

        totalAssigned:
          assigned.length,
      };
    })
  );

  return {
    counts: {
      assigned:
        reportRecords.length,

      open:
        reportRecords.filter(
          (report) =>
            report.status === "open" ||
            report.status === "assigned"
        ).length,

      inReview:
        reportRecords.filter(
          (report) =>
            report.status === "in_review"
        ).length,

      resolved:
        reportRecords.filter(
          (report) =>
            report.status === "resolved"
        ).length,

      highPriority:
        reportRecords.filter(
          (report) =>
            report.priority === "high" ||
            report.priority === "critical"
        ).length,

      escalated:
        reportRecords.filter(
          (report) =>
            report.status === "escalated"
        ).length,

      activeAgents:
        agents.filter(
          (agent) =>
            agent.status === "active"
        ).length,

      pendingAgents:
        agents.filter(
          (agent) =>
            agent.status === "pending"
        ).length,
    },

    reports: reportRecords,
    agents,
  };
}


export async function dbListSafetyReportsForReporter(
  reporterUserId: string,
  limit = 100
): Promise<SafetyReportRecord[]> {
  const userId =
    String(reporterUserId || "").trim();

  if (!userId) return [];

  await ensureSafetyReportSchema();

  const sql = getSql();
  const safeLimit = Math.max(
    1,
    Math.min(
      Math.floor(Number(limit) || 100),
      300
    )
  );

  const rows = (await sql`
    SELECT
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
    FROM kristo_safety_reports
    WHERE reporter_user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `) as SafetyReportRow[];

  return rows.map(rowToReport);
}

export async function dbGetSafetyReportForReporterByCode(
  input: {
    reporterUserId: string;
    reportCode: string;
  }
): Promise<SafetyReportRecord | null> {
  const reporterUserId =
    String(
      input.reporterUserId || ""
    ).trim();

  const reportCode =
    String(input.reportCode || "")
      .trim()
      .toUpperCase();

  if (!reporterUserId || !reportCode) {
    return null;
  }

  await ensureSafetyReportSchema();

  const sql = getSql();

  /*
   * Owner protection:
   * the command code alone never grants access.
   * It must belong to the currently signed-in user.
   */
  const rows = (await sql`
    SELECT
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
    FROM kristo_safety_reports
    WHERE report_code = ${reportCode}
      AND reporter_user_id =
        ${reporterUserId}
    LIMIT 1
  `) as SafetyReportRow[];

  return rows[0]
    ? rowToReport(rows[0])
    : null;
}


export async function dbFindSafetyReportForReporterSource(
  input: {
    reporterUserId: string;
    sourceType: SafetyReportSourceType;
    sourceId: string;
  }
): Promise<SafetyReportRecord | null> {
  const reporterUserId =
    String(
      input.reporterUserId || ""
    ).trim();

  const sourceType =
    String(
      input.sourceType || "other"
    ).trim();

  const sourceId =
    String(
      input.sourceId || ""
    ).trim();

  if (
    !reporterUserId ||
    !sourceType ||
    !sourceId
  ) {
    return null;
  }

  await ensureSafetyReportSchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT
      id,
      report_code,
      reporter_user_id,
      reporter_kristo_id,
      reported_user_id,
      reported_kristo_id,
      church_id,
      source_type,
      source_id,
      source_room_id,
      source_message_id,
      target_type,
      target_id,
      target_title,
      target_subtitle,
      target_preview,
      target_owner_user_id,
      target_owner_kristo_id,
      target_owner_name,
      target_owner_avatar_uri,
      target_media_type,
      target_thumbnail_uri,
      category,
      reason,
      description,
      priority,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id,
      decision_type,
      decision_reason,
      decision_notes,
      decision_confidence,
      decision_duration_days,
      decided_by_user_id,
      decided_by_role,
      decision_at,
      ai_recommendation,
      ai_confidence,
      created_at,
      updated_at,
      assigned_at,
      resolved_at
    FROM kristo_safety_reports
    WHERE reporter_user_id =
      ${reporterUserId}
      AND source_type =
        ${sourceType}
      AND source_id =
        ${sourceId}
    ORDER BY created_at DESC
    LIMIT 1
  `) as SafetyReportRow[];

  return rows[0]
    ? rowToReport(rows[0])
    : null;
}



export type SafetySystemAdminDashboardCounts = {
  total: number;
  open: number;
  assigned: number;
  inReview: number;
  highPriority: number;
  resolved: number;
  escalated: number;
  dismissed: number;
};

export async function dbGetSafetySystemAdminDashboard():
  Promise<{
    counts: SafetySystemAdminDashboardCounts;
  }> {
  await ensureSafetyReportSchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT
      COUNT(*)::int AS total,

      COUNT(*) FILTER (
        WHERE
          status = 'open'
          AND assigned_supervisor_user_id IS NULL
      )::int AS open,

      COUNT(*) FILTER (
        WHERE
          assigned_supervisor_user_id IS NOT NULL
          AND status NOT IN (
            'resolved',
            'dismissed'
          )
      )::int AS assigned,

      COUNT(*) FILTER (
        WHERE status = 'in_review'
      )::int AS in_review,

      COUNT(*) FILTER (
        WHERE
          priority IN ('high', 'critical')
          AND status NOT IN (
            'resolved',
            'dismissed'
          )
      )::int AS high_priority,

      COUNT(*) FILTER (
        WHERE status = 'resolved'
      )::int AS resolved,

      COUNT(*) FILTER (
        WHERE status = 'escalated'
      )::int AS escalated,

      COUNT(*) FILTER (
        WHERE status = 'dismissed'
      )::int AS dismissed

    FROM kristo_safety_reports
  `) as Array<{
    total?: number | string;
    open?: number | string;
    assigned?: number | string;
    in_review?: number | string;
    high_priority?: number | string;
    resolved?: number | string;
    escalated?: number | string;
    dismissed?: number | string;
  }>;

  const row = rows[0] || {};

  return {
    counts: {
      total: Number(row.total || 0),
      open: Number(row.open || 0),
      assigned: Number(
        row.assigned || 0
      ),
      inReview: Number(
        row.in_review || 0
      ),
      highPriority: Number(
        row.high_priority || 0
      ),
      resolved: Number(
        row.resolved || 0
      ),
      escalated: Number(
        row.escalated || 0
      ),
      dismissed: Number(
        row.dismissed || 0
      ),
    },
  };
}


export async function
dbAssignSafetyReportsToSupervisorByQuantity(
  input: {
    supervisorUserId: string;
    quantity: number;
  }
): Promise<{
  requestedQuantity: number;
  assignedCount: number;
  reportIds: string[];
}> {
  const supervisorUserId =
    String(
      input.supervisorUserId || ""
    ).trim();

  const rawQuantity =
    Math.floor(
      Number(input.quantity) || 0
    );

  if (!supervisorUserId) {
    throw new Error(
      "Supervisor user ID is required"
    );
  }

  if (
    !Number.isFinite(rawQuantity) ||
    rawQuantity < 1
  ) {
    throw new Error(
      "A valid report quantity is required"
    );
  }

  const quantity = Math.min(
    rawQuantity,
    5000
  );

  await ensureSafetyReportSchema();

  const sql = getSql();
  const now = nowIso();

  const rows = (await sql`
    WITH selected_reports AS (
      SELECT id
      FROM kristo_safety_reports
      WHERE
        status = 'open'
        AND assigned_supervisor_user_id
          IS NULL

      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END ASC,
        created_at ASC

      FOR UPDATE SKIP LOCKED
      LIMIT ${quantity}
    )

    UPDATE kristo_safety_reports AS report
    SET
      assigned_supervisor_user_id =
        ${supervisorUserId},
      assigned_agent_user_id = NULL,
      status = 'assigned',
      assigned_at = ${now},
      updated_at = ${now}

    FROM selected_reports
    WHERE report.id =
      selected_reports.id

    RETURNING report.id
  `) as Array<{
    id: string;
  }>;

  return {
    requestedQuantity: quantity,
    assignedCount: rows.length,
    reportIds: rows
      .map((row) =>
        String(row.id || "").trim()
      )
      .filter(Boolean),
  };
}







/*
 * Before System Admin revokes a supervisor,
 * all unfinished reports owned by that supervisor
 * return to the global unassigned queue.
 *
 * Resolved and dismissed reports keep their
 * historical supervisor ownership for audit history.
 */
export async function dbReleaseSafetySupervisorReports(
  supervisorUserId: string
): Promise<{
  releasedCount: number;
  reportIds: string[];
}> {
  const supervisorId =
    String(
      supervisorUserId || ""
    ).trim();

  if (!supervisorId) {
    throw new Error(
      "Safety Supervisor user ID is required."
    );
  }

  await ensureSafetyReportSchema();

  const sql = getSql();
  const now = nowIso();

  const rows = (await sql`
    UPDATE kristo_safety_reports
    SET
      assigned_supervisor_user_id = NULL,
      assigned_agent_user_id = NULL,
      assigned_at = NULL,
      status = 'open',
      updated_at = ${now}
    WHERE
      assigned_supervisor_user_id =
        ${supervisorId}
      AND status NOT IN (
        'resolved',
        'dismissed'
      )
    RETURNING id
  `) as Array<{
    id: string;
  }>;

  return {
    releasedCount: rows.length,
    reportIds: rows
      .map((row) =>
        String(row.id || "").trim()
      )
      .filter(Boolean),
  };
}



export type SafetySystemPerformanceRow = {
  userId: string;
  kristoId?: string;
  assigned: number;
  resolved: number;
  open: number;
  resolutionRate: number;
  averageResolutionMinutes:
    number | null;
};

export type SafetySystemOperationsDashboard = {
  autoWorkEnabled: boolean;

  topSupervisors:
    SafetySystemPerformanceRow[];

  topAgents:
    SafetySystemPerformanceRow[];

  mostProductive:
    SafetySystemPerformanceRow | null;

  fastestResolution:
    SafetySystemPerformanceRow | null;
};


/*
 * Durable System Admin Auto Work setting.
 */
export async function
dbGetSafetyAutoWorkSetting():
  Promise<boolean> {
  await ensureSafetyReportSchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT enabled
    FROM kristo_safety_system_settings
    WHERE setting_key = 'auto_work'
    LIMIT 1
  `) as Array<{
    enabled: boolean;
  }>;

  return rows[0]?.enabled === true;
}


export async function
dbSetSafetyAutoWorkSetting(
  input: {
    enabled: boolean;
    updatedByUserId: string;
  }
): Promise<boolean> {
  await ensureSafetyReportSchema();

  const sql = getSql();

  const enabled =
    input.enabled === true;

  const updatedByUserId =
    String(
      input.updatedByUserId || ""
    ).trim();

  await sql`
    INSERT INTO kristo_safety_system_settings (
      setting_key,
      enabled,
      updated_by_user_id,
      updated_at
    )
    VALUES (
      'auto_work',
      ${enabled},
      ${updatedByUserId || null},
      NOW()
    )
    ON CONFLICT (setting_key)
    DO UPDATE SET
      enabled =
        EXCLUDED.enabled,

      updated_by_user_id =
        EXCLUDED.updated_by_user_id,

      updated_at =
        EXCLUDED.updated_at
  `;

  return enabled;
}


function mapSafetyPerformanceRow(
  row: any
): SafetySystemPerformanceRow {
  const assigned =
    Number(
      row?.assigned || 0
    );

  const resolved =
    Number(
      row?.resolved || 0
    );

  const open =
    Number(
      row?.open || 0
    );

  const rawAverage =
    row?.average_resolution_minutes;

  const averageResolutionMinutes =
    rawAverage === null ||
    rawAverage === undefined
      ? null
      : Number(rawAverage);

  return {
    userId:
      String(
        row?.user_id || ""
      ).trim(),

    kristoId:
      String(
        row?.kristo_id || ""
      )
        .trim()
        .toUpperCase() ||
      undefined,

    assigned,
    resolved,
    open,

    resolutionRate:
      assigned > 0
        ? Math.round(
            (
              resolved /
              assigned
            ) * 100
          )
        : 0,

    averageResolutionMinutes:
      averageResolutionMinutes !==
        null &&
      Number.isFinite(
        averageResolutionMinutes
      ) &&
      averageResolutionMinutes >= 0
        ? Math.round(
            averageResolutionMinutes
          )
        : null,
  };
}


/*
 * Real platform performance for the most recent
 * 30 days.
 *
 * This does not pretend to measure online time.
 * Productivity is currently based on completed
 * moderation work.
 */
export async function
dbGetSafetySystemOperationsDashboard():
  Promise<SafetySystemOperationsDashboard> {
  await ensureSafetyReportSchema();

  const sql = getSql();

  const supervisorRows = (await sql`
    SELECT
      report.assigned_supervisor_user_id
        AS user_id,

      COUNT(*)::int
        AS assigned,

      COUNT(*) FILTER (
        WHERE
          report.status = 'resolved'
      )::int AS resolved,

      COUNT(*) FILTER (
        WHERE
          report.status NOT IN (
            'resolved',
            'dismissed'
          )
      )::int AS open,

      AVG(
        EXTRACT(
          EPOCH FROM (
            report.resolved_at -
            COALESCE(
              report.assigned_at,
              report.created_at
            )
          )
        ) / 60
      ) FILTER (
        WHERE
          report.status = 'resolved'
          AND report.resolved_at
            IS NOT NULL
          AND report.resolved_at >=
            COALESCE(
              report.assigned_at,
              report.created_at
            )
      ) AS average_resolution_minutes

    FROM kristo_safety_reports
      AS report

    WHERE
      report.assigned_supervisor_user_id
        IS NOT NULL

      AND COALESCE(
        report.assigned_at,
        report.updated_at,
        report.created_at
      ) >= NOW() - INTERVAL '30 days'

    GROUP BY
      report.assigned_supervisor_user_id

    ORDER BY
      assigned DESC,
      resolved DESC,
      open ASC

    LIMIT 30
  `) as any[];

  const agentRows = (await sql`
    SELECT
      report.assigned_agent_user_id
        AS user_id,

      MAX(
        agent.agent_kristo_id
      ) AS kristo_id,

      COUNT(*)::int
        AS assigned,

      COUNT(*) FILTER (
        WHERE
          report.status = 'resolved'
      )::int AS resolved,

      COUNT(*) FILTER (
        WHERE
          report.status NOT IN (
            'resolved',
            'dismissed'
          )
      )::int AS open,

      AVG(
        EXTRACT(
          EPOCH FROM (
            report.resolved_at -
            COALESCE(
              report.assigned_at,
              report.created_at
            )
          )
        ) / 60
      ) FILTER (
        WHERE
          report.status = 'resolved'
          AND report.resolved_at
            IS NOT NULL
          AND report.resolved_at >=
            COALESCE(
              report.assigned_at,
              report.created_at
            )
      ) AS average_resolution_minutes

    FROM kristo_safety_reports
      AS report

    LEFT JOIN
      kristo_safety_supervisor_agents
        AS agent

      ON agent.agent_user_id =
        report.assigned_agent_user_id

    WHERE
      report.assigned_agent_user_id
        IS NOT NULL

      AND COALESCE(
        report.assigned_at,
        report.updated_at,
        report.created_at
      ) >= NOW() - INTERVAL '30 days'

    GROUP BY
      report.assigned_agent_user_id

    ORDER BY
      assigned DESC,
      resolved DESC,
      open ASC

    LIMIT 30
  `) as any[];

  const topSupervisors =
    supervisorRows.map(
      mapSafetyPerformanceRow
    );

  const topAgents =
    agentRows.map(
      mapSafetyPerformanceRow
    );

  const combined = [
    ...topSupervisors,
    ...topAgents,
  ];

  const mostProductive =
    [...combined]
      .sort(
        (a, b) =>
          b.resolved -
            a.resolved ||

          b.resolutionRate -
            a.resolutionRate ||

          a.open -
            b.open
      )[0] ||
    null;

  const fastestResolution =
    combined
      .filter(
        (row) =>
          row.resolved > 0 &&
          row.averageResolutionMinutes !==
            null
      )
      .sort(
        (a, b) =>
          Number(
            a.averageResolutionMinutes
          ) -
          Number(
            b.averageResolutionMinutes
          )
      )[0] ||
    null;

  return {
    autoWorkEnabled:
      await dbGetSafetyAutoWorkSetting(),

    topSupervisors,
    topAgents,
    mostProductive,
    fastestResolution,
  };
}


/*
 * Automatically assigns a specific open report
 * to the active Safety Supervisor carrying the
 * smallest unresolved workload.
 *
 * Concurrent report creation remains safe because
 * the report can only be updated while it is still
 * open and unassigned.
 */
export async function
dbAutoAssignNewSafetyReport(
  reportId: string
): Promise<{
  assigned: boolean;
  supervisorUserId?: string;
}> {
  const normalizedReportId =
    String(
      reportId || ""
    ).trim();

  if (!normalizedReportId) {
    return {
      assigned: false,
    };
  }

  await ensureSafetyReportSchema();

  const enabled =
    await dbGetSafetyAutoWorkSetting();

  if (!enabled) {
    return {
      assigned: false,
    };
  }

  const sql = getSql();
  const now = nowIso();

  const rows = (await sql`
    WITH supervisor_workload AS (
      SELECT
        role.user_id,

        COUNT(report.id) FILTER (
          WHERE
            report.status NOT IN (
              'resolved',
              'dismissed'
            )
        )::int AS open_count,

        COUNT(report.id)::int
          AS total_count

      FROM kristo_safety_roles
        AS role

      LEFT JOIN
        kristo_safety_reports
          AS report

        ON
          report.assigned_supervisor_user_id =
            role.user_id

      WHERE
        role.role =
          'Safety_Supervisor'

      GROUP BY
        role.user_id

      ORDER BY
        open_count ASC,
        total_count ASC,
        role.user_id ASC

      LIMIT 1
    )

    UPDATE kristo_safety_reports
      AS report

    SET
      assigned_supervisor_user_id =
        supervisor_workload.user_id,

      assigned_agent_user_id =
        NULL,

      status =
        'assigned',

      assigned_at =
        ${now},

      updated_at =
        ${now}

    FROM supervisor_workload

    WHERE
      report.id =
        ${normalizedReportId}

      AND report.status =
        'open'

      AND
        report.assigned_supervisor_user_id
          IS NULL

    RETURNING
      supervisor_workload.user_id
        AS supervisor_user_id
  `) as Array<{
    supervisor_user_id: string;
  }>;

  const supervisorUserId =
    String(
      rows[0]?.supervisor_user_id ||
      ""
    ).trim();

  if (supervisorUserId) {
    console.log(
      "KRISTO_SAFETY_AUTO_WORK_ASSIGNED",
      {
        reportId:
          normalizedReportId,

        supervisorUserId,
      }
    );
  }

  return {
    assigned:
      Boolean(
        supervisorUserId
      ),

    supervisorUserId:
      supervisorUserId ||
      undefined,
  };
}

export type SafetyIssueDecisionInput = {
  reportId: string;
  actorUserId: string;
  actorRole: SafetyDecisionActorRole;
  decisionType: SafetyReportDecisionType;
  reason: string;
  notes?: string;
  confidence?: number;
  durationDays?: number;
  /**
   * When set, account enforcement is written in the same
   * atomic transaction as the decision + audit event.
   */
  accountEnforcement?: {
    userId: string;
    kristoId?: string;
    enforcementType:
      | "warning"
      | "restrict_account"
      | "suspend_account"
      | "permanent_ban";
  };
};

export type SafetyIssueDecisionResult = {
  report: SafetyReportRecord;
  enforcement?: SafetyAccountEnforcementRecord;
};

function createSafetyReportEventId() {
  return (
    `sevt_${Date.now().toString(36)}_` +
    Math.random().toString(36).slice(2, 10)
  );
}

export async function dbIssueSafetyReportDecision(
  input: SafetyIssueDecisionInput
): Promise<SafetyIssueDecisionResult> {
  const reportId =
    String(input.reportId || "").trim();

  const actorUserId =
    String(input.actorUserId || "").trim();

  const actorRole =
    normalizeDecisionActorRole(
      input.actorRole
    );

  const decisionType =
    normalizeDecisionType(
      input.decisionType
    );

  const reason =
    String(input.reason || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

  const notes =
    String(input.notes || "")
      .trim()
      .slice(0, 12000);

  const confidenceRaw =
    input.confidence;

  const confidence =
    confidenceRaw === undefined ||
    confidenceRaw === null ||
    !Number.isFinite(Number(confidenceRaw))
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              Number(confidenceRaw)
            )
          )
        );

  const durationDays =
    input.durationDays === undefined ||
    input.durationDays === null
      ? null
      : Math.max(
          1,
          Math.min(
            3650,
            Math.round(
              Number(input.durationDays)
            )
          )
        );

  if (
    !reportId ||
    !actorUserId ||
    !actorRole ||
    !decisionType
  ) {
    throw new Error(
      "Complete decision information is required."
    );
  }

  if (reason.length < 8) {
    throw new Error(
      "Decision reason must contain at least 8 characters."
    );
  }

  if (
    (
      decisionType === "restrict_account" ||
      decisionType === "suspend_account"
    ) &&
    !durationDays
  ) {
    throw new Error(
      "Choose a restriction duration."
    );
  }

  const accountEnforcement =
    input.accountEnforcement;

  if (accountEnforcement) {
    const enforcementType =
      String(
        accountEnforcement.enforcementType ||
          ""
      )
        .trim()
        .toLowerCase();

    if (enforcementType !== decisionType) {
      throw new Error(
        "Enforcement type must match the decision type."
      );
    }

    if (
      !String(
        accountEnforcement.userId || ""
      ).trim()
    ) {
      throw new Error(
        "The reported account identity could not be resolved."
      );
    }
  }

  await ensureSafetyReportSchema();
  await ensureSafetyAccountEnforcementSchema();

  const sql = getSql();

  const existingRows = (await sql`
    SELECT
      id,
      status,
      assigned_supervisor_user_id,
      assigned_agent_user_id
    FROM kristo_safety_reports
    WHERE id = ${reportId}
    LIMIT 1
  `) as Array<{
    id: string;
    status: string;
    assigned_supervisor_user_id: string | null;
    assigned_agent_user_id: string | null;
  }>;

  const existing = existingRows[0];

  if (!existing) {
    throw new Error(
      "Safety report was not found."
    );
  }

  if (
    existing.status === "resolved" ||
    existing.status === "dismissed"
  ) {
    throw new Error(
      "This case already has a final decision."
    );
  }

  const isAssignedAgent =
    String(
      existing.assigned_agent_user_id || ""
    ).trim() === actorUserId;

  const isAssignedSupervisor =
    String(
      existing.assigned_supervisor_user_id || ""
    ).trim() === actorUserId;

  if (
    actorRole === "agent" &&
    !isAssignedAgent
  ) {
    throw new Error(
      "This case is not assigned to your Safety Agent account."
    );
  }

  if (
    actorRole === "supervisor" &&
    !isAssignedSupervisor
  ) {
    throw new Error(
      "This case is not assigned to your Safety Supervisor account."
    );
  }

  if (
    actorRole === "agent" &&
    decisionType === "permanent_ban"
  ) {
    throw new Error(
      "Permanent bans require Supervisor approval."
    );
  }

  const finalStatus: SafetyReportStatus =
    decisionType === "escalate"
      ? "escalated"
      : decisionType === "no_violation"
        ? "dismissed"
        : "resolved";

  const decisionAt = nowIso();

  const enforcementUserId =
    String(
      accountEnforcement?.userId || ""
    ).trim();

  const enforcementKristoId =
    String(
      accountEnforcement?.kristoId || ""
    )
      .trim()
      .toUpperCase();

  const enforcementType =
    accountEnforcement
      ? (String(
          accountEnforcement.enforcementType
        )
          .trim()
          .toLowerCase() as SafetyAccountEnforcementType)
      : null;

  const enforcementDurationDays =
    enforcementType === "warning" ||
    enforcementType === "permanent_ban" ||
    !enforcementType
      ? null
      : durationDays;

  const enforcementStartsAt =
    new Date();

  const enforcementExpiresAt =
    enforcementDurationDays
      ? new Date(
          enforcementStartsAt.getTime() +
            enforcementDurationDays *
              24 *
              60 *
              60 *
              1000
        )
      : null;

  const enforcementId =
    enforcementType
      ? createSafetyEnforcementId()
      : null;

  const eventId =
    createSafetyReportEventId();

  const eventTitle =
    decisionType === "escalate"
      ? "Case escalated"
      : decisionType === "no_violation"
        ? "No violation found"
        : "Decision issued";

  const eventType =
    decisionType === "escalate"
      ? "case_escalated"
      : "decision_issued";

  const metadataJson = JSON.stringify({
    decisionType,
    confidence,
    durationDays,
    finalStatus,
    enforcementId,
    enforcementType,
    reversible:
      decisionType !== "permanent_ban",
  });

  const hasAccountEnforcement = Boolean(enforcementId);

  const updatedRows = (await sql`
    WITH updated AS (
      UPDATE kristo_safety_reports
      SET
        status = ${finalStatus}::text,
        decision_type = ${decisionType}::text,
        decision_reason = ${reason}::text,
        decision_notes = ${notes || null}::text,
        decision_confidence = ${confidence}::integer,
        decision_duration_days = ${durationDays}::integer,
        decided_by_user_id = ${actorUserId}::text,
        decided_by_role = ${actorRole}::text,
        decision_at = ${decisionAt}::timestamptz,
        resolved_at =
          CASE
            WHEN ${finalStatus}::text IN (
              'resolved',
              'dismissed'
            )
            THEN ${decisionAt}::timestamptz
            ELSE NULL::timestamptz
          END,
        updated_at = ${decisionAt}::timestamptz
      WHERE id = ${reportId}::text
        AND status NOT IN (
          'resolved',
          'dismissed'
        )
      RETURNING
        id,
        report_code,
        reporter_user_id,
        reporter_kristo_id,
        reported_user_id,
        reported_kristo_id,
        church_id,
        source_type,
        source_id,
        source_room_id,
        source_message_id,
        target_type,
        target_id,
        target_title,
        target_subtitle,
        target_preview,
        target_owner_user_id,
        target_owner_kristo_id,
        target_owner_name,
        target_owner_avatar_uri,
        target_media_type,
        target_thumbnail_uri,
        category,
        reason,
        description,
        priority,
        status,
        assigned_supervisor_user_id,
        assigned_agent_user_id,
        decision_type,
        decision_reason,
        decision_notes,
        decision_confidence,
        decision_duration_days,
        decided_by_user_id,
        decided_by_role,
        decision_at,
        ai_recommendation,
        ai_confidence,
        created_at,
        updated_at,
        assigned_at,
        resolved_at
    ),
    expire_old AS (
      UPDATE kristo_safety_account_enforcements e
      SET
        status = 'expired',
        updated_at = NOW()
      WHERE
        ${hasAccountEnforcement}::boolean
        AND e.user_id = ${enforcementUserId || null}::text
        AND e.status = 'active'
        AND e.expires_at IS NOT NULL
        AND e.expires_at <= NOW()
        AND EXISTS (SELECT 1 FROM updated)
      RETURNING e.id
    ),
    revoke_conflicts AS (
      UPDATE kristo_safety_account_enforcements e
      SET
        status = 'revoked',
        updated_at = NOW()
      WHERE
        ${hasAccountEnforcement}::boolean
        AND e.user_id = ${enforcementUserId || null}::text
        AND e.status = 'active'
        AND EXISTS (SELECT 1 FROM updated)
        AND (
          (
            COALESCE(${enforcementType || null}::text, '') = 'permanent_ban'
            AND e.enforcement_type IN (
              'restrict_account',
              'suspend_account',
              'warning'
            )
          )
          OR (
            COALESCE(${enforcementType || null}::text, '') IN (
              'restrict_account',
              'suspend_account'
            )
            AND e.enforcement_type IN (
              'restrict_account',
              'suspend_account'
            )
          )
        )
      RETURNING e.id
    ),
    inserted_enf AS (
      INSERT INTO kristo_safety_account_enforcements (
        id,
        user_id,
        kristo_id,
        report_id,
        enforcement_type,
        reason,
        duration_days,
        starts_at,
        expires_at,
        status,
        issued_by_user_id,
        issued_by_role,
        created_at,
        updated_at
      )
      SELECT
        ${enforcementId}::text,
        ${enforcementUserId || null}::text,
        ${enforcementKristoId || null}::text,
        ${reportId}::text,
        ${enforcementType || null}::text,
        ${reason}::text,
        ${enforcementDurationDays}::integer,
        ${enforcementStartsAt.toISOString()}::timestamptz,
        ${
          enforcementExpiresAt
            ? enforcementExpiresAt.toISOString()
            : null
        }::timestamptz,
        'active',
        ${actorUserId}::text,
        ${actorRole}::text,
        NOW(),
        NOW()
      WHERE
        ${hasAccountEnforcement}::boolean
        AND EXISTS (SELECT 1 FROM updated)
      RETURNING id
    ),
    inserted_evt AS (
      INSERT INTO kristo_safety_report_events (
        id,
        report_id,
        event_type,
        actor_user_id,
        actor_role,
        title,
        details,
        metadata_json,
        created_at
      )
      SELECT
        ${eventId}::text,
        ${reportId}::text,
        ${eventType}::text,
        ${actorUserId}::text,
        ${actorRole}::text,
        ${eventTitle}::text,
        ${reason}::text,
        ${metadataJson}::text,
        ${decisionAt}::timestamptz
      FROM updated
      RETURNING id
    )
    SELECT * FROM updated
  `) as SafetyReportRow[];

  const updated = updatedRows[0];

  if (!updated) {
    throw new Error(
      "This case already has a final decision."
    );
  }

  const enforcementRecord:
    | SafetyAccountEnforcementRecord
    | undefined =
    enforcementType &&
    enforcementId &&
    enforcementUserId
      ? {
          id: enforcementId,
          userId: enforcementUserId,
          reportId,
          enforcementType,
          reason,
          durationDays:
            enforcementDurationDays ||
            undefined,
          startsAt:
            enforcementStartsAt.toISOString(),
          expiresAt:
            enforcementExpiresAt
              ? enforcementExpiresAt.toISOString()
              : undefined,
          status: "active",
        }
      : undefined;

  return {
    report: rowToReport(updated),
    enforcement: enforcementRecord,
  };
}

export type SafetyTargetReportStats = {
  totalReports: number;
  uniqueReporters: number;
  activeReports: number;
  escalatedReports: number;
  resolvedReports: number;
  dismissedReports: number;
};

export async function dbGetSafetyTargetReportStats(
  input: {
    targetType?: string;
    targetId?: string;
    sourceType?: string;
    sourceId?: string;
  }
): Promise<SafetyTargetReportStats> {
  await ensureSafetyReportSchema();

  const sql = getSql();

  const targetType =
    String(
      input.targetType || ""
    )
      .trim()
      .toLowerCase();

  const targetId =
    String(
      input.targetId || ""
    ).trim();

  const sourceType =
    String(
      input.sourceType || ""
    )
      .trim()
      .toLowerCase();

  const sourceId =
    String(
      input.sourceId || ""
    ).trim();

  type StatsRow = {
    total_reports:
      | number
      | string
      | null;
    unique_reporters:
      | number
      | string
      | null;
    active_reports:
      | number
      | string
      | null;
    escalated_reports:
      | number
      | string
      | null;
    resolved_reports:
      | number
      | string
      | null;
    dismissed_reports:
      | number
      | string
      | null;
  };

  let rows: StatsRow[] = [];

  if (targetId) {
    rows = (await sql`
      SELECT
        COUNT(*)::int
          AS total_reports,

        COUNT(
          DISTINCT reporter_user_id
        )::int
          AS unique_reporters,

        COUNT(*) FILTER (
          WHERE status IN (
            'open',
            'assigned',
            'in_review',
            'enforcement_pending',
            'recovery_required'
          )
        )::int
          AS active_reports,

        COUNT(*) FILTER (
          WHERE status = 'escalated'
        )::int
          AS escalated_reports,

        COUNT(*) FILTER (
          WHERE status = 'resolved'
        )::int
          AS resolved_reports,

        COUNT(*) FILTER (
          WHERE status = 'dismissed'
        )::int
          AS dismissed_reports

      FROM kristo_safety_reports

      WHERE
        target_id = ${targetId}

        AND (
          ${targetType} = ''
          OR target_type =
            ${targetType}
        )
    `) as StatsRow[];
  } else if (sourceId) {
    rows = (await sql`
      SELECT
        COUNT(*)::int
          AS total_reports,

        COUNT(
          DISTINCT reporter_user_id
        )::int
          AS unique_reporters,

        COUNT(*) FILTER (
          WHERE status IN (
            'open',
            'assigned',
            'in_review',
            'enforcement_pending',
            'recovery_required'
          )
        )::int
          AS active_reports,

        COUNT(*) FILTER (
          WHERE status = 'escalated'
        )::int
          AS escalated_reports,

        COUNT(*) FILTER (
          WHERE status = 'resolved'
        )::int
          AS resolved_reports,

        COUNT(*) FILTER (
          WHERE status = 'dismissed'
        )::int
          AS dismissed_reports

      FROM kristo_safety_reports

      WHERE
        source_id = ${sourceId}

        AND (
          ${sourceType} = ''
          OR source_type =
            ${sourceType}
        )
    `) as StatsRow[];
  }

  const row = rows[0];

  return {
    totalReports:
      Number(
        row?.total_reports || 0
      ) || 0,

    uniqueReporters:
      Number(
        row?.unique_reporters || 0
      ) || 0,

    activeReports:
      Number(
        row?.active_reports || 0
      ) || 0,

    escalatedReports:
      Number(
        row?.escalated_reports || 0
      ) || 0,

    resolvedReports:
      Number(
        row?.resolved_reports || 0
      ) || 0,

    dismissedReports:
      Number(
        row?.dismissed_reports || 0
      ) || 0,
  };
}

export type SafetyTargetRiskAssessment = {
  available: boolean;
  weightedScore: number | null;
  weightedPercent: number | null;
  actionThreshold: number;
  actionRequired: boolean;

  totalReports: number;
  uniqueReporters: number;

  currentReporterLifetimeReports: number | null;
  currentReporterVoteWeightPercent: number | null;

  signalLevel:
    | "calculating"
    | "low"
    | "monitor"
    | "review"
    | "action_required";

  recommendation:
    | "calculating"
    | "monitor"
    | "review_evidence"
    | "agent_action_required";
};

function safetyReporterVoteWeight(
  lifetimeReportCount: number
) {
  /*
   * First lifetime report = 100%.
   * Every additional lifetime report removes 10%.
   * The tenth and all later reports remain at 10%.
   */
  const normalizedCount =
    Math.max(
      1,
      Math.floor(
        Number(
          lifetimeReportCount || 1
        )
      )
    );

  return Math.max(
    10,
    110 -
      normalizedCount * 10
  );
}

/** Exported for Safety Center verification harness. */
export function computeSafetyReporterVoteWeight(
  lifetimeReportCount: number
) {
  return safetyReporterVoteWeight(
    lifetimeReportCount
  );
}

/** Exported for Safety Center verification harness. */
export function buildEmptySafetyRiskAssessment() {
  return emptyRiskAssessment();
}

const SAFETY_ACTION_THRESHOLD = 4.9;

function emptyRiskAssessment(): SafetyTargetRiskAssessment {
  return {
    available: false,
    weightedScore: null,
    weightedPercent: null,
    actionThreshold: SAFETY_ACTION_THRESHOLD,
    actionRequired: false,
    totalReports: 0,
    uniqueReporters: 0,
    currentReporterLifetimeReports: null,
    currentReporterVoteWeightPercent: null,
    signalLevel: "calculating",
    recommendation: "calculating",
  };
}

export async function dbGetSafetyTargetRiskAssessment(
  input: {
    targetType?: string;
    targetId?: string;
    sourceType?: string;
    sourceId?: string;
    currentReporterUserId?: string;
  }
): Promise<SafetyTargetRiskAssessment> {
  const targetType =
    String(
      input.targetType || ""
    )
      .trim()
      .toLowerCase();

  const targetId =
    String(
      input.targetId || ""
    ).trim();

  const sourceType =
    String(
      input.sourceType || ""
    )
      .trim()
      .toLowerCase();

  const sourceId =
    String(
      input.sourceId || ""
    ).trim();

  const currentReporterUserId =
    String(
      input.currentReporterUserId || ""
    ).trim();

  if (!targetId && !sourceId) {
    return emptyRiskAssessment();
  }

  await ensureSafetyReportSchema();

  const sql = getSql();

  type TargetReporterRow = {
    reporter_user_id:
      | string
      | null;
    target_report_count:
      | number
      | string
      | null;
    lifetime_report_count:
      | number
      | string
      | null;
  };

  let rows:
    TargetReporterRow[] = [];

  if (targetId) {
    rows = (await sql`
      WITH target_reporters AS (
        SELECT
          reporter_user_id,
          COUNT(*)::int
            AS target_report_count
        FROM kristo_safety_reports
        WHERE
          target_id = ${targetId}
          AND (
            ${targetType} = ''
            OR target_type =
              ${targetType}
          )
        GROUP BY reporter_user_id
      ),

      lifetime_counts AS (
        SELECT
          reporter_user_id,
          COUNT(*)::int
            AS lifetime_report_count
        FROM kristo_safety_reports
        WHERE reporter_user_id IN (
          SELECT reporter_user_id
          FROM target_reporters
        )
        GROUP BY reporter_user_id
      )

      SELECT
        target_reporters
          .reporter_user_id,

        target_reporters
          .target_report_count,

        COALESCE(
          lifetime_counts
            .lifetime_report_count,
          1
        )::int
          AS lifetime_report_count

      FROM target_reporters

      LEFT JOIN lifetime_counts
        ON lifetime_counts
          .reporter_user_id =
        target_reporters
          .reporter_user_id
    `) as TargetReporterRow[];
  } else {
    rows = (await sql`
      WITH target_reporters AS (
        SELECT
          reporter_user_id,
          COUNT(*)::int
            AS target_report_count
        FROM kristo_safety_reports
        WHERE
          source_id = ${sourceId}
          AND (
            ${sourceType} = ''
            OR source_type =
              ${sourceType}
          )
        GROUP BY reporter_user_id
      ),

      lifetime_counts AS (
        SELECT
          reporter_user_id,
          COUNT(*)::int
            AS lifetime_report_count
        FROM kristo_safety_reports
        WHERE reporter_user_id IN (
          SELECT reporter_user_id
          FROM target_reporters
        )
        GROUP BY reporter_user_id
      )

      SELECT
        target_reporters
          .reporter_user_id,

        target_reporters
          .target_report_count,

        COALESCE(
          lifetime_counts
            .lifetime_report_count,
          1
        )::int
          AS lifetime_report_count

      FROM target_reporters

      LEFT JOIN lifetime_counts
        ON lifetime_counts
          .reporter_user_id =
        target_reporters
          .reporter_user_id
    `) as TargetReporterRow[];
  }

  if (!rows.length) {
    return emptyRiskAssessment();
  }

  let weightedVotes = 0;
  let totalReports = 0;

  let currentReporterLifetimeReports:
    number | null = null;

  let currentReporterVoteWeightPercent:
    number | null = null;

  for (const row of rows) {
    const reporterUserId =
      String(
        row.reporter_user_id || ""
      ).trim();

    const targetReportCount =
      Math.max(
        1,
        Number(
          row.target_report_count || 1
        ) || 1
      );

    const lifetimeReportCount =
      Math.max(
        1,
        Number(
          row.lifetime_report_count || 1
        ) || 1
      );

    const voteWeightPercent =
      safetyReporterVoteWeight(
        lifetimeReportCount
      );

    /*
     * One reporter contributes one weighted vote
     * to the same target, even when old duplicate
     * records exist.
     */
    weightedVotes +=
      voteWeightPercent / 100;

    totalReports +=
      targetReportCount;

    if (
      reporterUserId &&
      reporterUserId ===
        currentReporterUserId
    ) {
      currentReporterLifetimeReports =
        lifetimeReportCount;

      currentReporterVoteWeightPercent =
        voteWeightPercent;
    }
  }

  const weightedScore =
    Math.min(
      10,
      Math.round(
        weightedVotes * 100
      ) / 100
    );

  const weightedPercent =
    Math.min(
      100,
      Math.round(
        weightedScore * 10
      )
    );

  const actionRequired =
    weightedScore >=
    SAFETY_ACTION_THRESHOLD;

  const signalLevel =
    actionRequired
      ? "action_required"
      : weightedScore >= 3
        ? "review"
        : weightedScore >= 1.5
          ? "monitor"
          : "low";

  const recommendation =
    actionRequired
      ? "agent_action_required"
      : weightedScore >= 3
        ? "review_evidence"
        : "monitor";

  return {
    available: true,
    weightedScore,
    weightedPercent,
    actionThreshold: SAFETY_ACTION_THRESHOLD,
    actionRequired,

    totalReports,
    uniqueReporters: rows.length,

    currentReporterLifetimeReports,
    currentReporterVoteWeightPercent,

    signalLevel,
    recommendation,
  };
}

function safeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function safeLower(value: unknown) {
  return safeText(value).toLowerCase();
}

function asRowArray<T extends Record<string, unknown>>(
  value: unknown
): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function rowNumber(
  row: Record<string, unknown> | undefined,
  key: string
) {
  if (!row) return 0;
  const raw = row[key];
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Full Case Intelligence for one Safety report.
 * Uses a small set of branched aggregate queries (no N+1,
 * no `${id} <> ''` SQL parameter tricks).
 */
export async function dbGetSafetyCaseIntelligence(input: {
  report: SafetyReportRecord;
  originalContentAvailable?: boolean;
  hasMediaUri?: boolean;
}): Promise<SafetyCaseIntelligence> {
  // First statement — proves this function was entered.
  console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_INPUT", {
    reportId: input?.report?.id ?? null,
    reporterUserId: input?.report?.reporterUserId ?? null,
    targetUserId:
      input?.report?.targetOwnerUserId ??
      input?.report?.reportedUserId ??
      null,
    stage: "db_function_enter",
  });

  const report = input?.report;
  const reportId = safeText(report?.id);
  const reporterUserId = safeText(report?.reporterUserId);
  const targetId = safeText(report?.targetId);
  const targetType = safeLower(report?.targetType);
  const ownerUserId = safeText(
    report?.targetOwnerUserId || report?.reportedUserId
  );
  const sourceId = safeText(report?.sourceId);

  try {
    await ensureSafetyReportSchema();

    const sql = getSql();

    type CountRow = Record<string, unknown>;

    /*
     * Reporter history — always scoped by reporter_user_id.
     * Target-overlap counts are branched in JS so Neon never
     * receives `${id} <> ''` parameter comparisons.
     */
    let reporterRow: CountRow = {};
    if (reporterUserId) {
      if (targetId && ownerUserId) {
        reporterRow =
          asRowArray<CountRow>(
            await sql`
              SELECT
                COUNT(*)::int AS lifetime_reports,
                COUNT(*) FILTER (
                  WHERE status = 'resolved'
                    AND decision_type IS NOT NULL
                    AND decision_type NOT IN (
                      'no_violation',
                      'escalate'
                    )
                )::int AS confirmed_reports,
                COUNT(*) FILTER (
                  WHERE status = 'dismissed'
                    OR decision_type = 'no_violation'
                )::int AS dismissed_reports,
                COUNT(*) FILTER (
                  WHERE target_id = ${targetId}
                    OR target_owner_user_id = ${ownerUserId}
                    OR reported_user_id = ${ownerUserId}
                )::int AS reports_on_this_target,
                COUNT(*) FILTER (
                  WHERE decision_type = 'no_violation'
                    AND LOWER(
                      COALESCE(decision_reason, '')
                    ) LIKE '%false%'
                )::int AS false_reporting_penalties
              FROM kristo_safety_reports
              WHERE reporter_user_id = ${reporterUserId}
            `
          )[0] || {};
      } else if (targetId) {
        reporterRow =
          asRowArray<CountRow>(
            await sql`
              SELECT
                COUNT(*)::int AS lifetime_reports,
                COUNT(*) FILTER (
                  WHERE status = 'resolved'
                    AND decision_type IS NOT NULL
                    AND decision_type NOT IN (
                      'no_violation',
                      'escalate'
                    )
                )::int AS confirmed_reports,
                COUNT(*) FILTER (
                  WHERE status = 'dismissed'
                    OR decision_type = 'no_violation'
                )::int AS dismissed_reports,
                COUNT(*) FILTER (
                  WHERE target_id = ${targetId}
                )::int AS reports_on_this_target,
                COUNT(*) FILTER (
                  WHERE decision_type = 'no_violation'
                    AND LOWER(
                      COALESCE(decision_reason, '')
                    ) LIKE '%false%'
                )::int AS false_reporting_penalties
              FROM kristo_safety_reports
              WHERE reporter_user_id = ${reporterUserId}
            `
          )[0] || {};
      } else if (ownerUserId) {
        reporterRow =
          asRowArray<CountRow>(
            await sql`
              SELECT
                COUNT(*)::int AS lifetime_reports,
                COUNT(*) FILTER (
                  WHERE status = 'resolved'
                    AND decision_type IS NOT NULL
                    AND decision_type NOT IN (
                      'no_violation',
                      'escalate'
                    )
                )::int AS confirmed_reports,
                COUNT(*) FILTER (
                  WHERE status = 'dismissed'
                    OR decision_type = 'no_violation'
                )::int AS dismissed_reports,
                COUNT(*) FILTER (
                  WHERE target_owner_user_id = ${ownerUserId}
                    OR reported_user_id = ${ownerUserId}
                )::int AS reports_on_this_target,
                COUNT(*) FILTER (
                  WHERE decision_type = 'no_violation'
                    AND LOWER(
                      COALESCE(decision_reason, '')
                    ) LIKE '%false%'
                )::int AS false_reporting_penalties
              FROM kristo_safety_reports
              WHERE reporter_user_id = ${reporterUserId}
            `
          )[0] || {};
      } else {
        reporterRow =
          asRowArray<CountRow>(
            await sql`
              SELECT
                COUNT(*)::int AS lifetime_reports,
                COUNT(*) FILTER (
                  WHERE status = 'resolved'
                    AND decision_type IS NOT NULL
                    AND decision_type NOT IN (
                      'no_violation',
                      'escalate'
                    )
                )::int AS confirmed_reports,
                COUNT(*) FILTER (
                  WHERE status = 'dismissed'
                    OR decision_type = 'no_violation'
                )::int AS dismissed_reports,
                0::int AS reports_on_this_target,
                COUNT(*) FILTER (
                  WHERE decision_type = 'no_violation'
                    AND LOWER(
                      COALESCE(decision_reason, '')
                    ) LIKE '%false%'
                )::int AS false_reporting_penalties
              FROM kristo_safety_reports
              WHERE reporter_user_id = ${reporterUserId}
            `
          )[0] || {};
      }
    }

    let targetRow: CountRow = {};
    if (targetId && ownerUserId) {
      targetRow =
        asRowArray<CountRow>(
          await sql`
            SELECT
              COUNT(*)::int AS total_reports,
              COUNT(DISTINCT reporter_user_id)::int AS unique_reporters,
              COUNT(*) FILTER (
                WHERE status IN (
                  'open',
                  'assigned',
                  'in_review',
                  'enforcement_pending',
                  'recovery_required'
                )
              )::int AS active_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
              )::int AS resolved_reports,
              COUNT(*) FILTER (
                WHERE status = 'dismissed'
                  OR decision_type = 'no_violation'
              )::int AS dismissed_reports,
              COUNT(*) FILTER (
                WHERE status = 'escalated'
              )::int AS escalated_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
                  AND decision_type IS NOT NULL
                  AND decision_type NOT IN (
                    'no_violation',
                    'escalate'
                  )
              )::int AS confirmed_violations,
              COUNT(*) FILTER (
                WHERE decision_type = 'warning'
              )::int AS warnings,
              COUNT(*) FILTER (
                WHERE decision_type = 'remove_content'
              )::int AS removals,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_last_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_last_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_last_90d,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '24 hours'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_24h,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '7 days'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_7d
            FROM kristo_safety_reports
            WHERE (
              target_id = ${targetId}
              AND (
                ${targetType} = ''
                OR target_type = ${targetType}
              )
            )
            OR target_owner_user_id = ${ownerUserId}
            OR reported_user_id = ${ownerUserId}
          `
        )[0] || {};
    } else if (targetId) {
      targetRow =
        asRowArray<CountRow>(
          await sql`
            SELECT
              COUNT(*)::int AS total_reports,
              COUNT(DISTINCT reporter_user_id)::int AS unique_reporters,
              COUNT(*) FILTER (
                WHERE status IN (
                  'open',
                  'assigned',
                  'in_review',
                  'enforcement_pending',
                  'recovery_required'
                )
              )::int AS active_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
              )::int AS resolved_reports,
              COUNT(*) FILTER (
                WHERE status = 'dismissed'
                  OR decision_type = 'no_violation'
              )::int AS dismissed_reports,
              COUNT(*) FILTER (
                WHERE status = 'escalated'
              )::int AS escalated_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
                  AND decision_type IS NOT NULL
                  AND decision_type NOT IN (
                    'no_violation',
                    'escalate'
                  )
              )::int AS confirmed_violations,
              COUNT(*) FILTER (
                WHERE decision_type = 'warning'
              )::int AS warnings,
              COUNT(*) FILTER (
                WHERE decision_type = 'remove_content'
              )::int AS removals,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_last_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_last_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_last_90d,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '24 hours'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_24h,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '7 days'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_7d
            FROM kristo_safety_reports
            WHERE target_id = ${targetId}
              AND (
                ${targetType} = ''
                OR target_type = ${targetType}
              )
          `
        )[0] || {};
    } else if (ownerUserId) {
      targetRow =
        asRowArray<CountRow>(
          await sql`
            SELECT
              COUNT(*)::int AS total_reports,
              COUNT(DISTINCT reporter_user_id)::int AS unique_reporters,
              COUNT(*) FILTER (
                WHERE status IN (
                  'open',
                  'assigned',
                  'in_review',
                  'enforcement_pending',
                  'recovery_required'
                )
              )::int AS active_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
              )::int AS resolved_reports,
              COUNT(*) FILTER (
                WHERE status = 'dismissed'
                  OR decision_type = 'no_violation'
              )::int AS dismissed_reports,
              COUNT(*) FILTER (
                WHERE status = 'escalated'
              )::int AS escalated_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
                  AND decision_type IS NOT NULL
                  AND decision_type NOT IN (
                    'no_violation',
                    'escalate'
                  )
              )::int AS confirmed_violations,
              COUNT(*) FILTER (
                WHERE decision_type = 'warning'
              )::int AS warnings,
              COUNT(*) FILTER (
                WHERE decision_type = 'remove_content'
              )::int AS removals,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_last_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_last_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_last_90d,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '24 hours'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_24h,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '7 days'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_7d
            FROM kristo_safety_reports
            WHERE target_owner_user_id = ${ownerUserId}
              OR reported_user_id = ${ownerUserId}
          `
        )[0] || {};
    } else if (sourceId) {
      targetRow =
        asRowArray<CountRow>(
          await sql`
            SELECT
              COUNT(*)::int AS total_reports,
              COUNT(DISTINCT reporter_user_id)::int AS unique_reporters,
              COUNT(*) FILTER (
                WHERE status IN (
                  'open',
                  'assigned',
                  'in_review',
                  'enforcement_pending',
                  'recovery_required'
                )
              )::int AS active_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
              )::int AS resolved_reports,
              COUNT(*) FILTER (
                WHERE status = 'dismissed'
                  OR decision_type = 'no_violation'
              )::int AS dismissed_reports,
              COUNT(*) FILTER (
                WHERE status = 'escalated'
              )::int AS escalated_reports,
              COUNT(*) FILTER (
                WHERE status = 'resolved'
                  AND decision_type IS NOT NULL
                  AND decision_type NOT IN (
                    'no_violation',
                    'escalate'
                  )
              )::int AS confirmed_violations,
              COUNT(*) FILTER (
                WHERE decision_type = 'warning'
              )::int AS warnings,
              COUNT(*) FILTER (
                WHERE decision_type = 'remove_content'
              )::int AS removals,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '7 days'
              )::int AS reports_last_7d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '30 days'
              )::int AS reports_last_30d,
              COUNT(*) FILTER (
                WHERE created_at >= NOW() - INTERVAL '90 days'
              )::int AS reports_last_90d,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '24 hours'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_24h,
              COUNT(DISTINCT CASE
                WHEN created_at >= NOW() - INTERVAL '7 days'
                THEN reporter_user_id
              END)::int AS unique_reporters_last_7d
            FROM kristo_safety_reports
            WHERE source_id = ${sourceId}
          `
        )[0] || {};
    }

    let categoryRows: Array<{ category?: string | null }> = [];
    if (targetId && ownerUserId) {
      categoryRows = asRowArray(
        await sql`
          SELECT category, COUNT(*)::int AS category_count
          FROM kristo_safety_reports
          WHERE target_id = ${targetId}
            OR target_owner_user_id = ${ownerUserId}
            OR reported_user_id = ${ownerUserId}
          GROUP BY category
          HAVING COUNT(*) >= 2
          ORDER BY category_count DESC
          LIMIT 5
        `
      );
    } else if (targetId) {
      categoryRows = asRowArray(
        await sql`
          SELECT category, COUNT(*)::int AS category_count
          FROM kristo_safety_reports
          WHERE target_id = ${targetId}
          GROUP BY category
          HAVING COUNT(*) >= 2
          ORDER BY category_count DESC
          LIMIT 5
        `
      );
    } else if (ownerUserId) {
      categoryRows = asRowArray(
        await sql`
          SELECT category, COUNT(*)::int AS category_count
          FROM kristo_safety_reports
          WHERE target_owner_user_id = ${ownerUserId}
            OR reported_user_id = ${ownerUserId}
          GROUP BY category
          HAVING COUNT(*) >= 2
          ORDER BY category_count DESC
          LIMIT 5
        `
      );
    }

    /*
     * Read-only enforcement lookup. Do NOT run schema/index
     * migrations on the report-detail path — that path has
     * thrown when unique-index creation races with duplicates.
     */
    let enforcementRow: CountRow = {};
    if (ownerUserId) {
      try {
        enforcementRow =
          asRowArray<CountRow>(
            await sql`
              SELECT
                COUNT(*) FILTER (
                  WHERE enforcement_type = 'warning'
                )::int AS warnings,
                COUNT(*) FILTER (
                  WHERE enforcement_type = 'restrict_account'
                )::int AS restrictions,
                COUNT(*) FILTER (
                  WHERE enforcement_type = 'suspend_account'
                )::int AS suspensions,
                COUNT(*) FILTER (
                  WHERE enforcement_type = 'permanent_ban'
                )::int AS permanent_bans
              FROM kristo_safety_account_enforcements
              WHERE user_id = ${ownerUserId}
            `
          )[0] || {};
      } catch (enforcementError: any) {
        console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_FAILED", {
          reportId: reportId || null,
          reporterUserId: reporterUserId || null,
          targetUserId: ownerUserId || null,
          stage: "enforcement_lookup",
          error: safeText(
            enforcementError?.message ||
              "enforcement_lookup_failed"
          ),
        });
        enforcementRow = {};
      }
    }

    let duplicateCount = 0;
    if (reporterUserId && reportId && (targetId || ownerUserId)) {
      try {
        if (targetId && ownerUserId) {
          duplicateCount = rowNumber(
            asRowArray<CountRow>(
              await sql`
                SELECT COUNT(*)::int AS duplicate_count
                FROM kristo_safety_reports
                WHERE reporter_user_id = ${reporterUserId}
                  AND id <> ${reportId}
                  AND (
                    target_id = ${targetId}
                    OR target_owner_user_id = ${ownerUserId}
                    OR reported_user_id = ${ownerUserId}
                  )
                  AND created_at >= NOW() - INTERVAL '7 days'
              `
            )[0],
            "duplicate_count"
          );
        } else if (targetId) {
          duplicateCount = rowNumber(
            asRowArray<CountRow>(
              await sql`
                SELECT COUNT(*)::int AS duplicate_count
                FROM kristo_safety_reports
                WHERE reporter_user_id = ${reporterUserId}
                  AND id <> ${reportId}
                  AND target_id = ${targetId}
                  AND created_at >= NOW() - INTERVAL '7 days'
              `
            )[0],
            "duplicate_count"
          );
        } else {
          duplicateCount = rowNumber(
            asRowArray<CountRow>(
              await sql`
                SELECT COUNT(*)::int AS duplicate_count
                FROM kristo_safety_reports
                WHERE reporter_user_id = ${reporterUserId}
                  AND id <> ${reportId}
                  AND (
                    target_owner_user_id = ${ownerUserId}
                    OR reported_user_id = ${ownerUserId}
                  )
                  AND created_at >= NOW() - INTERVAL '7 days'
              `
            )[0],
            "duplicate_count"
          );
        }
      } catch (duplicateError: any) {
        console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_FAILED", {
          reportId: reportId || null,
          reporterUserId: reporterUserId || null,
          targetUserId: ownerUserId || null,
          stage: "duplicate_lookup",
          error: safeText(
            duplicateError?.message || "duplicate_lookup_failed"
          ),
        });
        duplicateCount = 0;
      }
    }

    const raw: CaseIntelligenceRawInput = {
      reportId,
      category: safeText(report?.category) || "other",
      reason: safeText(report?.reason),
      description:
        report?.description == null
          ? undefined
          : safeText(report.description) || undefined,
      priority: safeText(report?.priority) || "normal",
      targetType: targetType || "other",
      targetId: targetId || undefined,
      targetOwnerUserId: ownerUserId || undefined,
      reporterUserId,
      originalContentAvailable: Boolean(
        input.originalContentAvailable
      ),
      hasThumbnail: Boolean(
        safeText(report?.targetThumbnailUri)
      ),
      hasPreview: Boolean(safeText(report?.targetPreview)),
      hasTitle: Boolean(safeText(report?.targetTitle)),
      hasMediaUri: Boolean(input.hasMediaUri),
      mediaType: safeText(report?.targetMediaType) || undefined,
      createdAt:
        report?.createdAt == null
          ? undefined
          : safeText(report.createdAt) || undefined,
      reporterLifetimeReports: rowNumber(
        reporterRow,
        "lifetime_reports"
      ),
      reporterConfirmedReports: rowNumber(
        reporterRow,
        "confirmed_reports"
      ),
      reporterDismissedReports: rowNumber(
        reporterRow,
        "dismissed_reports"
      ),
      reporterDuplicateOnThisTarget: duplicateCount,
      reporterReportsOnThisTarget: rowNumber(
        reporterRow,
        "reports_on_this_target"
      ),
      reporterHasFalseReportingPenalty:
        rowNumber(reporterRow, "false_reporting_penalties") > 0,
      targetTotalReports: rowNumber(targetRow, "total_reports"),
      targetUniqueReporters: rowNumber(
        targetRow,
        "unique_reporters"
      ),
      targetActiveReports: rowNumber(targetRow, "active_reports"),
      targetResolvedReports: rowNumber(
        targetRow,
        "resolved_reports"
      ),
      targetDismissedReports: rowNumber(
        targetRow,
        "dismissed_reports"
      ),
      targetEscalatedReports: rowNumber(
        targetRow,
        "escalated_reports"
      ),
      targetConfirmedViolations: rowNumber(
        targetRow,
        "confirmed_violations"
      ),
      targetWarnings:
        rowNumber(enforcementRow, "warnings") ||
        rowNumber(targetRow, "warnings"),
      targetRemovals: rowNumber(targetRow, "removals"),
      targetRestrictions: rowNumber(
        enforcementRow,
        "restrictions"
      ),
      targetSuspensions: rowNumber(
        enforcementRow,
        "suspensions"
      ),
      targetPermanentBans: rowNumber(
        enforcementRow,
        "permanent_bans"
      ),
      targetReportsLast7d: rowNumber(
        targetRow,
        "reports_last_7d"
      ),
      targetReportsLast30d: rowNumber(
        targetRow,
        "reports_last_30d"
      ),
      targetReportsLast90d: rowNumber(
        targetRow,
        "reports_last_90d"
      ),
      targetUniqueReportersLast24h: rowNumber(
        targetRow,
        "unique_reporters_last_24h"
      ),
      targetUniqueReportersLast7d: rowNumber(
        targetRow,
        "unique_reporters_last_7d"
      ),
      repeatedCategories: categoryRows
        .map((row) => safeText(row?.category))
        .filter(Boolean),
      evidenceMachineVerified: false,
      evidenceAttachmentCount: [
        Boolean(input.originalContentAvailable),
        Boolean(safeText(report?.targetThumbnailUri)),
        Boolean(safeText(report?.targetPreview)),
        Boolean(input.hasMediaUri),
      ].filter(Boolean).length,
    };

    const facts = {
      reportId: reportId || null,
      reporterLifetimeReports: raw.reporterLifetimeReports,
      reporterFinalizedReports:
        raw.reporterConfirmedReports + raw.reporterDismissedReports,
      reporterConfirmedReports: raw.reporterConfirmedReports,
      reporterDismissedReports: raw.reporterDismissedReports,
      targetTotalReports: raw.targetTotalReports,
      targetFinalizedReports:
        raw.targetConfirmedViolations + raw.targetDismissedReports,
      targetConfirmedViolations: raw.targetConfirmedViolations,
      uniqueReporters: raw.targetUniqueReporters,
      warningCount: raw.targetWarnings,
      removalCount: raw.targetRemovals,
      restrictionCount: raw.targetRestrictions,
      suspensionCount: raw.targetSuspensions,
      banCount: raw.targetPermanentBans,
      originalAvailable: raw.originalContentAvailable,
      snapshotAvailable: Boolean(
        raw.hasThumbnail || raw.hasPreview || raw.hasMediaUri
      ),
      evidenceAttachmentCount: raw.evidenceAttachmentCount ?? 0,
    };

    console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_FACTS", facts);

    const intelligence = computeSafetyCaseIntelligence(raw);

    console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_RESULT", {
      reportId: reportId || null,
      status: intelligence.status,
      credibilityScore: intelligence.reporter.credibilityScore,
      targetRiskScore: intelligence.target.riskScore,
      evidenceStrengthScore: intelligence.evidence.strengthScore,
      caseRiskScore: intelligence.assessment.caseRiskScore,
      confidence: intelligence.assessment.confidence,
      recommendation: intelligence.assessment.recommendation,
      dataQuality: intelligence.dataQuality,
    });

    console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_READY", {
      reportId: reportId || null,
      reporterUserId: reporterUserId || null,
      targetUserId: ownerUserId || null,
      stage: "db_function_success",
      status: intelligence.status,
      caseRiskScore: intelligence.assessment?.caseRiskScore ?? null,
      recommendation: intelligence.assessment?.recommendation ?? null,
    });

    return intelligence;
  } catch (error: any) {
    const message = safeText(
      error?.message || "case_intelligence_query_failed"
    );

    console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_FAILED", {
      reportId: reportId || null,
      reporterUserId: reporterUserId || null,
      targetUserId: ownerUserId || null,
      stage: "case_intelligence",
      error: message,
      stack: String(error?.stack || "") || null,
    });

    return {
      status: "error",
      analysisMode: "heuristic",
      generatedAt: new Date().toISOString(),
      dataQuality: {
        reporterHistoryAvailable: false,
        targetHistoryAvailable: false,
        evidenceVerified: false,
        finalizedReporterCases: 0,
        finalizedTargetCases: 0,
        limitations: [message || "case_intelligence_query_failed"],
      },
      reporter: {
        credibilityScore: null,
        credibilityLevel: "unknown",
        lifetimeReports: 0,
        confirmedReports: 0,
        dismissedReports: 0,
        accuracyPercent: null,
        abuseFlags: [],
      },
      target: {
        riskScore: null,
        totalReports: 0,
        uniqueReporters: 0,
        confirmedViolations: 0,
        warnings: 0,
        removals: 0,
        restrictions: 0,
        suspensions: 0,
        permanentBans: 0,
        repeatedCategories: [],
        trend: "insufficient_data",
        reportsLast7d: 0,
        reportsLast30d: 0,
        reportsLast90d: 0,
      },
      evidence: {
        strengthScore: null,
        originalAvailable: false,
        snapshotAvailable: false,
        signals: [],
        limitations: [message || "case_intelligence_query_failed"],
      },
      patterns: [],
      assessment: {
        caseRiskScore: null,
        signalLevel: "unknown",
        recommendation: "human_review",
        confidence: null,
        reasoning: [
          "Case Intelligence could not be generated due to a backend error.",
        ],
        aggravatingFactors: [],
        mitigatingFactors: ["analysis_unavailable"],
        requiresHumanReview: true,
      },
    };
  }
}

export type SafetyAccountEnforcementType =
  | "warning"
  | "restrict_account"
  | "suspend_account"
  | "permanent_ban";

export type SafetyAccountEnforcementRecord = {
  id: string;
  userId: string;
  reportId: string;
  enforcementType:
    SafetyAccountEnforcementType;
  reason: string;
  durationDays?: number;
  startsAt: string;
  expiresAt?: string;
  status:
    | "active"
    | "expired"
    | "revoked";
};

async function ensureSafetyAccountEnforcementSchema() {
  await ensureSafetyReportSchema();

  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS
      kristo_safety_account_enforcements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kristo_id TEXT,
        report_id TEXT NOT NULL,
        enforcement_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        duration_days INTEGER,
        starts_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'active',
        issued_by_user_id TEXT NOT NULL,
        issued_by_role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS
      kristo_safety_enforcement_user_status_idx
    ON kristo_safety_account_enforcements (
      user_id,
      status,
      created_at DESC
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS
      kristo_safety_enforcement_report_idx
    ON kristo_safety_account_enforcements (
      report_id,
      created_at DESC
    )
  `;

  /*
   * Keep only the newest active row per
   * restrictive enforcement type, then lock
   * uniqueness so concurrent bans cannot stack.
   */
  await sql`
    UPDATE kristo_safety_account_enforcements e
    SET
      status = 'revoked',
      updated_at = NOW()
    WHERE e.status = 'active'
      AND e.enforcement_type IN (
        'permanent_ban',
        'suspend_account',
        'restrict_account'
      )
      AND EXISTS (
        SELECT 1
        FROM kristo_safety_account_enforcements newer
        WHERE newer.user_id = e.user_id
          AND newer.enforcement_type =
            e.enforcement_type
          AND newer.status = 'active'
          AND newer.created_at > e.created_at
      )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS
      kristo_safety_enforcement_one_active_ban_idx
    ON kristo_safety_account_enforcements (
      user_id
    )
    WHERE
      status = 'active'
      AND enforcement_type =
        'permanent_ban'
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS
      kristo_safety_enforcement_one_active_suspend_idx
    ON kristo_safety_account_enforcements (
      user_id
    )
    WHERE
      status = 'active'
      AND enforcement_type =
        'suspend_account'
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS
      kristo_safety_enforcement_one_active_restrict_idx
    ON kristo_safety_account_enforcements (
      user_id
    )
    WHERE
      status = 'active'
      AND enforcement_type =
        'restrict_account'
  `;
}

function createSafetyEnforcementId() {
  return (
    `senf_${Date.now().toString(36)}_` +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

export async function dbApplySafetyAccountEnforcement(
  input: {
    userId: string;
    kristoId?: string;
    reportId: string;
    enforcementType:
      SafetyAccountEnforcementType;
    reason: string;
    durationDays?: number;
    issuedByUserId: string;
    issuedByRole:
      SafetyDecisionActorRole;
  }
): Promise<SafetyAccountEnforcementRecord> {
  await ensureSafetyAccountEnforcementSchema();

  const sql = getSql();

  const userId =
    String(input.userId || "").trim();

  const kristoId =
    String(input.kristoId || "")
      .trim()
      .toUpperCase();

  const reportId =
    String(input.reportId || "").trim();

  const enforcementType =
    String(input.enforcementType || "")
      .trim()
      .toLowerCase() as
      SafetyAccountEnforcementType;

  const reason =
    String(input.reason || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

  const issuedByUserId =
    String(
      input.issuedByUserId || ""
    ).trim();

  const issuedByRole =
    normalizeDecisionActorRole(
      input.issuedByRole
    );

  const validType =
    enforcementType === "warning" ||
    enforcementType === "restrict_account" ||
    enforcementType === "suspend_account" ||
    enforcementType === "permanent_ban";

  if (
    !userId ||
    !reportId ||
    !validType ||
    reason.length < 8 ||
    !issuedByUserId ||
    !issuedByRole
  ) {
    throw new Error(
      "Complete enforcement information is required."
    );
  }

  const durationDays =
    enforcementType === "warning" ||
    enforcementType === "permanent_ban"
      ? null
      : Math.max(
          1,
          Math.min(
            3650,
            Math.round(
              Number(
                input.durationDays || 1
              )
            )
          )
        );

  const startsAt =
    new Date();

  const expiresAt =
    durationDays
      ? new Date(
          startsAt.getTime() +
            durationDays *
              24 *
              60 *
              60 *
              1000
        )
      : null;

  await sql`
    UPDATE
      kristo_safety_account_enforcements
    SET
      status = 'expired',
      updated_at = NOW()
    WHERE
      user_id = ${userId}
      AND status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
  `;

  if (
    enforcementType ===
      "permanent_ban"
  ) {
    await sql`
      UPDATE
        kristo_safety_account_enforcements
      SET
        status = 'revoked',
        updated_at = NOW()
      WHERE
        user_id = ${userId}
        AND status = 'active'
        AND enforcement_type IN (
          'restrict_account',
          'suspend_account',
          'warning'
        )
    `;
  } else if (
    enforcementType ===
      "suspend_account" ||
    enforcementType ===
      "restrict_account"
  ) {
    await sql`
      UPDATE
        kristo_safety_account_enforcements
      SET
        status = 'revoked',
        updated_at = NOW()
      WHERE
        user_id = ${userId}
        AND status = 'active'
        AND enforcement_type IN (
          'restrict_account',
          'suspend_account'
        )
    `;
  }

  const id =
    createSafetyEnforcementId();

  await sql`
    INSERT INTO
      kristo_safety_account_enforcements (
        id,
        user_id,
        kristo_id,
        report_id,
        enforcement_type,
        reason,
        duration_days,
        starts_at,
        expires_at,
        status,
        issued_by_user_id,
        issued_by_role,
        created_at,
        updated_at
      )
    VALUES (
      ${id},
      ${userId},
      ${kristoId || null},
      ${reportId},
      ${enforcementType},
      ${reason},
      ${durationDays},
      ${startsAt.toISOString()},
      ${
        expiresAt
          ? expiresAt.toISOString()
          : null
      },
      'active',
      ${issuedByUserId},
      ${issuedByRole},
      NOW(),
      NOW()
    )
  `;

  return {
    id,
    userId,
    reportId,
    enforcementType,
    reason,
    durationDays:
      durationDays || undefined,
    startsAt:
      startsAt.toISOString(),
    expiresAt:
      expiresAt
        ? expiresAt.toISOString()
        : undefined,
    status: "active",
  };
}

export async function dbGetActiveSafetyAccountEnforcement(
  userIdInput: string
): Promise<{
  permanentBan?:
    SafetyAccountEnforcementRecord;
  suspension?:
    SafetyAccountEnforcementRecord;
  restriction?:
    SafetyAccountEnforcementRecord;
  warningCount: number;
}> {
  await ensureSafetyAccountEnforcementSchema();

  const sql = getSql();

  const userId =
    String(userIdInput || "").trim();

  if (!userId) {
    return {
      warningCount: 0,
    };
  }

  await sql`
    UPDATE
      kristo_safety_account_enforcements
    SET
      status = 'expired',
      updated_at = NOW()
    WHERE
      user_id = ${userId}
      AND status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
  `;

  type Row = {
    id: string;
    user_id: string;
    report_id: string;
    enforcement_type: string;
    reason: string;
    duration_days:
      | number
      | string
      | null;
    starts_at:
      | string
      | Date;
    expires_at:
      | string
      | Date
      | null;
    status: string;
  };

  const rows = (await sql`
    SELECT
      id,
      user_id,
      report_id,
      enforcement_type,
      reason,
      duration_days,
      starts_at,
      expires_at,
      status
    FROM
      kristo_safety_account_enforcements
    WHERE
      user_id = ${userId}
      AND status = 'active'
    ORDER BY
      created_at DESC
  `) as Row[];

  const mapped =
    rows.map(
      (
        row
      ): SafetyAccountEnforcementRecord => ({
        id: row.id,
        userId:
          row.user_id,
        reportId:
          row.report_id,
        enforcementType:
          row.enforcement_type as
            SafetyAccountEnforcementType,
        reason:
          row.reason,
        durationDays:
          row.duration_days === null
            ? undefined
            : Number(
                row.duration_days
              ),
        startsAt:
          new Date(
            row.starts_at
          ).toISOString(),
        expiresAt:
          row.expires_at
            ? new Date(
                row.expires_at
              ).toISOString()
            : undefined,
        status:
          row.status as
            | "active"
            | "expired"
            | "revoked",
      })
    );

  return {
    permanentBan:
      mapped.find(
        (row) =>
          row.enforcementType ===
          "permanent_ban"
      ),

    suspension:
      mapped.find(
        (row) =>
          row.enforcementType ===
          "suspend_account"
      ),

    restriction:
      mapped.find(
        (row) =>
          row.enforcementType ===
          "restrict_account"
      ),

    warningCount:
      mapped.filter(
        (row) =>
          row.enforcementType ===
          "warning"
      ).length,
  };
}

export const SAFETY_RECON_KIND_REMOVE_CONTENT =
  "remove_content_decision" as const;

export async function dbMarkSafetyReportEnforcementPending(
  reportIdInput: string
): Promise<void> {
  await ensureSafetyReportSchema();

  const sql = getSql();
  const reportId =
    String(reportIdInput || "").trim();

  if (!reportId) return;

  await sql`
    UPDATE kristo_safety_reports
    SET
      status = 'enforcement_pending',
      updated_at = NOW()
    WHERE id = ${reportId}
      AND status NOT IN (
        'resolved',
        'dismissed',
        'recovery_required'
      )
  `;
}

export type SafetyReconciliationRecord = {
  id: string;
  reportId: string;
  kind: string;
  status: "pending" | "completed" | "failed";
  targetPostId?: string;
  actorUserId: string;
  actorRole: SafetyDecisionActorRole;
  decisionType: SafetyReportDecisionType;
  reason: string;
  notes?: string;
  confidence?: number;
  contentDeletedAt?: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

function createSafetyReconciliationId() {
  return (
    `srec_${Date.now().toString(36)}_` +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Durable reconciliation after content deletion succeeded
 * but the Safety decision write failed. Idempotent upsert
 * on (report_id, kind). Never deletes content.
 */
export async function dbRecordRemoveContentReconciliation(
  input: {
    reportId: string;
    targetPostId: string;
    actorUserId: string;
    actorRole: SafetyDecisionActorRole;
    reason: string;
    notes?: string;
    confidence?: number;
    contentDeletedAt?: string;
    errorMessage?: string;
  }
): Promise<SafetyReconciliationRecord> {
  await ensureSafetyReportSchema();

  const sql = getSql();

  const reportId =
    String(input.reportId || "").trim();
  const targetPostId =
    String(input.targetPostId || "").trim();
  const actorUserId =
    String(input.actorUserId || "").trim();
  const actorRole =
    normalizeDecisionActorRole(
      input.actorRole
    );
  const reason =
    String(input.reason || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  const notes =
    String(input.notes || "")
      .trim()
      .slice(0, 12000);
  const confidence =
    input.confidence === undefined ||
    input.confidence === null ||
    !Number.isFinite(Number(input.confidence))
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(Number(input.confidence))
          )
        );
  const contentDeletedAt =
    input.contentDeletedAt || nowIso();
  const errorMessage =
    String(input.errorMessage || "")
      .trim()
      .slice(0, 2000);

  if (
    !reportId ||
    !targetPostId ||
    !actorUserId ||
    !actorRole ||
    reason.length < 8
  ) {
    throw new Error(
      "Complete remove-content reconciliation information is required."
    );
  }

  const id = createSafetyReconciliationId();
  const kind = SAFETY_RECON_KIND_REMOVE_CONTENT;

  /*
   * 1) Mark report recovery_required (only if not already final).
   * 2) Upsert durable reconciliation row.
   * 3) Append audit event when newly pending.
   */
  await sql`
    UPDATE kristo_safety_reports
    SET
      status = 'recovery_required',
      updated_at = NOW()
    WHERE id = ${reportId}
      AND status NOT IN (
        'resolved',
        'dismissed'
      )
  `;

  const rows = (await sql`
    INSERT INTO kristo_safety_reconciliations (
      id,
      report_id,
      kind,
      status,
      target_post_id,
      actor_user_id,
      actor_role,
      decision_type,
      reason,
      notes,
      confidence,
      content_deleted_at,
      attempts,
      last_error,
      metadata_json,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${reportId},
      ${kind},
      'pending',
      ${targetPostId},
      ${actorUserId},
      ${actorRole},
      'remove_content',
      ${reason},
      ${notes || null},
      ${confidence},
      ${contentDeletedAt},
      0,
      ${errorMessage || null},
      ${JSON.stringify({
        phase: "content_deleted_decision_pending",
        contentDeleted: true,
      })},
      NOW(),
      NOW()
    )
    ON CONFLICT (report_id, kind)
    DO UPDATE SET
      status = CASE
        WHEN kristo_safety_reconciliations.status =
          'completed'
        THEN kristo_safety_reconciliations.status
        ELSE 'pending'
      END,
      target_post_id = EXCLUDED.target_post_id,
      actor_user_id = EXCLUDED.actor_user_id,
      actor_role = EXCLUDED.actor_role,
      reason = EXCLUDED.reason,
      notes = EXCLUDED.notes,
      confidence = EXCLUDED.confidence,
      content_deleted_at = COALESCE(
        kristo_safety_reconciliations.content_deleted_at,
        EXCLUDED.content_deleted_at
      ),
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
    RETURNING
      id,
      report_id,
      kind,
      status,
      target_post_id,
      actor_user_id,
      actor_role,
      decision_type,
      reason,
      notes,
      confidence,
      content_deleted_at,
      attempts,
      last_error,
      created_at,
      updated_at,
      completed_at
  `) as Array<{
    id: string;
    report_id: string;
    kind: string;
    status: string;
    target_post_id: string | null;
    actor_user_id: string;
    actor_role: string;
    decision_type: string;
    reason: string;
    notes: string | null;
    confidence: number | string | null;
    content_deleted_at: string | Date | null;
    attempts: number | string;
    last_error: string | null;
    created_at: string | Date;
    updated_at: string | Date;
    completed_at: string | Date | null;
  }>;

  const row = rows[0];

  if (!row) {
    throw new Error(
      "Could not persist Safety reconciliation record."
    );
  }

  if (row.status !== "completed") {
    await sql`
      INSERT INTO kristo_safety_report_events (
        id,
        report_id,
        event_type,
        actor_user_id,
        actor_role,
        title,
        details,
        metadata_json,
        created_at
      )
      VALUES (
        ${createSafetyReportEventId()},
        ${reportId},
        'reconciliation_required',
        ${actorUserId},
        ${actorRole},
        'Content removed — decision recovery required',
        ${reason},
        ${JSON.stringify({
          reconciliationId: row.id,
          targetPostId,
          contentDeletedAt,
          errorMessage: errorMessage || null,
        })},
        NOW()
      )
    `;
  }

  console.log(
    JSON.stringify({
      scope: "kristo_safety",
      event: "reconciliation_recorded",
      reportId,
      reconciliationId: row.id,
      targetPostId,
      status: row.status,
      at: new Date().toISOString(),
    })
  );

  return {
    id: row.id,
    reportId: row.report_id,
    kind: row.kind,
    status: row.status as
      | "pending"
      | "completed"
      | "failed",
    targetPostId:
      row.target_post_id || undefined,
    actorUserId: row.actor_user_id,
    actorRole:
      normalizeDecisionActorRole(
        row.actor_role
      )!,
    decisionType:
      normalizeDecisionType(
        row.decision_type
      ) || "remove_content",
    reason: row.reason,
    notes: row.notes || undefined,
    confidence:
      row.confidence === null
        ? undefined
        : Number(row.confidence),
    contentDeletedAt: row.content_deleted_at
      ? new Date(
          row.content_deleted_at
        ).toISOString()
      : undefined,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || undefined,
    createdAt: new Date(
      row.created_at
    ).toISOString(),
    updatedAt: new Date(
      row.updated_at
    ).toISOString(),
    completedAt: row.completed_at
      ? new Date(
          row.completed_at
        ).toISOString()
      : undefined,
  };
}

/**
 * Retry-safe recovery: completes the missing remove_content
 * decision without deleting content again. Fully idempotent.
 */
export async function dbRecoverRemoveContentDecision(
  reportIdInput: string
): Promise<{
  recovered: boolean;
  alreadyComplete: boolean;
  report?: SafetyReportRecord;
  reconciliation?: SafetyReconciliationRecord;
}> {
  await ensureSafetyReportSchema();

  const sql = getSql();
  const reportId =
    String(reportIdInput || "").trim();

  if (!reportId) {
    throw new Error(
      "Safety report ID is required for recovery."
    );
  }

  const reconRows = (await sql`
    SELECT
      id,
      report_id,
      kind,
      status,
      target_post_id,
      actor_user_id,
      actor_role,
      decision_type,
      reason,
      notes,
      confidence,
      content_deleted_at,
      attempts,
      last_error,
      created_at,
      updated_at,
      completed_at
    FROM kristo_safety_reconciliations
    WHERE report_id = ${reportId}
      AND kind = ${SAFETY_RECON_KIND_REMOVE_CONTENT}
    LIMIT 1
  `) as Array<{
    id: string;
    report_id: string;
    kind: string;
    status: string;
    target_post_id: string | null;
    actor_user_id: string;
    actor_role: string;
    decision_type: string;
    reason: string;
    notes: string | null;
    confidence: number | string | null;
    content_deleted_at: string | Date | null;
    attempts: number | string;
    last_error: string | null;
    created_at: string | Date;
    updated_at: string | Date;
    completed_at: string | Date | null;
  }>;

  const recon = reconRows[0];

  const reportRows = (await sql`
    SELECT
      id,
      status,
      decision_type,
      assigned_supervisor_user_id,
      assigned_agent_user_id
    FROM kristo_safety_reports
    WHERE id = ${reportId}
    LIMIT 1
  `) as Array<{
    id: string;
    status: string;
    decision_type: string | null;
    assigned_supervisor_user_id: string | null;
    assigned_agent_user_id: string | null;
  }>;

  const existing = reportRows[0];

  if (!existing) {
    throw new Error(
      "Safety report was not found for recovery."
    );
  }

  if (
    existing.status === "resolved" &&
    existing.decision_type === "remove_content"
  ) {
    if (recon && recon.status !== "completed") {
      await sql`
        UPDATE kristo_safety_reconciliations
        SET
          status = 'completed',
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW(),
          last_error = NULL
        WHERE id = ${recon.id}
      `;
    }

    return {
      recovered: false,
      alreadyComplete: true,
    };
  }

  if (!recon) {
    throw new Error(
      "No remove-content reconciliation record exists for this report."
    );
  }

  if (recon.status === "completed") {
    return {
      recovered: false,
      alreadyComplete: true,
    };
  }

  await sql`
    UPDATE kristo_safety_reconciliations
    SET
      attempts = attempts + 1,
      status = 'pending',
      updated_at = NOW()
    WHERE id = ${recon.id}
  `;

  try {
    /*
     * Temporarily move out of recovery_required so the
     * atomic decision claim can succeed, then issue the
     * durable remove_content decision. Content is NOT deleted.
     */
    await sql`
      UPDATE kristo_safety_reports
      SET
        status = CASE
          WHEN assigned_agent_user_id IS NOT NULL
            OR assigned_supervisor_user_id IS NOT NULL
          THEN 'assigned'
          ELSE 'open'
        END,
        updated_at = NOW()
      WHERE id = ${reportId}
        AND status IN (
          'recovery_required',
          'enforcement_pending'
        )
    `;

    const result =
      await dbIssueSafetyReportDecision({
        reportId,
        actorUserId: recon.actor_user_id,
        actorRole:
          normalizeDecisionActorRole(
            recon.actor_role
          )!,
        decisionType: "remove_content",
        reason: recon.reason,
        notes: recon.notes || undefined,
        confidence:
          recon.confidence === null
            ? undefined
            : Number(recon.confidence),
      });

    await sql`
      UPDATE kristo_safety_reconciliations
      SET
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW(),
        last_error = NULL
      WHERE id = ${recon.id}
    `;

    console.log(
      JSON.stringify({
        scope: "kristo_safety",
        event: "reconciliation_recovered",
        reportId,
        reconciliationId: recon.id,
        decisionType: "remove_content",
        at: new Date().toISOString(),
      })
    );

    return {
      recovered: true,
      alreadyComplete: false,
      report: result.report,
    };
  } catch (error: any) {
    const message = String(
      error?.message || error || "Recovery failed."
    );

    /*
     * If another worker already finalized the decision,
     * treat as successful idempotent completion.
     */
    if (
      message.includes(
        "already has a final decision"
      )
    ) {
      const finalized = (await sql`
        SELECT decision_type, status
        FROM kristo_safety_reports
        WHERE id = ${reportId}
        LIMIT 1
      `) as Array<{
        decision_type: string | null;
        status: string;
      }>;

      if (
        finalized[0]?.status === "resolved" &&
        finalized[0]?.decision_type ===
          "remove_content"
      ) {
        await sql`
          UPDATE kristo_safety_reconciliations
          SET
            status = 'completed',
            completed_at = COALESCE(completed_at, NOW()),
            updated_at = NOW(),
            last_error = NULL
          WHERE id = ${recon.id}
        `;

        return {
          recovered: false,
          alreadyComplete: true,
        };
      }
    }

    await sql`
      UPDATE kristo_safety_reconciliations
      SET
        status = 'failed',
        last_error = ${message.slice(0, 2000)},
        updated_at = NOW()
      WHERE id = ${recon.id}
    `;

    await sql`
      UPDATE kristo_safety_reports
      SET
        status = 'recovery_required',
        updated_at = NOW()
      WHERE id = ${reportId}
        AND status NOT IN (
          'resolved',
          'dismissed'
        )
    `;

    throw error;
  }
}

/**
 * Process pending/failed remove-content reconciliations.
 * Safe to run repeatedly (cron / ops job).
 */
export async function dbProcessPendingRemoveContentReconciliations(
  limitInput = 20
): Promise<{
  processed: number;
  recovered: number;
  alreadyComplete: number;
  failed: number;
}> {
  await ensureSafetyReportSchema();

  const sql = getSql();
  const limit = Math.max(
    1,
    Math.min(
      100,
      Math.round(Number(limitInput) || 20)
    )
  );

  const pending = (await sql`
    SELECT report_id
    FROM kristo_safety_reconciliations
    WHERE kind = ${SAFETY_RECON_KIND_REMOVE_CONTENT}
      AND status IN ('pending', 'failed')
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `) as Array<{ report_id: string }>;

  let recovered = 0;
  let alreadyComplete = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const result =
        await dbRecoverRemoveContentDecision(
          row.report_id
        );

      if (result.alreadyComplete) {
        alreadyComplete += 1;
      } else if (result.recovered) {
        recovered += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    processed: pending.length,
    recovered,
    alreadyComplete,
    failed,
  };
}

