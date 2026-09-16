export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

export type OpenProductReportSlot =
  | { kind: "canonical"; report: { id: string; reportCode: string; status: string; createdAt: string } }
  | { kind: "resume"; reportId: string };

export function uniqueViolation(error: unknown) {
  const code = String((error as { code?: string }).code || "");
  const message = error instanceof Error ? error.message : String(error || "");
  return code === "23505" || /soko_product_report_open_uidx|soko_product_report_opened_event_uidx|duplicate key|UNIQUE constraint failed/i.test(message);
}

export async function consumeEngagementRateLimit(
  sql: SqlTag,
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now()
) {
  const rows = (await sql`INSERT INTO soko_engagement_rate_buckets
      (bucket_key, window_start, window_start_ms, hits)
    VALUES (${key}, ${new Date(nowMs).toISOString()}, ${nowMs}, 1)
    ON CONFLICT (bucket_key) DO UPDATE SET
      window_start = CASE
        WHEN soko_engagement_rate_buckets.window_start_ms IS NULL
          OR ${nowMs} - soko_engagement_rate_buckets.window_start_ms >= ${windowMs}
        THEN ${new Date(nowMs).toISOString()}
        ELSE soko_engagement_rate_buckets.window_start
      END,
      window_start_ms = CASE
        WHEN soko_engagement_rate_buckets.window_start_ms IS NULL
          OR ${nowMs} - soko_engagement_rate_buckets.window_start_ms >= ${windowMs}
        THEN ${nowMs}
        ELSE soko_engagement_rate_buckets.window_start_ms
      END,
      hits = CASE
        WHEN soko_engagement_rate_buckets.window_start_ms IS NULL
          OR ${nowMs} - soko_engagement_rate_buckets.window_start_ms >= ${windowMs}
        THEN 1
        ELSE soko_engagement_rate_buckets.hits + 1
      END
    WHERE soko_engagement_rate_buckets.window_start_ms IS NULL
      OR ${nowMs} - soko_engagement_rate_buckets.window_start_ms >= ${windowMs}
      OR soko_engagement_rate_buckets.hits < ${limit}
    RETURNING hits`) as Array<{ hits: number }>;
  return { allowed: rows.length > 0, hits: Number(rows[0]?.hits || 0) };
}

export async function readOpenProductReportSlot(
  sql: SqlTag,
  input: { reporterUserId: string; productId: string; reasonCode: string }
): Promise<OpenProductReportSlot | null> {
  const rows = (await sql`SELECT s.report_id, r.id AS safety_id, r.report_code, r.status, r.created_at
    FROM soko_product_report_snapshots s
    LEFT JOIN kristo_safety_reports r ON r.id = s.report_id
    WHERE s.reporter_user_id = ${input.reporterUserId}
      AND s.product_id = ${input.productId}
      AND s.reason_code = ${input.reasonCode}
      AND s.open = TRUE
    ORDER BY s.created_at DESC
    LIMIT 1`) as Array<{
    report_id: string;
    safety_id: string | null;
    report_code: string | null;
    status: string | null;
    created_at: string | Date | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  if (row.safety_id && (row.status === "resolved" || row.status === "dismissed")) {
    await sql`UPDATE soko_product_report_snapshots SET open = FALSE WHERE report_id = ${row.report_id}`;
    return null;
  }
  if (!row.safety_id) return { kind: "resume", reportId: row.report_id };
  return {
    kind: "canonical",
    report: {
      id: row.report_id,
      reportCode: String(row.report_code || ""),
      status: String(row.status || "open"),
      createdAt: new Date(row.created_at || Date.now()).toISOString(),
    },
  };
}

export async function claimOpenProductReport(
  sql: SqlTag,
  input: {
    reportId: string;
    productId: string;
    reporterUserId: string;
    reason: string;
    reasonCode: string;
    snapshot: Record<string, unknown>;
  }
) {
  try {
    await sql`INSERT INTO soko_product_report_snapshots
      (report_id, product_id, reporter_user_id, reason, reason_code, open, snapshot)
      VALUES (
        ${input.reportId},
        ${input.productId},
        ${input.reporterUserId},
        ${input.reason},
        ${input.reasonCode},
        TRUE,
        ${JSON.stringify(input.snapshot)}::jsonb
      )`;
    return { created: true as const, reportId: input.reportId };
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const slot = await readOpenProductReportSlot(sql, input);
    if (slot?.kind === "canonical") {
      return { created: false as const, kind: "canonical" as const, report: slot.report, reportId: slot.report.id };
    }
    if (slot?.kind === "resume") {
      return { created: false as const, kind: "resume" as const, reportId: slot.reportId, report: null };
    }
    throw error;
  }
}

export async function ensureProductReportOpenedEvent(
  sql: SqlTag,
  input: { reportId: string; actorUserId: string; details: string }
) {
  const rows = (await sql`INSERT INTO kristo_safety_report_events
      (id, report_id, event_type, actor_user_id, actor_role, title, details)
    VALUES (
      ${`sokoopen_${input.reportId}`},
      ${input.reportId},
      ${"report_opened"},
      ${input.actorUserId},
      ${"reporter"},
      ${"report_opened"},
      ${input.details}
    )
    ON CONFLICT (report_id) WHERE event_type = 'report_opened' DO NOTHING
    RETURNING id`) as Array<{ id: string }>;
  return { created: rows.length > 0 };
}

export async function syncSnapshotOpenFlag(sql: SqlTag, reportId: string, status: string) {
  if (status !== "resolved" && status !== "dismissed") return false;
  await sql`UPDATE soko_product_report_snapshots SET open = FALSE WHERE report_id = ${reportId}`;
  return true;
}
