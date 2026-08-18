import {
  neon,
  neonConfig,
} from "@neondatabase/serverless";

import {
  getDatabaseUrl,
} from "@/app/api/_lib/store/authDb";

import type {
  SafetyDecisionActorRole,
} from "@/app/api/_lib/store/safetyReportDb";

neonConfig.fetchConnectionCache = true;

export type SokoSafetyDecisionType =
  | "contact_seller"
  | "warn_seller"
  | "remove_product"
  | "pause_seller"
  | "suspend_seller"
  | "ban_seller";

export type SokoSellerAccessStatus =
  | "active"
  | "paused"
  | "suspended"
  | "banned";

let sqlClient:
  | ReturnType<typeof neon>
  | null = null;

let schemaReady:
  | Promise<void>
  | null = null;

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

function actionId() {
  return (
    `soko_act_${Date.now().toString(36)}_` +
    Math.random().toString(36).slice(2, 10)
  );
}

function eventId() {
  return (
    `sevt_${Date.now().toString(36)}_` +
    Math.random().toString(36).slice(2, 10)
  );
}

function cleanText(
  value: unknown,
  limit: number
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeDecision(
  value: unknown
): SokoSafetyDecisionType | undefined {
  const decision = cleanText(
    value,
    80
  ).toLowerCase();

  if (
    decision === "contact_seller" ||
    decision === "warn_seller" ||
    decision === "remove_product" ||
    decision === "pause_seller" ||
    decision === "suspend_seller" ||
    decision === "ban_seller"
  ) {
    return decision;
  }

  return undefined;
}

export async function ensureSokoSafetySchema() {
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const sql = getSql();

    await sql`
      CREATE TABLE IF NOT EXISTS soko_safety_actions (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        product_id TEXT,
        seller_user_id TEXT,
        seller_kristo_id TEXT,
        reason TEXT NOT NULL,
        notes TEXT,
        duration_days INTEGER,
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'applied',
        issued_by_user_id TEXT NOT NULL,
        issued_by_role TEXT NOT NULL,
        seller_response TEXT,
        seller_responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS
        soko_safety_action_report_type_uidx
      ON soko_safety_actions (
        report_id,
        action_type
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS
        soko_safety_action_product_status_idx
      ON soko_safety_actions (
        product_id,
        action_type,
        status,
        expires_at
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS
        soko_safety_action_seller_status_idx
      ON soko_safety_actions (
        seller_user_id,
        action_type,
        status,
        expires_at
      )
    `;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

type SokoDecisionReportRow = {
  id: string;
  report_code: string;
  status: string;
  source_type: string;
  source_id: string | null;
  target_id: string | null;
  target_owner_user_id: string | null;
  target_owner_kristo_id: string | null;
  reported_user_id: string | null;
  reported_kristo_id: string | null;
  assigned_supervisor_user_id: string | null;
  assigned_agent_user_id: string | null;
};

export async function dbIssueSokoSafetyDecision(
  input: {
    reportId: string;
    actorUserId: string;
    actorRole: SafetyDecisionActorRole;
    decisionType: unknown;
    reason: unknown;
    notes?: unknown;
    confidence?: unknown;
    durationDays?: unknown;
  }
) {
  const reportId = cleanText(
    input.reportId,
    240
  );

  const actorUserId = cleanText(
    input.actorUserId,
    240
  );

  const actorRole = cleanText(
    input.actorRole,
    40
  ) as SafetyDecisionActorRole;

  const decisionType =
    normalizeDecision(
      input.decisionType
    );

  const reason = cleanText(
    input.reason,
    4000
  );

  const notes = cleanText(
    input.notes,
    12000
  );

  const confidenceValue =
    Number(input.confidence);

  const confidence =
    input.confidence === undefined ||
    input.confidence === null ||
    !Number.isFinite(confidenceValue)
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(confidenceValue)
          )
        );

  const durationValue =
    Number(input.durationDays);

  const durationDays =
    input.durationDays === undefined ||
    input.durationDays === null ||
    !Number.isFinite(durationValue)
      ? null
      : Math.max(
          1,
          Math.min(
            3650,
            Math.round(durationValue)
          )
        );

  if (
    !reportId ||
    !actorUserId ||
    !decisionType
  ) {
    throw new Error(
      "Complete SOKO decision information is required."
    );
  }

  if (reason.length < 8) {
    throw new Error(
      "Decision reason must contain at least 8 characters."
    );
  }

  if (
    (
      decisionType === "pause_seller" ||
      decisionType === "suspend_seller"
    ) &&
    !durationDays
  ) {
    throw new Error(
      "Choose how many days the seller action should remain active."
    );
  }

  if (
    actorRole === "agent" &&
    decisionType === "ban_seller"
  ) {
    throw new Error(
      "SOKO seller bans require Supervisor approval."
    );
  }

  await ensureSokoSafetySchema();

  const sql = getSql();

  const reportRows = (await sql`
    SELECT
      id,
      report_code,
      status,
      source_type,
      source_id,
      target_id,
      target_owner_user_id,
      target_owner_kristo_id,
      reported_user_id,
      reported_kristo_id,
      assigned_supervisor_user_id,
      assigned_agent_user_id
    FROM kristo_safety_reports
    WHERE id = ${reportId}::text
    LIMIT 1
  `) as SokoDecisionReportRow[];

  const report = reportRows[0];

  if (!report) {
    throw new Error(
      "Safety report was not found."
    );
  }

  if (
    String(report.source_type || "")
      .trim()
      .toLowerCase() !==
      "soko_marketplace"
  ) {
    throw new Error(
      "SOKO decisions can only be applied to SOKO marketplace reports."
    );
  }

  if (
    report.status === "resolved" ||
    report.status === "dismissed"
  ) {
    throw new Error(
      "This case already has a final decision."
    );
  }

  const assignedUserId =
    actorRole === "agent"
      ? report.assigned_agent_user_id
      : report.assigned_supervisor_user_id;

  if (
    cleanText(assignedUserId, 240) !==
    actorUserId
  ) {
    throw new Error(
      "This SOKO case is not assigned to your Safety account."
    );
  }

  if (
    report.status === "escalated" &&
    actorRole === "agent"
  ) {
    throw new Error(
      "SAFETY_ESCALATED_AWAITING_SUPERVISOR: This escalated case awaits Supervisor review."
    );
  }

  const productId = cleanText(
    report.target_id ||
      report.source_id,
    300
  );

  const sellerUserId = cleanText(
    report.target_owner_user_id ||
      report.reported_user_id,
    240
  );

  const sellerKristoId = cleanText(
    report.target_owner_kristo_id ||
      report.reported_kristo_id,
    100
  ).toUpperCase();

  if (
    decisionType === "remove_product" &&
    !productId
  ) {
    throw new Error(
      "The reported SOKO product could not be resolved."
    );
  }

  if (
    decisionType !== "remove_product" &&
    !sellerUserId
  ) {
    throw new Error(
      "The reported SOKO seller could not be resolved."
    );
  }

  const now = new Date();

  const expiresAt =
    durationDays &&
    (
      decisionType === "pause_seller" ||
      decisionType === "suspend_seller"
    )
      ? new Date(
          now.getTime() +
            durationDays *
              24 *
              60 *
              60 *
              1000
        )
      : null;

  const finalStatus =
    decisionType === "contact_seller"
      ? "in_review"
      : "resolved";

  const actionStatus =
    decisionType === "contact_seller"
      ? "awaiting_seller_response"
      : "applied";

  const titleByDecision:
    Record<SokoSafetyDecisionType, string> = {
      contact_seller:
        "Seller response requested",
      warn_seller:
        "SOKO seller warned",
      remove_product:
        "SOKO product removed",
      pause_seller:
        "SOKO seller paused",
      suspend_seller:
        "SOKO seller suspended",
      ban_seller:
        "SOKO seller banned",
    };

  const newActionId = actionId();
  const newEventId = eventId();

  const updatedRows = (await sql`
    WITH inserted_action AS (
      INSERT INTO soko_safety_actions (
        id,
        report_id,
        action_type,
        product_id,
        seller_user_id,
        seller_kristo_id,
        reason,
        notes,
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
        ${newActionId}::text,
        ${reportId}::text,
        ${decisionType}::text,
        ${productId || null}::text,
        ${sellerUserId || null}::text,
        ${sellerKristoId || null}::text,
        ${reason}::text,
        ${notes || null}::text,
        ${durationDays}::integer,
        ${now.toISOString()}::timestamptz,
        ${expiresAt
          ? expiresAt.toISOString()
          : null}::timestamptz,
        ${actionStatus}::text,
        ${actorUserId}::text,
        ${actorRole}::text,
        NOW(),
        NOW()
      )
      ON CONFLICT (
        report_id,
        action_type
      ) DO NOTHING
      RETURNING id
    ),
    updated_report AS (
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
        decision_at = ${now.toISOString()}::timestamptz,
        resolved_at =
          CASE
            WHEN ${finalStatus}::text = 'resolved'
            THEN ${now.toISOString()}::timestamptz
            ELSE NULL::timestamptz
          END,
        updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${reportId}::text
        AND status NOT IN (
          'resolved',
          'dismissed'
        )
        AND EXISTS (
          SELECT 1
          FROM inserted_action
        )
      RETURNING id
    ),
    inserted_event AS (
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
        ${newEventId}::text,
        ${reportId}::text,
        'soko_action_issued'::text,
        ${actorUserId}::text,
        ${actorRole}::text,
        ${titleByDecision[decisionType]}::text,
        ${reason}::text,
        ${JSON.stringify({
          decisionType,
          productId: productId || null,
          sellerUserId: sellerUserId || null,
          durationDays,
          expiresAt:
            expiresAt?.toISOString() || null,
          sourceBoundary: "soko",
        })}::text,
        ${now.toISOString()}::timestamptz
      FROM updated_report
      RETURNING id
    )
    SELECT id
    FROM updated_report
  `) as Array<{ id: string }>;

  if (!updatedRows[0]) {
    const existingAction = (await sql`
      SELECT id
      FROM soko_safety_actions
      WHERE report_id = ${reportId}::text
        AND action_type = ${decisionType}::text
      LIMIT 1
    `) as Array<{ id: string }>;

    if (existingAction[0]) {
      throw new Error(
        "This SOKO action has already been recorded."
      );
    }

    throw new Error(
      "The SOKO decision could not be recorded."
    );
  }

  const messageByDecision:
    Record<SokoSafetyDecisionType, string> = {
      contact_seller:
        "The seller has been asked to respond. The case remains in review.",
      warn_seller:
        "A formal warning was recorded against this SOKO seller.",
      remove_product:
        "The reported product is now hidden from SOKO marketplace results.",
      pause_seller:
        "The seller is temporarily paused from SOKO marketplace activity.",
      suspend_seller:
        "The seller is suspended from SOKO marketplace activity.",
      ban_seller:
        "The seller is permanently banned from SOKO. Their Kristo account was not changed.",
    };

  console.log(
    "KRISTO_SOKO_ENFORCEMENT_APPLIED",
    {
      reportId,
      actionId: newActionId,
      decisionType,
      productId: productId || null,
      sellerUserId:
        sellerUserId || null,
      finalStatus,
    }
  );

  return {
    actionId: newActionId,
    decisionType,
    status: finalStatus,
    expiresAt:
      expiresAt?.toISOString(),
    message:
      messageByDecision[decisionType],
  };
}

export async function dbGetSokoEnforcementStatus(
  input: {
    productIds?: unknown[];
    sellerUserIds?: unknown[];
  }
) {
  await ensureSokoSafetySchema();

  const productIds = Array.from(
    new Set(
      (input.productIds || [])
        .map((value) =>
          cleanText(value, 300)
        )
        .filter(Boolean)
        .slice(0, 200)
    )
  );

  const sellerUserIds = Array.from(
    new Set(
      (input.sellerUserIds || [])
        .map((value) =>
          cleanText(value, 240)
        )
        .filter(Boolean)
        .slice(0, 200)
    )
  );

  const sql = getSql();

  const rows = (await sql`
    SELECT
      product_id,
      seller_user_id,
      action_type,
      expires_at,
      created_at
    FROM soko_safety_actions
    WHERE status = 'applied'
      AND (
        expires_at IS NULL OR
        expires_at > NOW()
      )
      AND (
        (
          product_id IS NOT NULL AND
          product_id IN (
            SELECT jsonb_array_elements_text(
              ${JSON.stringify(productIds)}::jsonb
            )
          )
        )
        OR
        (
          seller_user_id IS NOT NULL AND
          seller_user_id IN (
            SELECT jsonb_array_elements_text(
              ${JSON.stringify(sellerUserIds)}::jsonb
            )
          )
        )
      )
    ORDER BY created_at DESC
  `) as Array<{
    product_id: string | null;
    seller_user_id: string | null;
    action_type: string;
    expires_at: string | Date | null;
    created_at: string | Date;
  }>;

  const hiddenProductIds =
    new Set<string>();

  const sellerStatus:
    Record<string, SokoSellerAccessStatus> = {};

  const rank:
    Record<SokoSellerAccessStatus, number> = {
      active: 0,
      paused: 1,
      suspended: 2,
      banned: 3,
    };

  for (const row of rows) {
    if (
      row.action_type ===
        "remove_product" &&
      row.product_id
    ) {
      hiddenProductIds.add(
        row.product_id
      );
    }

    const nextStatus:
      | SokoSellerAccessStatus
      | null =
      row.action_type === "ban_seller"
        ? "banned"
        : row.action_type ===
            "suspend_seller"
          ? "suspended"
          : row.action_type ===
              "pause_seller"
            ? "paused"
            : null;

    if (
      nextStatus &&
      row.seller_user_id
    ) {
      const current =
        sellerStatus[
          row.seller_user_id
        ] || "active";

      if (
        rank[nextStatus] >
        rank[current]
      ) {
        sellerStatus[
          row.seller_user_id
        ] = nextStatus;
      }
    }
  }

  return {
    hiddenProductIds:
      Array.from(hiddenProductIds),
    sellerStatus,
  };
}

export async function dbGetSokoSellerNotices(
  sellerUserId: string
) {
  const normalizedSellerUserId =
    cleanText(sellerUserId, 240);

  if (!normalizedSellerUserId) {
    return [];
  }

  await ensureSokoSafetySchema();

  const sql = getSql();

  const rows = (await sql`
    SELECT
      a.id,
      a.report_id,
      r.report_code,
      r.target_title,
      a.action_type,
      a.reason,
      a.status,
      a.seller_response,
      a.created_at,
      a.seller_responded_at
    FROM soko_safety_actions a
    JOIN kristo_safety_reports r
      ON r.id = a.report_id
    WHERE a.seller_user_id =
      ${normalizedSellerUserId}::text
      AND a.action_type =
        ANY(ARRAY[
          'contact_seller',
          'warn_seller',
          'remove_product',
          'pause_seller',
          'suspend_seller',
          'ban_seller'
        ]::text[])
    ORDER BY a.created_at DESC
    LIMIT 50
  `) as Array<{
    id: string;
    report_id: string;
    report_code: string;
    target_title: string | null;
    action_type: string;
    reason: string;
    status: string;
    seller_response: string | null;
    created_at: string | Date;
    seller_responded_at: string | Date | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    reportId: row.report_id,
    reportCode: row.report_code,
    productTitle:
      row.target_title || undefined,
    actionType:
      row.action_type,
    canRespond:
      row.action_type ===
        "contact_seller",
    request: row.reason,
    status: row.status,
    response:
      row.seller_response || undefined,
    createdAt:
      new Date(
        row.created_at
      ).toISOString(),
    respondedAt:
      row.seller_responded_at
        ? new Date(
            row.seller_responded_at
          ).toISOString()
        : undefined,
  }));
}

export async function dbRespondToSokoSellerNotice(
  input: {
    actionId: string;
    sellerUserId: string;
    response: unknown;
  }
) {
  const actionIdValue = cleanText(
    input.actionId,
    240
  );

  const sellerUserId = cleanText(
    input.sellerUserId,
    240
  );

  const response = cleanText(
    input.response,
    4000
  );

  if (
    !actionIdValue ||
    !sellerUserId ||
    response.length < 3
  ) {
    throw new Error(
      "Enter a seller response."
    );
  }

  await ensureSokoSafetySchema();

  const sql = getSql();

  const rows = (await sql`
    WITH updated AS (
      UPDATE soko_safety_actions
      SET
        seller_response = ${response}::text,
        seller_responded_at = NOW(),
        status = 'seller_responded',
        updated_at = NOW()
      WHERE id = ${actionIdValue}::text
        AND seller_user_id =
          ${sellerUserId}::text
        AND action_type =
          'contact_seller'
        AND status IN (
          'awaiting_seller_response',
          'seller_responded'
        )
      RETURNING
        id,
        report_id
    ),
    inserted_event AS (
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
        ${eventId()}::text,
        report_id,
        'soko_seller_responded'::text,
        ${sellerUserId}::text,
        'seller'::text,
        'SOKO seller responded'::text,
        ${response}::text,
        ${JSON.stringify({
          sourceBoundary: "soko",
        })}::text,
        NOW()
      FROM updated
      RETURNING id
    )
    SELECT id
    FROM updated
  `) as Array<{ id: string }>;

  if (!rows[0]) {
    throw new Error(
      "This seller notice was not found."
    );
  }

  return {
    actionId: rows[0].id,
    status: "seller_responded" as const,
  };
}
