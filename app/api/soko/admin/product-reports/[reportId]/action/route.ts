import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import {
  actionTargetStatus,
  canTransitionReport,
} from "@/app/api/_lib/sokoEngagementPolicy";
import { getDatabaseUrl } from "@/app/api/_lib/store/authDb";
import { dbHasSafetyRole } from "@/app/api/_lib/store/safetyDb";
import { dbAssignReportToSupervisor } from "@/app/api/_lib/store/safetyReportDb";
import { dbSyncSnapshotOpenFlag } from "@/app/api/_lib/store/sokoEngagementDb";
import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";
import { dbIssueSokoSafetyDecision } from "@/app/api/_lib/store/sokoSafetyDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "assign",
  "dismiss",
  "resolve",
  "escalate",
  "restrict_listing",
]);

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ reportId: string }> }
) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;
  const { reportId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = String((body as { action?: unknown }).action || "").trim();
  const note = String((body as { note?: unknown }).note || "").replace(/\s+/g, " ").trim();
  if (!ACTIONS.has(action)) return reply({ ok: false, error: "Invalid action." }, 400);
  if (note.length < 8) return reply({ ok: false, error: "A note of at least 8 characters is required." }, 400);

  const nextStatus = actionTargetStatus(action);
  if (!nextStatus) return reply({ ok: false, error: "Invalid action." }, 400);

  const url = getDatabaseUrl();
  if (!url) return reply({ ok: false, error: "Database unavailable." }, 503);
  const sql = neon(url);
  const rows = (await sql`SELECT id, source_type, target_type, target_id, status
    FROM kristo_safety_reports WHERE id = ${reportId} LIMIT 1`) as Array<Record<string, string>>;
  const report = rows[0];
  if (!report || report.source_type !== "soko_marketplace" || report.target_type !== "product") {
    return reply({ ok: false, error: "Product report not found." }, 404);
  }
  if (!canTransitionReport(report.status, nextStatus)) {
    return reply(
      {
        ok: false,
        error: "That report action is not allowed from the current status.",
        status: report.status,
      },
      409
    );
  }

  if (action === "assign") {
    const supervisorUserId = String((body as { supervisorUserId?: unknown }).supervisorUserId || "").trim();
    if (!supervisorUserId) return reply({ ok: false, error: "Supervisor is required." }, 400);
    const trusted = await dbHasSafetyRole(supervisorUserId, "Safety_Supervisor");
    if (!trusted) {
      return reply({ ok: false, error: "That user is not a trusted safety supervisor." }, 400);
    }
    await dbAssignReportToSupervisor({ reportId, supervisorUserId });
  } else if (action === "restrict_listing") {
    const product = await getSokoProductById(report.target_id);
    if (!product) return reply({ ok: false, error: "Listing not found." }, 404);
    if (product.status === "Deleted") {
      return reply({ ok: false, error: "This listing is already restricted." }, 409);
    }
    await dbIssueSokoSafetyDecision({
      reportId,
      actorUserId: auth.viewer.userId,
      actorRole: "system_admin",
      decisionType: "remove_product",
      reason: note,
      notes: note,
    });
  } else {
    await sql`UPDATE kristo_safety_reports
      SET status = ${nextStatus}, updated_at = NOW(),
          resolved_at = CASE WHEN ${nextStatus} IN ('resolved', 'dismissed') THEN NOW() ELSE resolved_at END
      WHERE id = ${reportId} AND source_type = 'soko_marketplace'`;
  }

  await sql`INSERT INTO kristo_safety_report_events
    (id, report_id, event_type, actor_user_id, actor_role, title, details)
    VALUES (
      ${`sokorevt_${randomUUID()}`},
      ${reportId},
      ${action},
      ${auth.viewer.userId},
      ${"System_Admin"},
      ${action},
      ${note}
    )`;

  if (nextStatus === "resolved" || nextStatus === "dismissed") {
    await dbSyncSnapshotOpenFlag(reportId, nextStatus);
  }

  return reply({
    ok: true,
    reportId,
    action,
    status: nextStatus,
    noteRecorded: true,
    opensBuyerProtection: false,
    mutatesPayment: false,
  });
}
