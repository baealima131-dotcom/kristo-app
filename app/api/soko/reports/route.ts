import {
  NextResponse,
} from "next/server";
import type {
  NextRequest,
} from "next/server";

import {
  guard,
} from "@/app/api/_lib/rbac";
import {
  dbCreateSafetyReport,
  dbFindSafetyReportForReporterSource,
  type SafetyReportPriority,
} from "@/app/api/_lib/store/safetyReportDb";
import {
  getProfile,
} from "@/app/api/auth/_lib/profile";

const SOKO_REPORT_REASONS = [
  "Scam or fraud",
  "Counterfeit product",
  "Prohibited product",
  "Stolen product",
  "Unsafe product",
  "Misleading information",
  "Harassment",
  "Other",
] as const;

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

function reportPriority(
  reason: string
): SafetyReportPriority {
  if (
    reason === "Unsafe product" ||
    reason === "Stolen product"
  ) {
    return "critical";
  }

  if (
    reason === "Scam or fraud" ||
    reason === "Prohibited product" ||
    reason === "Harassment"
  ) {
    return "high";
  }

  if (
    reason === "Counterfeit product" ||
    reason === "Misleading information"
  ) {
    return "normal";
  }

  return "low";
}

export async function POST(
  req: NextRequest
) {
  const ctxOrRes = await guard(req);

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

  const productTitle = cleanText(
    body?.productTitle,
    240
  );

  const reason = cleanText(
    body?.reason,
    120
  );

  const details = cleanText(
    body?.details,
    2000
  );

  const sellerUserId = cleanText(
    body?.sellerUserId,
    240
  );

  const sellerKristoId = cleanText(
    body?.sellerKristoId,
    100
  ).toUpperCase();

  const sellerName = cleanText(
    body?.sellerName,
    240
  );

  const sellerAvatarUri = cleanText(
    body?.sellerAvatarUri,
    4000
  );

  const productImageUri = cleanText(
    body?.productImageUri,
    4000
  );

  const location = cleanText(
    body?.location,
    240
  );

  const price = cleanText(
    body?.price,
    100
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

  if (!productTitle) {
    return json(
      {
        ok: false,
        error:
          "productTitle required",
      },
      {
        status: 400,
      }
    );
  }

  if (
    !SOKO_REPORT_REASONS.includes(
      reason as any
    )
  ) {
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

  try {
    const existing =
      await dbFindSafetyReportForReporterSource(
        {
          reporterUserId,
          sourceType:
            "soko_marketplace",
          sourceId:
            productId,
        }
      );

    if (existing) {
      return json({
        ok: true,
        duplicate: true,
        alreadyReported: true,
        report: {
          id: existing.id,
          reportCode:
            existing.reportCode,
          status:
            existing.status,
          createdAt:
            existing.createdAt,
        },
      });
    }

    const report =
      await dbCreateSafetyReport({
        reporterUserId,
        reporterKristoId,

        reportedUserId:
          sellerUserId ||
          undefined,

        reportedKristoId:
          sellerKristoId ||
          undefined,

        churchId:
          String(
            ctxOrRes.churchId ||
              "soko-marketplace"
          ).trim(),

        sourceType:
          "soko_marketplace",

        sourceId:
          productId,

        targetType:
          "product",

        targetId:
          productId,

        targetTitle:
          productTitle,

        targetSubtitle:
          [price, location]
            .filter(Boolean)
            .join(" • "),

        targetPreview:
          details ||
          `${productTitle} reported for ${reason}`,

        targetOwnerUserId:
          sellerUserId ||
          undefined,

        targetOwnerKristoId:
          sellerKristoId ||
          undefined,

        targetOwnerName:
          sellerName ||
          undefined,

        targetOwnerAvatarUri:
          sellerAvatarUri ||
          undefined,

        targetMediaType:
          productImageUri
            ? "image"
            : undefined,

        targetThumbnailUri:
          productImageUri ||
          undefined,

        category:
          "SOKO Marketplace",

        reason,

        description:
          details ||
          `SOKO product report: ${reason}`,

        priority:
          reportPriority(reason),
      });

    console.log(
      "KRISTO_SOKO_SAFETY_REPORT_CREATED",
      {
        reportId:
          report.id,
        reportCode:
          report.reportCode,
        productId,
        reporterUserId,
        sellerUserId:
          sellerUserId || null,
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
