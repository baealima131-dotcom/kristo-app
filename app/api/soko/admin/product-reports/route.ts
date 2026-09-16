import { NextRequest, NextResponse } from "next/server";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "@/app/api/_lib/store/authDb";
import { ensureSokoEngagementSchema } from "@/app/api/_lib/store/sokoEngagementDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;
  await ensureSokoEngagementSchema();
  const url = getDatabaseUrl();
  if (!url) return reply({ ok: false, error: "Database unavailable." }, 503);
  const sql = neon(url);
  const rows = (await sql`SELECT r.id, r.report_code, r.status, r.priority, r.reason,
      r.created_at, r.reporter_user_id, r.reporter_kristo_id,
      r.reported_user_id, r.reported_kristo_id, r.target_title, r.target_thumbnail_uri,
      s.snapshot
    FROM kristo_safety_reports r
    LEFT JOIN soko_product_report_snapshots s ON s.report_id = r.id
    WHERE r.source_type = 'soko_marketplace' AND r.target_type = 'product'
    ORDER BY r.created_at DESC
    LIMIT 40`) as Array<Record<string, unknown>>;

  const reports = await Promise.all(
    rows.map(async (row) => {
      const reporter = await getProfile(String(row.reporter_user_id || "")).catch(() => null);
      const seller = await getProfile(String(row.reported_user_id || "")).catch(() => null);
      const snapshot = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : null;
      return {
        id: row.id,
        reportCode: row.report_code,
        status: row.status,
        priority: row.priority,
        reason: row.reason,
        createdAt: row.created_at,
        productTitle: (snapshot as { title?: string } | null)?.title || row.target_title || "",
        productImage: (snapshot as { image?: string } | null)?.image || row.target_thumbnail_uri || "",
        reporter: {
          userId: row.reporter_user_id,
          displayName: reporter?.fullName || null,
          kristoId: reporter?.userCode || row.reporter_kristo_id || null,
        },
        seller: {
          userId: row.reported_user_id,
          displayName: seller?.fullName || null,
          kristoId: seller?.userCode || row.reported_kristo_id || null,
        },
        snapshot,
      };
    })
  );
  return reply({ ok: true, reports });
}
