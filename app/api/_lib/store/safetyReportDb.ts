import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
  hasDurableStore,
  isVercelRuntime,
} from "@/app/api/_lib/store/authDb";

neonConfig.fetchConnectionCache = true;

export type SafetyReportStatus =
  | "open"
  | "assigned"
  | "in_review"
  | "resolved"
  | "escalated"
  | "dismissed";

export type SafetyReportPriority =
  | "low"
  | "normal"
  | "high"
  | "critical";

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

  createdAt: string;
  updatedAt: string;
  assignedAt?: string;
  resolvedAt?: string;
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
    status === "dismissed"
  ) {
    return status;
  }

  return "open";
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
                'dismissed'
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

      try {
        const autoAssignment =
          await dbAutoAssignNewSafetyReport(
            createdReport.id
          );

        if (
          autoAssignment.assigned &&
          autoAssignment.supervisorUserId
        ) {
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

  return rowToReport(rows[0]);
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

  const agents = agentRows.map((agent) => {
    const assigned =
      reportRecords.filter(
        (report) =>
          report.assignedAgentUserId ===
          agent.agent_user_id
      );

    return {
      userId:
        String(agent.agent_user_id || "")
          .trim(),

      kristoId:
        String(
          agent.agent_kristo_id || ""
        )
          .trim()
          .toUpperCase() || undefined,

      churchId:
        String(agent.church_id || "")
          .trim(),

      status:
        (
          agent.status === "pending" ||
          agent.status === "paused"
            ? agent.status
            : "active"
        ) as "active" | "pending" | "paused",

      open:
        assigned.filter(
          (report) =>
            report.status === "open" ||
            report.status === "assigned"
        ).length,

      inReview:
        assigned.filter(
          (report) =>
            report.status === "in_review"
        ).length,

      resolved:
        assigned.filter(
          (report) =>
            report.status === "resolved"
        ).length,

      totalAssigned:
        assigned.length,
    };
  });

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
