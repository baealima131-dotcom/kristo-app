import { randomUUID } from "node:crypto";

import { getSokoNeonSql } from "./sokoNeon";
import { ensureSokoOrdersSchema } from "./sokoOrdersDb";
import {
  assertPartyCannotSetOutcome,
  canTransitionProtectionCase,
  classifyPaymentVerification,
  cleanSokoProtectionText,
  deadlineEscalationTarget,
  evaluateProtectionCaseEligibility,
  hoursFromNow,
  initialStateForRequestType,
  isOpenProtectionCaseState,
  paymentClaimLabel,
  protectionBlocksOrderFulfillment,
  publicProtectionCaseLanguage,
  SOKO_PROTECTION_DEFAULT_ELIGIBILITY,
  sokoProtectionEnforcementMode,
  type SokoPaymentVerificationKind,
  type SokoProtectionActorRole,
  type SokoProtectionAdminAction,
  type SokoProtectionCaseState,
  type SokoProtectionEvidenceType,
  type SokoProtectionRequestType,
  type SokoProtectionResolutionCode,
  type SokoProtectionSellerResponseKind,
  type SokoProtectionTrustedReferenceType,
} from "@/app/api/_lib/sokoProtectionPolicy";
import {
  buildImmutableProtectionOrderSnapshot,
  hashProtectionJson,
  type SokoProtectionOrderFacts,
} from "@/app/api/_lib/sokoProtectionSnapshot";

export type SokoProtectionCaseRecord = {
  id: string;
  orderId: string;
  buyerUserId: string;
  sellerUserId: string;
  conversationId: string | null;
  requestType: SokoProtectionRequestType;
  reasonCode: string;
  description: string;
  state: SokoProtectionCaseState;
  immutableOrderSnapshot: Record<string, unknown>;
  immutableSnapshotHash: string;
  paymentVerificationKind: SokoPaymentVerificationKind;
  sellerResponseDeadline: string | null;
  evidenceDeadline: string | null;
  externalRefundDeadline: string | null;
  resolutionCode: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type SokoProtectionCaseEventRecord = {
  id: string;
  caseId: string;
  actorUserId: string;
  actorRole: SokoProtectionActorRole;
  eventType: string;
  priorState: string | null;
  nextState: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SokoProtectionEvidenceRecord = {
  id: string;
  caseId: string;
  submittedByUserId: string;
  evidenceType: SokoProtectionEvidenceType;
  trustedReferenceType: SokoProtectionTrustedReferenceType;
  trustedReferenceId: string;
  caption: string;
  immutableSnapshot: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
};

type SchemaGate = {
  promise: Promise<void> | null;
};

function schemaGate(): SchemaGate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSokoProtectionSchema?: SchemaGate;
  };
  if (!globalState.__kristoSokoProtectionSchema) {
    globalState.__kristoSokoProtectionSchema = { promise: null };
  }
  return globalState.__kristoSokoProtectionSchema;
}

function sqlClient() {
  return getSokoNeonSql();
}

function dateText(value: unknown) {
  if (!value) return "";
  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return String(value || "");
  }
}

function dateOrNull(value: unknown) {
  const text = dateText(value);
  return text || null;
}

async function ensureSchema() {
  const gate = schemaGate();
  if (!gate.promise) {
    gate.promise = (async () => {
      await ensureSokoOrdersSchema();
      const sql = sqlClient();

      await sql`
        CREATE TABLE IF NOT EXISTS soko_protection_cases (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          buyer_user_id TEXT NOT NULL,
          seller_user_id TEXT NOT NULL,
          conversation_id TEXT,
          request_type TEXT NOT NULL CHECK (
            request_type IN ('cancellation', 'return', 'dispute')
          ),
          reason_code TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL CHECK (
            state IN (
              'cancellation_requested',
              'return_requested',
              'dispute_opened',
              'awaiting_seller_response',
              'evidence_review',
              'resolution_recommended',
              'refund_external_pending',
              'case_closed'
            )
          ),
          immutable_order_snapshot JSONB NOT NULL,
          immutable_snapshot_hash TEXT NOT NULL,
          payment_verification_kind TEXT NOT NULL CHECK (
            payment_verification_kind IN (
              'provider_verified',
              'seller_attested',
              'unverified'
            )
          ),
          seller_response_deadline TIMESTAMPTZ,
          evidence_deadline TIMESTAMPTZ,
          external_refund_deadline TIMESTAMPTZ,
          resolution_code TEXT,
          resolution_summary TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS soko_protection_case_events (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES soko_protection_cases(id),
          actor_user_id TEXT NOT NULL,
          actor_role TEXT NOT NULL CHECK (
            actor_role IN ('buyer', 'seller', 'admin', 'system')
          ),
          event_type TEXT NOT NULL,
          prior_state TEXT,
          next_state TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS soko_protection_evidence (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES soko_protection_cases(id),
          submitted_by_user_id TEXT NOT NULL,
          evidence_type TEXT NOT NULL,
          trusted_reference_type TEXT NOT NULL DEFAULT 'none',
          trusted_reference_id TEXT NOT NULL DEFAULT '',
          caption TEXT NOT NULL DEFAULT '',
          immutable_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          content_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS soko_protection_cases_open_type_uidx
        ON soko_protection_cases (order_id, request_type)
        WHERE closed_at IS NULL
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_cases_buyer_idx
        ON soko_protection_cases (buyer_user_id, updated_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_cases_seller_idx
        ON soko_protection_cases (seller_user_id, updated_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_cases_state_idx
        ON soko_protection_cases (state, updated_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_cases_admin_queue_idx
        ON soko_protection_cases (state, seller_response_deadline, updated_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_cases_deadline_idx
        ON soko_protection_cases (seller_response_deadline)
        WHERE closed_at IS NULL AND seller_response_deadline IS NOT NULL
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_case_events_case_idx
        ON soko_protection_case_events (case_id, created_at ASC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS soko_protection_evidence_case_idx
        ON soko_protection_evidence (case_id, created_at ASC)
      `;
    })().catch((error) => {
      gate.promise = null;
      throw error;
    });
  }
  await gate.promise;
}

export async function ensureSokoProtectionSchema() {
  await ensureSchema();
}

function caseFromRow(row: Record<string, any>): SokoProtectionCaseRecord {
  return {
    id: String(row.id || ""),
    orderId: String(row.order_id || ""),
    buyerUserId: String(row.buyer_user_id || ""),
    sellerUserId: String(row.seller_user_id || ""),
    conversationId: row.conversation_id
      ? String(row.conversation_id)
      : null,
    requestType: String(row.request_type || "") as SokoProtectionRequestType,
    reasonCode: String(row.reason_code || ""),
    description: String(row.description || ""),
    state: String(row.state || "") as SokoProtectionCaseState,
    immutableOrderSnapshot:
      row.immutable_order_snapshot &&
      typeof row.immutable_order_snapshot === "object"
        ? row.immutable_order_snapshot
        : {},
    immutableSnapshotHash: String(row.immutable_snapshot_hash || ""),
    paymentVerificationKind: String(
      row.payment_verification_kind || "unverified"
    ) as SokoPaymentVerificationKind,
    sellerResponseDeadline: dateOrNull(row.seller_response_deadline),
    evidenceDeadline: dateOrNull(row.evidence_deadline),
    externalRefundDeadline: dateOrNull(row.external_refund_deadline),
    resolutionCode: row.resolution_code
      ? String(row.resolution_code)
      : null,
    resolutionSummary: row.resolution_summary
      ? String(row.resolution_summary)
      : null,
    createdAt: dateText(row.created_at),
    updatedAt: dateText(row.updated_at),
    closedAt: dateOrNull(row.closed_at),
  };
}

function eventFromRow(row: Record<string, any>): SokoProtectionCaseEventRecord {
  return {
    id: String(row.id || ""),
    caseId: String(row.case_id || ""),
    actorUserId: String(row.actor_user_id || ""),
    actorRole: String(row.actor_role || "") as SokoProtectionActorRole,
    eventType: String(row.event_type || ""),
    priorState: row.prior_state ? String(row.prior_state) : null,
    nextState: row.next_state ? String(row.next_state) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: dateText(row.created_at),
  };
}

function evidenceFromRow(
  row: Record<string, any>
): SokoProtectionEvidenceRecord {
  return {
    id: String(row.id || ""),
    caseId: String(row.case_id || ""),
    submittedByUserId: String(row.submitted_by_user_id || ""),
    evidenceType: String(row.evidence_type || "") as SokoProtectionEvidenceType,
    trustedReferenceType: String(
      row.trusted_reference_type || "none"
    ) as SokoProtectionTrustedReferenceType,
    trustedReferenceId: String(row.trusted_reference_id || ""),
    caption: String(row.caption || ""),
    immutableSnapshot:
      row.immutable_snapshot && typeof row.immutable_snapshot === "object"
        ? row.immutable_snapshot
        : {},
    contentHash: String(row.content_hash || ""),
    createdAt: dateText(row.created_at),
  };
}

function orderFactsFromRow(row: Record<string, any>): SokoProtectionOrderFacts {
  return {
    id: String(row.id || ""),
    productId: String(row.product_id || ""),
    buyerUserId: String(row.buyer_user_id || ""),
    sellerUserId: String(row.seller_user_id || ""),
    paymentMethod: String(row.payment_method || ""),
    status: String(row.status || ""),
    snapshot:
      row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {},
    buyerNote: String(row.buyer_note || ""),
    sellerNote: String(row.seller_note || ""),
    transactionReference: String(row.transaction_reference || ""),
    paymentProvider: String(row.payment_provider || ""),
    providerPaymentId: String(row.provider_payment_id || ""),
    providerReference: String(row.provider_reference || ""),
    paymentDate: dateOrNull(row.payment_date),
    trackingNumber: String(row.tracking_number || ""),
    createdAt: dateText(row.created_at),
    updatedAt: dateText(row.updated_at),
  };
}

async function loadOrderById(orderId: string) {
  await ensureSokoOrdersSchema();
  const sql = sqlClient();
  const id = cleanSokoProtectionText(orderId, 100);
  if (!id) return null;
  const rows = (await sql`
    SELECT *
    FROM soko_orders
    WHERE id = ${id}
    LIMIT 1
  `) as Array<Record<string, any>>;
  return rows[0] ? orderFactsFromRow(rows[0]) : null;
}

async function findConversationIdForOrder(order: SokoProtectionOrderFacts) {
  const sql = sqlClient();
  try {
    const rows = (await sql`
      SELECT id
      FROM soko_buyer_seller_conversations
      WHERE buyer_user_id = ${order.buyerUserId}
        AND seller_user_id = ${order.sellerUserId}
        AND product_id = ${order.productId}
      LIMIT 1
    `) as Array<{ id: string }>;
    return rows[0]?.id ? String(rows[0].id) : null;
  } catch {
    return null;
  }
}

function snapshotTimestamps(order: SokoProtectionOrderFacts) {
  const snapshot = order.snapshot || {};
  const shipping =
    snapshot.shipping && typeof snapshot.shipping === "object"
      ? (snapshot.shipping as Record<string, unknown>)
      : {};
  const fulfillment =
    snapshot.fulfillment && typeof snapshot.fulfillment === "object"
      ? (snapshot.fulfillment as Record<string, unknown>)
      : {};
  return {
    paymentApprovedAt:
      order.paymentDate ||
      (typeof snapshot.paymentApprovedAt === "string"
        ? snapshot.paymentApprovedAt
        : null),
    shippedAt:
      typeof shipping.shippedAt === "string"
        ? shipping.shippedAt
        : typeof fulfillment.shippedAt === "string"
          ? fulfillment.shippedAt
          : null,
    deliveredAt:
      typeof shipping.deliveredAt === "string"
        ? shipping.deliveredAt
        : typeof fulfillment.deliveredAt === "string"
          ? fulfillment.deliveredAt
          : null,
  };
}

async function appendEvent(input: {
  caseId: string;
  actorUserId: string;
  actorRole: SokoProtectionActorRole;
  eventType: string;
  priorState: string | null;
  nextState: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sql = sqlClient();
  const id = `sokoprotevt_${randomUUID()}`;
  const metadata = input.metadata || {};
  await sql`
    INSERT INTO soko_protection_case_events (
      id,
      case_id,
      actor_user_id,
      actor_role,
      event_type,
      prior_state,
      next_state,
      metadata
    )
    VALUES (
      ${id},
      ${input.caseId},
      ${input.actorUserId},
      ${input.actorRole},
      ${input.eventType},
      ${input.priorState},
      ${input.nextState},
      ${metadata as any}
    )
  `;
  return id;
}

function partyRole(
  caseRow: SokoProtectionCaseRecord,
  userId: string
): SokoProtectionActorRole | null {
  if (caseRow.buyerUserId === userId) return "buyer";
  if (caseRow.sellerUserId === userId) return "seller";
  return null;
}

export function publicProtectionCaseView(
  caseRow: SokoProtectionCaseRecord,
  extras?: {
    events?: SokoProtectionCaseEventRecord[];
    evidence?: SokoProtectionEvidenceRecord[];
    orderStatus?: string | null;
  }
) {
  const orderStatus =
    extras?.orderStatus ||
    String(
      (caseRow.immutableOrderSnapshot as { orderStatusAtOpen?: string })
        .orderStatusAtOpen || ""
    );
  const paymentClaim = paymentClaimLabel({
    orderStatus,
    verificationKind: caseRow.paymentVerificationKind,
  });
  const language = publicProtectionCaseLanguage({
    state: caseRow.state,
    paymentClaim,
    resolutionCode: caseRow.resolutionCode,
  });

  return {
    id: caseRow.id,
    orderId: caseRow.orderId,
    buyerUserId: caseRow.buyerUserId,
    sellerUserId: caseRow.sellerUserId,
    conversationId: caseRow.conversationId,
    requestType: caseRow.requestType,
    reasonCode: caseRow.reasonCode,
    description: caseRow.description,
    state: caseRow.state,
    immutableSnapshotHash: caseRow.immutableSnapshotHash,
    immutableOrderSnapshot: caseRow.immutableOrderSnapshot,
    paymentVerificationKind: caseRow.paymentVerificationKind,
    paymentClaim: language.paymentClaim,
    sellerResponseDeadline: caseRow.sellerResponseDeadline,
    evidenceDeadline: caseRow.evidenceDeadline,
    externalRefundDeadline: caseRow.externalRefundDeadline,
    resolutionCode: caseRow.resolutionCode,
    resolutionSummary: caseRow.resolutionSummary,
    resolutionNotice: language.resolutionNotice,
    isEscrow: language.isEscrow,
    isGuaranteedRefund: language.isGuaranteedRefund,
    isVerifiedDelivery: language.isVerifiedDelivery,
    holdsBuyerFunds: language.holdsBuyerFunds,
    summary: language.summary,
    createdAt: caseRow.createdAt,
    updatedAt: caseRow.updatedAt,
    closedAt: caseRow.closedAt,
    events: extras?.events || [],
    evidence: (extras?.evidence || []).map((row) => ({
      id: row.id,
      caseId: row.caseId,
      submittedByUserId: row.submittedByUserId,
      evidenceType: row.evidenceType,
      trustedReferenceType: row.trustedReferenceType,
      trustedReferenceId: row.trustedReferenceId,
      caption: row.caption,
      immutableSnapshot: row.immutableSnapshot,
      contentHash: row.contentHash,
      createdAt: row.createdAt,
    })),
    enforcement: {
      mode: sokoProtectionEnforcementMode(),
      blocksOrderFulfillment: protectionBlocksOrderFulfillment(),
    },
  };
}

async function getCaseRow(caseId: string) {
  const sql = sqlClient();
  const id = cleanSokoProtectionText(caseId, 100);
  if (!id) return null;
  const rows = (await sql`
    SELECT *
    FROM soko_protection_cases
    WHERE id = ${id}
    LIMIT 1
  `) as Array<Record<string, any>>;
  return rows[0] ? caseFromRow(rows[0]) : null;
}

async function listEvents(caseId: string) {
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_protection_case_events
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC
  `) as Array<Record<string, any>>;
  return rows.map(eventFromRow);
}

async function listEvidence(caseId: string) {
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_protection_evidence
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC
  `) as Array<Record<string, any>>;
  return rows.map(evidenceFromRow);
}

async function findOpenCase(
  orderId: string,
  requestType: SokoProtectionRequestType
) {
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_protection_cases
    WHERE order_id = ${orderId}
      AND request_type = ${requestType}
      AND closed_at IS NULL
    LIMIT 1
  `) as Array<Record<string, any>>;
  return rows[0] ? caseFromRow(rows[0]) : null;
}

export async function dbOpenSokoProtectionCase(input: {
  actorUserId: string;
  orderId: string;
  requestType: SokoProtectionRequestType;
  reasonCode: string;
  description: string;
  /** Ignored — server derives parties from the order. */
  buyerUserId?: unknown;
  sellerUserId?: unknown;
  amount?: unknown;
  currency?: unknown;
  productId?: unknown;
  resolutionCode?: unknown;
  outcome?: unknown;
}) {
  await ensureSchema();

  const outcomeGuard = assertPartyCannotSetOutcome({
    actorRole: "buyer",
    resolutionCode: input.resolutionCode,
    outcome: input.outcome,
  });
  if (!outcomeGuard.ok) {
    throw Object.assign(new Error(outcomeGuard.error), {
      code: outcomeGuard.code,
      status: 403,
    });
  }

  const order = await loadOrderById(input.orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found."), {
      code: "order_not_found",
      status: 404,
    });
  }

  if (order.buyerUserId !== input.actorUserId) {
    throw Object.assign(
      new Error("Only the buyer on this order can open a protection case."),
      { code: "buyer_only", status: 403 }
    );
  }

  const existing = await findOpenCase(order.id, input.requestType);
  if (existing) {
    return {
      case: existing,
      created: false,
      idempotent: true,
    };
  }

  const stamps = snapshotTimestamps(order);
  const eligibility = evaluateProtectionCaseEligibility({
    requestType: input.requestType,
    orderStatus: order.status,
    paymentApprovedAt: stamps.paymentApprovedAt,
    shippedAt: stamps.shippedAt,
    deliveredAt: stamps.deliveredAt,
  });
  if (!eligibility.ok) {
    throw Object.assign(new Error(eligibility.error), {
      code: eligibility.code,
      status: 400,
    });
  }

  const verificationKind = classifyPaymentVerification({
    orderStatus: order.status,
    paymentMethod: order.paymentMethod,
    paymentProvider: order.paymentProvider,
    providerPaymentId: order.providerPaymentId,
  });
  const frozen = buildImmutableProtectionOrderSnapshot(order);
  const conversationId = await findConversationIdForOrder(order);
  const initialState = initialStateForRequestType(input.requestType);
  const awaitingState: SokoProtectionCaseState = "awaiting_seller_response";
  const sellerDeadline = hoursFromNow(
    SOKO_PROTECTION_DEFAULT_ELIGIBILITY.sellerResponseHours
  );
  const caseId = `sokoprot_${randomUUID()}`;
  const sql = sqlClient();

  try {
    await sql`
      INSERT INTO soko_protection_cases (
        id,
        order_id,
        buyer_user_id,
        seller_user_id,
        conversation_id,
        request_type,
        reason_code,
        description,
        state,
        immutable_order_snapshot,
        immutable_snapshot_hash,
        payment_verification_kind,
        seller_response_deadline
      )
      VALUES (
        ${caseId},
        ${order.id},
        ${order.buyerUserId},
        ${order.sellerUserId},
        ${conversationId},
        ${input.requestType},
        ${cleanSokoProtectionText(input.reasonCode, 80)},
        ${cleanSokoProtectionText(input.description, 2000)},
        ${awaitingState},
        ${frozen.snapshot as any},
        ${frozen.hash},
        ${verificationKind},
        ${sellerDeadline}
      )
    `;
  } catch (error: any) {
    const message = String(error?.message || error || "");
    if (/unique|duplicate/i.test(message)) {
      const raced = await findOpenCase(order.id, input.requestType);
      if (raced) {
        return { case: raced, created: false, idempotent: true };
      }
    }
    throw error;
  }

  await appendEvent({
    caseId,
    actorUserId: input.actorUserId,
    actorRole: "buyer",
    eventType: "case_opened",
    priorState: null,
    nextState: initialState,
    metadata: {
      requestType: input.requestType,
      reasonCode: cleanSokoProtectionText(input.reasonCode, 80),
      ignoredClientBuyerId: input.buyerUserId ?? null,
      ignoredClientSellerId: input.sellerUserId ?? null,
      ignoredClientAmount: input.amount ?? null,
      ignoredClientProductId: input.productId ?? null,
    },
  });

  await appendEvent({
    caseId,
    actorUserId: "system",
    actorRole: "system",
    eventType: "case_opened_awaiting_seller",
    priorState: initialState,
    nextState: awaitingState,
    metadata: {
      sellerResponseDeadline: sellerDeadline,
    },
  });

  const created = await getCaseRow(caseId);
  if (!created) {
    throw new Error("Protection case could not be created.");
  }

  return { case: created, created: true, idempotent: false };
}

export async function dbListSokoProtectionCasesForUser(userId: string) {
  await ensureSchema();
  const sql = sqlClient();
  const id = cleanSokoProtectionText(userId, 180);
  const rows = (await sql`
    SELECT *
    FROM soko_protection_cases
    WHERE buyer_user_id = ${id}
       OR seller_user_id = ${id}
    ORDER BY updated_at DESC
    LIMIT 200
  `) as Array<Record<string, any>>;
  return rows.map(caseFromRow);
}

export async function dbGetSokoProtectionCaseForParty(input: {
  caseId: string;
  userId: string;
}) {
  await ensureSchema();
  const caseRow = await getCaseRow(input.caseId);
  if (!caseRow) {
    throw Object.assign(new Error("Protection case not found."), {
      code: "case_not_found",
      status: 404,
    });
  }
  if (!partyRole(caseRow, input.userId)) {
    throw Object.assign(new Error("You cannot view this protection case."), {
      code: "forbidden",
      status: 403,
    });
  }
  const [events, evidence, order] = await Promise.all([
    listEvents(caseRow.id),
    listEvidence(caseRow.id),
    loadOrderById(caseRow.orderId),
  ]);
  return publicProtectionCaseView(caseRow, {
    events,
    evidence,
    orderStatus: order?.status || null,
  });
}

export async function dbRespondSokoProtectionCase(input: {
  caseId: string;
  actorUserId: string;
  responseKind: SokoProtectionSellerResponseKind;
  note?: string;
  resolutionCode?: unknown;
  outcome?: unknown;
  closeCase?: unknown;
}) {
  await ensureSchema();
  const outcomeGuard = assertPartyCannotSetOutcome({
    actorRole: "seller",
    resolutionCode: input.resolutionCode,
    outcome: input.outcome,
    closeCase: input.closeCase,
  });
  if (!outcomeGuard.ok) {
    throw Object.assign(new Error(outcomeGuard.error), {
      code: outcomeGuard.code,
      status: 403,
    });
  }

  const caseRow = await getCaseRow(input.caseId);
  if (!caseRow) {
    throw Object.assign(new Error("Protection case not found."), {
      code: "case_not_found",
      status: 404,
    });
  }
  if (caseRow.sellerUserId !== input.actorUserId) {
    throw Object.assign(
      new Error("Only the seller on this case can submit a seller response."),
      { code: "seller_only", status: 403 }
    );
  }
  if (caseRow.state !== "awaiting_seller_response") {
    throw Object.assign(
      new Error("Seller response is not allowed in the current case state."),
      { code: "invalid_state", status: 400 }
    );
  }
  if (
    !canTransitionProtectionCase({
      from: "awaiting_seller_response",
      to: "evidence_review",
      actor: "seller",
      eventType: "seller_responded",
    })
  ) {
    throw new Error("Invalid protection transition.");
  }

  const sql = sqlClient();
  const note = cleanSokoProtectionText(input.note, 2000);
  const updated = (await sql`
    UPDATE soko_protection_cases
    SET
      state = 'evidence_review',
      updated_at = NOW()
    WHERE id = ${caseRow.id}
      AND seller_user_id = ${input.actorUserId}
      AND state = 'awaiting_seller_response'
      AND closed_at IS NULL
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!updated[0]) {
    throw Object.assign(
      new Error("Seller response could not be recorded."),
      { code: "conflict", status: 409 }
    );
  }

  await appendEvent({
    caseId: caseRow.id,
    actorUserId: input.actorUserId,
    actorRole: "seller",
    eventType: "seller_responded",
    priorState: "awaiting_seller_response",
    nextState: "evidence_review",
    metadata: {
      responseKind: input.responseKind,
      note,
    },
  });

  return caseFromRow(updated[0]);
}

async function resolveTrustedEvidence(input: {
  caseRow: SokoProtectionCaseRecord;
  actorUserId: string;
  evidenceType: SokoProtectionEvidenceType;
  trustedReferenceType: SokoProtectionTrustedReferenceType;
  trustedReferenceId: string;
  caption: string;
}) {
  const sql = sqlClient();
  const caption = cleanSokoProtectionText(input.caption, 500);
  const refId = cleanSokoProtectionText(input.trustedReferenceId, 180);

  if (
    input.evidenceType === "caption_note" ||
    input.trustedReferenceType === "none"
  ) {
    if (!caption) {
      throw Object.assign(new Error("A caption is required for note evidence."), {
        code: "missing_caption",
        status: 400,
      });
    }
    const snapshot = {
      kind: "caption_note",
      caption,
      orderId: input.caseRow.orderId,
    };
    return {
      evidenceType: "caption_note" as const,
      trustedReferenceType: "none" as const,
      trustedReferenceId: "",
      caption,
      immutableSnapshot: snapshot,
      contentHash: hashProtectionJson(snapshot),
    };
  }

  if (
    input.evidenceType === "payment_proof" ||
    input.trustedReferenceType === "payment_proof"
  ) {
    if (!refId) {
      throw Object.assign(new Error("Payment proof reference is required."), {
        code: "missing_reference",
        status: 400,
      });
    }
    const proofs = (await sql`
      SELECT id, order_id, buyer_user_id, seller_user_id, position,
             proof_sha256, proof_mime, created_at
      FROM soko_order_payment_proofs
      WHERE id = ${refId}
      LIMIT 1
    `) as Array<Record<string, any>>;
    const proof = proofs[0];
    if (!proof || String(proof.order_id) !== input.caseRow.orderId) {
      throw Object.assign(
        new Error("Payment proof does not belong to this order."),
        { code: "evidence_mismatch", status: 400 }
      );
    }
    if (
      String(proof.buyer_user_id) !== input.caseRow.buyerUserId ||
      String(proof.seller_user_id) !== input.caseRow.sellerUserId
    ) {
      throw Object.assign(
        new Error("Payment proof parties do not match this case."),
        { code: "evidence_mismatch", status: 400 }
      );
    }
    const snapshot = {
      kind: "payment_proof",
      proofId: String(proof.id),
      orderId: String(proof.order_id),
      position: Number(proof.position),
      proofSha256: String(proof.proof_sha256 || ""),
      proofMime: String(proof.proof_mime || ""),
      createdAt: dateText(proof.created_at),
      // Intentionally omit proof_base64 — reference only.
    };
    return {
      evidenceType: "payment_proof" as const,
      trustedReferenceType: "payment_proof" as const,
      trustedReferenceId: String(proof.id),
      caption,
      immutableSnapshot: snapshot,
      contentHash: String(proof.proof_sha256 || hashProtectionJson(snapshot)),
    };
  }

  if (
    input.evidenceType === "order_legacy_payment_proof" ||
    input.trustedReferenceType === "order_legacy_payment_proof"
  ) {
    const order = await loadOrderById(input.caseRow.orderId);
    if (!order) {
      throw Object.assign(new Error("Order not found for legacy proof."), {
        code: "order_not_found",
        status: 404,
      });
    }
    const rows = (await sql`
      SELECT id, payment_proof_sha256, proof_mime, proof_key
      FROM soko_orders
      WHERE id = ${input.caseRow.orderId}
      LIMIT 1
    `) as Array<Record<string, any>>;
    const row = rows[0];
    if (!row || (!row.proof_key && !row.payment_proof_sha256)) {
      throw Object.assign(new Error("No legacy payment proof on this order."), {
        code: "missing_legacy_proof",
        status: 400,
      });
    }
    const snapshot = {
      kind: "order_legacy_payment_proof",
      orderId: input.caseRow.orderId,
      proofKey: String(row.proof_key || ""),
      paymentProofSha256: String(row.payment_proof_sha256 || ""),
      proofMime: String(row.proof_mime || ""),
    };
    return {
      evidenceType: "order_legacy_payment_proof" as const,
      trustedReferenceType: "order_legacy_payment_proof" as const,
      trustedReferenceId: input.caseRow.orderId,
      caption,
      immutableSnapshot: snapshot,
      contentHash: String(
        row.payment_proof_sha256 || hashProtectionJson(snapshot)
      ),
    };
  }

  if (
    input.evidenceType === "chat_message" ||
    input.trustedReferenceType === "chat_message"
  ) {
    if (!refId) {
      throw Object.assign(new Error("Chat message reference is required."), {
        code: "missing_reference",
        status: 400,
      });
    }
    const messages = (await sql`
      SELECT
        m.id,
        m.conversation_id,
        m.sender_user_id,
        m.text,
        m.message_type,
        m.created_at,
        m.share_product_id,
        m.share_product_title,
        c.buyer_user_id,
        c.seller_user_id,
        c.product_id
      FROM soko_buyer_seller_messages m
      INNER JOIN soko_buyer_seller_conversations c
        ON c.id = m.conversation_id
      WHERE m.id = ${refId}
      LIMIT 1
    `) as Array<Record<string, any>>;
    const message = messages[0];
    if (!message) {
      throw Object.assign(new Error("Chat message not found."), {
        code: "message_not_found",
        status: 404,
      });
    }
    if (
      String(message.buyer_user_id) !== input.caseRow.buyerUserId ||
      String(message.seller_user_id) !== input.caseRow.sellerUserId
    ) {
      throw Object.assign(
        new Error("Chat message does not belong to this order’s parties."),
        { code: "evidence_mismatch", status: 400 }
      );
    }
    if (
      input.caseRow.conversationId &&
      String(message.conversation_id) !== input.caseRow.conversationId
    ) {
      throw Object.assign(
        new Error("Chat message does not belong to this case conversation."),
        { code: "evidence_mismatch", status: 400 }
      );
    }
    const order = await loadOrderById(input.caseRow.orderId);
    if (order && String(message.product_id) !== order.productId) {
      throw Object.assign(
        new Error("Chat conversation product does not match this order."),
        { code: "evidence_mismatch", status: 400 }
      );
    }
    const snapshot = {
      kind: "chat_message",
      messageId: String(message.id),
      conversationId: String(message.conversation_id),
      senderUserId: String(message.sender_user_id),
      text: String(message.text || "").slice(0, 4000),
      messageType: String(message.message_type || "text"),
      shareProductId: String(message.share_product_id || ""),
      shareProductTitle: String(message.share_product_title || ""),
      createdAt: dateText(message.created_at),
      sentMeansAcceptedForSendingOnly: true,
    };
    return {
      evidenceType: "chat_message" as const,
      trustedReferenceType: "chat_message" as const,
      trustedReferenceId: String(message.id),
      caption,
      immutableSnapshot: snapshot,
      contentHash: hashProtectionJson(snapshot),
    };
  }

  if (input.evidenceType === "shipping_note") {
    const snapshot = {
      kind: "shipping_note",
      caption,
      orderId: input.caseRow.orderId,
      note: "Seller-entered tracking is not proof of carrier delivery confirmation.",
    };
    return {
      evidenceType: "shipping_note" as const,
      trustedReferenceType: "none" as const,
      trustedReferenceId: "",
      caption,
      immutableSnapshot: snapshot,
      contentHash: hashProtectionJson(snapshot),
    };
  }

  throw Object.assign(new Error("Unsupported evidence type."), {
    code: "invalid_evidence_type",
    status: 400,
  });
}

export async function dbAddSokoProtectionEvidence(input: {
  caseId: string;
  actorUserId: string;
  evidenceType: SokoProtectionEvidenceType;
  trustedReferenceType?: SokoProtectionTrustedReferenceType;
  trustedReferenceId?: string;
  caption?: string;
  /** Spoof / outcome fields ignored or rejected. */
  resolutionCode?: unknown;
  outcome?: unknown;
  base64?: unknown;
  proofBase64?: unknown;
}) {
  await ensureSchema();

  if (input.base64 != null || input.proofBase64 != null) {
    throw Object.assign(
      new Error(
        "Do not upload image bytes to protection evidence. Reference an existing payment proof instead."
      ),
      { code: "raw_bytes_forbidden", status: 400 }
    );
  }

  const caseRow = await getCaseRow(input.caseId);
  if (!caseRow) {
    throw Object.assign(new Error("Protection case not found."), {
      code: "case_not_found",
      status: 404,
    });
  }
  const role = partyRole(caseRow, input.actorUserId);
  if (!role || (role !== "buyer" && role !== "seller")) {
    throw Object.assign(new Error("You cannot add evidence to this case."), {
      code: "forbidden",
      status: 403,
    });
  }
  const outcomeGuard = assertPartyCannotSetOutcome({
    actorRole: role,
    resolutionCode: input.resolutionCode,
    outcome: input.outcome,
  });
  if (!outcomeGuard.ok) {
    throw Object.assign(new Error(outcomeGuard.error), {
      code: outcomeGuard.code,
      status: 403,
    });
  }
  if (!isOpenProtectionCaseState(caseRow.state)) {
    throw Object.assign(new Error("This case is closed."), {
      code: "case_closed",
      status: 400,
    });
  }

  const resolved = await resolveTrustedEvidence({
    caseRow,
    actorUserId: input.actorUserId,
    evidenceType: input.evidenceType,
    trustedReferenceType: input.trustedReferenceType || "none",
    trustedReferenceId: input.trustedReferenceId || "",
    caption: input.caption || "",
  });

  const sql = sqlClient();
  const evidenceId = `sokoprotevd_${randomUUID()}`;
  await sql`
    INSERT INTO soko_protection_evidence (
      id,
      case_id,
      submitted_by_user_id,
      evidence_type,
      trusted_reference_type,
      trusted_reference_id,
      caption,
      immutable_snapshot,
      content_hash
    )
    VALUES (
      ${evidenceId},
      ${caseRow.id},
      ${input.actorUserId},
      ${resolved.evidenceType},
      ${resolved.trustedReferenceType},
      ${resolved.trustedReferenceId},
      ${resolved.caption},
      ${resolved.immutableSnapshot as any},
      ${resolved.contentHash}
    )
  `;

  await appendEvent({
    caseId: caseRow.id,
    actorUserId: input.actorUserId,
    actorRole: role,
    eventType: "evidence_added",
    priorState: caseRow.state,
    nextState: caseRow.state,
    metadata: {
      evidenceId,
      evidenceType: resolved.evidenceType,
      trustedReferenceType: resolved.trustedReferenceType,
      trustedReferenceId: resolved.trustedReferenceId,
    },
  });

  await sql`
    UPDATE soko_protection_cases
    SET updated_at = NOW()
    WHERE id = ${caseRow.id}
  `;

  const created = (await sql`
    SELECT *
    FROM soko_protection_evidence
    WHERE id = ${evidenceId}
    LIMIT 1
  `) as Array<Record<string, any>>;

  return evidenceFromRow(created[0]);
}

export async function dbListAdminSokoProtectionCases(input?: {
  state?: string;
  paymentVerificationKind?: string;
}) {
  await ensureSchema();
  const sql = sqlClient();
  const state = cleanSokoProtectionText(input?.state, 40);
  const kind = cleanSokoProtectionText(input?.paymentVerificationKind, 40);

  let rows: Array<Record<string, any>>;
  if (state && kind) {
    rows = (await sql`
      SELECT *
      FROM soko_protection_cases
      WHERE state = ${state}
        AND payment_verification_kind = ${kind}
      ORDER BY updated_at DESC
      LIMIT 200
    `) as Array<Record<string, any>>;
  } else if (state) {
    rows = (await sql`
      SELECT *
      FROM soko_protection_cases
      WHERE state = ${state}
      ORDER BY updated_at DESC
      LIMIT 200
    `) as Array<Record<string, any>>;
  } else if (kind) {
    rows = (await sql`
      SELECT *
      FROM soko_protection_cases
      WHERE payment_verification_kind = ${kind}
      ORDER BY updated_at DESC
      LIMIT 200
    `) as Array<Record<string, any>>;
  } else {
    rows = (await sql`
      SELECT *
      FROM soko_protection_cases
      ORDER BY updated_at DESC
      LIMIT 200
    `) as Array<Record<string, any>>;
  }
  return rows.map(caseFromRow);
}

export async function dbGetAdminSokoProtectionCase(caseId: string) {
  await ensureSchema();
  const caseRow = await getCaseRow(caseId);
  if (!caseRow) {
    throw Object.assign(new Error("Protection case not found."), {
      code: "case_not_found",
      status: 404,
    });
  }
  const [events, evidence, order] = await Promise.all([
    listEvents(caseRow.id),
    listEvidence(caseRow.id),
    loadOrderById(caseRow.orderId),
  ]);
  return {
    ...publicProtectionCaseView(caseRow, {
      events,
      evidence,
      orderStatus: order?.status || null,
    }),
    liveOrderStatus: order?.status || null,
    liveTrackingNumber: order?.trackingNumber || null,
  };
}

const ADMIN_RESOLUTION_CODES: ReadonlySet<string> = new Set([
  "recommend_cancel_ok",
  "recommend_return_ok",
  "recommend_external_refund",
  "recommend_seller_keep",
  "recommend_no_action",
  "dismiss_ineligible",
  "dismiss_abusive",
]);

export async function dbAdminSokoProtectionCaseAction(input: {
  caseId: string;
  actorUserId: string;
  action: SokoProtectionAdminAction;
  resolutionCode?: string;
  resolutionSummary?: string;
  note?: string;
}) {
  await ensureSchema();
  const caseRow = await getCaseRow(input.caseId);
  if (!caseRow) {
    throw Object.assign(new Error("Protection case not found."), {
      code: "case_not_found",
      status: 404,
    });
  }
  if (caseRow.state === "case_closed") {
    throw Object.assign(new Error("Case is already closed."), {
      code: "case_closed",
      status: 400,
    });
  }

  const sql = sqlClient();
  const note = cleanSokoProtectionText(input.note, 2000);
  const summary = cleanSokoProtectionText(input.resolutionSummary, 2000);
  let nextState: SokoProtectionCaseState = caseRow.state;
  let eventType: string = input.action;
  let resolutionCode = caseRow.resolutionCode;
  let resolutionSummary = caseRow.resolutionSummary;
  let evidenceDeadline = caseRow.evidenceDeadline;
  let externalRefundDeadline = caseRow.externalRefundDeadline;
  let closedAt: string | null = caseRow.closedAt;

  if (input.action === "request_evidence") {
    if (
      !canTransitionProtectionCase({
        from: caseRow.state,
        to: "evidence_review",
        actor: "admin",
        eventType: "evidence_requested",
      }) &&
      caseRow.state !== "evidence_review"
    ) {
      throw Object.assign(
        new Error("Evidence can only be requested during evidence review."),
        { code: "invalid_state", status: 400 }
      );
    }
    nextState = "evidence_review";
    eventType = "evidence_requested";
    evidenceDeadline = hoursFromNow(
      SOKO_PROTECTION_DEFAULT_ELIGIBILITY.evidenceResponseHours
    );
  } else if (input.action === "recommend_resolution") {
    const code = cleanSokoProtectionText(input.resolutionCode, 80);
    if (!ADMIN_RESOLUTION_CODES.has(code)) {
      throw Object.assign(new Error("Invalid resolution code."), {
        code: "invalid_resolution_code",
        status: 400,
      });
    }
    if (
      !canTransitionProtectionCase({
        from: caseRow.state,
        to: "resolution_recommended",
        actor: "admin",
        eventType: "resolution_recommended",
      })
    ) {
      throw Object.assign(
        new Error("Resolution can only be recommended from evidence review."),
        { code: "invalid_state", status: 400 }
      );
    }
    nextState = "resolution_recommended";
    eventType = "resolution_recommended";
    resolutionCode = code as SokoProtectionResolutionCode;
    resolutionSummary = summary || note;
  } else if (input.action === "mark_external_refund_pending") {
    if (
      !canTransitionProtectionCase({
        from: caseRow.state,
        to: "refund_external_pending",
        actor: "admin",
        eventType: "external_refund_pending",
      })
    ) {
      throw Object.assign(
        new Error(
          "External refund pending requires a recommended resolution first."
        ),
        { code: "invalid_state", status: 400 }
      );
    }
    nextState = "refund_external_pending";
    eventType = "external_refund_pending";
    externalRefundDeadline = hoursFromNow(
      SOKO_PROTECTION_DEFAULT_ELIGIBILITY.externalRefundWindowDays * 24
    );
  } else if (input.action === "report_external_refund_logged") {
    if (
      !canTransitionProtectionCase({
        from: caseRow.state,
        to: "case_closed",
        actor: "admin",
        eventType: "external_refund_reported",
      })
    ) {
      throw Object.assign(
        new Error(
          "External refund can only be logged from refund_external_pending."
        ),
        { code: "invalid_state", status: 400 }
      );
    }
    nextState = "case_closed";
    eventType = "external_refund_reported";
    closedAt = new Date().toISOString();
  } else if (input.action === "close_case") {
    if (
      !canTransitionProtectionCase({
        from: caseRow.state,
        to: "case_closed",
        actor: "admin",
        eventType: "case_closed",
      })
    ) {
      throw Object.assign(new Error("Case cannot be closed from this state."), {
        code: "invalid_state",
        status: 400,
      });
    }
    nextState = "case_closed";
    eventType = "case_closed";
    closedAt = new Date().toISOString();
  } else {
    throw Object.assign(new Error("Unknown admin action."), {
      code: "invalid_action",
      status: 400,
    });
  }

  const updated = (await sql`
    UPDATE soko_protection_cases
    SET
      state = ${nextState},
      resolution_code = ${resolutionCode},
      resolution_summary = ${resolutionSummary},
      evidence_deadline = ${evidenceDeadline},
      external_refund_deadline = ${externalRefundDeadline},
      closed_at = ${closedAt},
      updated_at = NOW()
    WHERE id = ${caseRow.id}
      AND closed_at IS NULL
    RETURNING *
  `) as Array<Record<string, any>>;

  if (!updated[0]) {
    throw Object.assign(new Error("Admin action could not be applied."), {
      code: "conflict",
      status: 409,
    });
  }

  await appendEvent({
    caseId: caseRow.id,
    actorUserId: input.actorUserId,
    actorRole: "admin",
    eventType,
    priorState: caseRow.state,
    nextState,
    metadata: {
      action: input.action,
      resolutionCode,
      resolutionSummary,
      note,
      // Explicit: admin actions never move funds.
      fundsMovedBySoko: false,
      autoRefund: false,
    },
  });

  return caseFromRow(updated[0]);
}

/**
 * Escalate missed seller deadlines to evidence_review.
 * Never creates refunds or changes order fulfillment status.
 */
export async function dbEscalateSokoProtectionDeadlines(now: Date = new Date()) {
  await ensureSchema();
  const sql = sqlClient();
  const rows = (await sql`
    SELECT *
    FROM soko_protection_cases
    WHERE closed_at IS NULL
      AND state = 'awaiting_seller_response'
      AND seller_response_deadline IS NOT NULL
      AND seller_response_deadline <= ${now.toISOString()}
    LIMIT 100
  `) as Array<Record<string, any>>;

  const escalated: SokoProtectionCaseRecord[] = [];
  for (const row of rows) {
    const caseRow = caseFromRow(row);
    const target = deadlineEscalationTarget({
      state: caseRow.state,
      sellerResponseDeadline: caseRow.sellerResponseDeadline,
      now,
    });
    if (target !== "evidence_review") continue;

    const updated = (await sql`
      UPDATE soko_protection_cases
      SET
        state = 'evidence_review',
        updated_at = NOW()
      WHERE id = ${caseRow.id}
        AND state = 'awaiting_seller_response'
        AND closed_at IS NULL
      RETURNING *
    `) as Array<Record<string, any>>;

    if (!updated[0]) continue;

    await appendEvent({
      caseId: caseRow.id,
      actorUserId: "system",
      actorRole: "system",
      eventType: "seller_deadline_missed",
      priorState: "awaiting_seller_response",
      nextState: "evidence_review",
      metadata: {
        autoRefund: false,
        fundsMovedBySoko: false,
        note: "Escalated to evidence review after seller response deadline. No automatic refund.",
      },
    });
    escalated.push(caseFromRow(updated[0]));
  }
  return escalated;
}
