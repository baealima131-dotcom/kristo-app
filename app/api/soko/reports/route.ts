import { randomUUID } from "node:crypto";
import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guardCheckoutAuth,
} from "@/app/api/_lib/rbac";
import {
  dbCreateSafetyReport,
  type SafetyReportPriority,
} from "@/app/api/_lib/store/safetyReportDb";
import {
  getProfile,
} from "@/app/api/auth/_lib/profile";
import {
  canonicalProductReportReason,
  cleanReportDetails,
  productReportReasonCode,
  RATE_LIMITS,
  reportPriority as priorityForReason,
} from "@/app/api/_lib/sokoEngagementPolicy";
import {
  dbClaimOpenProductReport,
  dbConsumeEngagementRateLimit,
  dbEnsureProductReportOpenedEvent,
  dbReadOpenProductReportSlot,
} from "@/app/api/_lib/store/sokoEngagementDb";
import {
  getSokoProductById,
} from "@/app/api/_lib/store/sokoProductsDb";

function json(
  data: unknown,
  init?: ResponseInit
) {
  return NextResponse.json(
    data,
    init
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

export async function POST(
  req: NextRequest
) {
  const ctxOrRes = await guardCheckoutAuth(req);

  if (
    ctxOrRes instanceof NextResponse
  ) {
    return ctxOrRes;
  }

  let body: any = {};

  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const productId = cleanText(
    body?.productId,
    300
  );

  const reason = canonicalProductReportReason(
    body?.reason
  );

  const details = cleanReportDetails(
    body?.details
  );

  if (!productId) {
    return json(
      {
        ok: false,
        error: "productId required",
      },
      {
        status: 400,
      }
    );
  }

  if (!reason) {
    return json(
      {
        ok: false,
        error:
          "Choose a valid SOKO report reason.",
      },
      {
        status: 400,
      }
    );
  }

  const reporterUserId =
    String(
      ctxOrRes.viewer.userId || ""
    ).trim();

  const reporterProfile =
    await getProfile(
      reporterUserId
    );

  const reporterKristoId =
    String(
      reporterProfile?.userCode || ""
    )
      .trim()
      .toUpperCase();

  if (!reporterKristoId) {
    return json(
      {
        ok: false,
        error:
          "Your KRISTO ID could not be verified.",
      },
      {
        status: 400,
      }
    );
  }

  const product = await getSokoProductById(productId);
  if (!product) {
    return json(
      { ok: false, error: "Product not found." },
      { status: 404 }
    );
  }

  const reasonCode = productReportReasonCode(reason);
  if (!reasonCode) {
    return json({ ok: false, error: "Choose a valid SOKO report reason." }, { status: 400 });
  }
  const sellerUserId = product.sellerUserId;
  const sellerProfile = sellerUserId
    ? await getProfile(sellerUserId)
    : null;
  const sellerKristoId = String(
    sellerProfile?.userCode || ""
  ).trim().toUpperCase();
  const sellerName = String(
    sellerProfile?.fullName || ""
  ).trim();
  const productTitle = String(product.title || "").trim();
  const price = `${String(product.currency || "").trim()} ${String(product.price ?? "")}`.trim();
  const image = String(product.image || "").trim();
  const snapshot = {
    productId,
    title: productTitle,
    image,
    sellerUserId,
    price,
    currency: String(product.currency || ""),
    listingStatus: String(product.status || ""),
    reportedAt: new Date().toISOString(),
  };

  try {
    const existing = await dbReadOpenProductReportSlot({
      reporterUserId,
      productId,
      reasonCode,
    });
    if (existing?.kind === "canonical") {
      await dbEnsureProductReportOpenedEvent({
        reportId: existing.report.id,
        actorUserId: reporterUserId,
        details: details || reason,
      });
      return json({
        ok: true,
        duplicate: true,
        alreadyReported: true,
        report: existing.report,
      });
    }

    let reportId = existing?.kind === "resume" ? existing.reportId : "";
    if (!reportId) {
      const userLimited = await dbConsumeEngagementRateLimit(
        `report:user:${reporterUserId}`,
        RATE_LIMITS.reportUserHour.limit,
        RATE_LIMITS.reportUserHour.windowMs
      );
      const productLimited = await dbConsumeEngagementRateLimit(
        `report:product:${reporterUserId}:${productId}`,
        RATE_LIMITS.reportProductHour.limit,
        RATE_LIMITS.reportProductHour.windowMs
      );
      if (!userLimited.allowed || !productLimited.allowed) {
        return json(
          { ok: false, error: "Too many reports. Please wait before reporting again." },
          { status: 429 }
        );
      }
      reportId = `sokorpt_${randomUUID()}`;
      const claim = await dbClaimOpenProductReport({
        reportId,
        productId,
        reporterUserId,
        reason,
        reasonCode,
        snapshot,
      });
      if (!claim.created) {
        reportId = claim.reportId;
        if (claim.kind === "canonical" && claim.report) {
          await dbEnsureProductReportOpenedEvent({
            reportId,
            actorUserId: reporterUserId,
            details: details || reason,
          });
          return json({
            ok: true,
            duplicate: true,
            alreadyReported: true,
            report: claim.report,
          });
        }
      }
    }

    const report =
      await dbCreateSafetyReport({
        id: reportId,
        reporterUserId,
        reporterKristoId,
        reportedUserId: sellerUserId || undefined,
        reportedKristoId: sellerKristoId || undefined,
        churchId: "soko-marketplace",
        sourceType: "soko_marketplace",
        sourceId: productId,
        targetType: "product",
        targetId: productId,
        targetTitle: productTitle,
        targetSubtitle: price,
        targetPreview: details || `${productTitle} reported for ${reason}`,
        targetOwnerUserId: sellerUserId || undefined,
        targetOwnerKristoId: sellerKristoId || undefined,
        targetOwnerName: sellerName || undefined,
        targetMediaType: image ? "image" : undefined,
        targetThumbnailUri: image || undefined,
        category: "SOKO_PRODUCT",
        reason,
        description: details || `SOKO product report: ${reason}`,
        priority: priorityForReason(reason) as SafetyReportPriority,
      });

    await dbEnsureProductReportOpenedEvent({
      reportId: report.id,
      actorUserId: reporterUserId,
      details: details || reason,
    });

    console.log(
      "KRISTO_SOKO_SAFETY_REPORT_CREATED",
      {
        reportId: report.id,
        reportCode: report.reportCode,
        productId,
        reporterUserId,
        sellerUserId: sellerUserId || null,
      }
    );

    return json({
      ok: true,
      duplicate: false,
      report: {
        id:
          report.id,
        reportCode:
          report.reportCode,
        status:
          report.status,
        createdAt:
          report.createdAt,
      },
    });
  } catch (error: any) {
    const resumed = await dbReadOpenProductReportSlot({
      reporterUserId,
      productId,
      reasonCode,
    }).catch(() => null);
    if (resumed?.kind === "canonical") {
      await dbEnsureProductReportOpenedEvent({
        reportId: resumed.report.id,
        actorUserId: reporterUserId,
        details: details || reason,
      }).catch(() => undefined);
      return json({
        ok: true,
        duplicate: true,
        alreadyReported: true,
        report: resumed.report,
      });
    }
    const message =
      String(
        error?.message ||
          "SOKO report failed."
      );

    console.error(
      "[soko/reports] POST failed",
      error
    );

    return json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
