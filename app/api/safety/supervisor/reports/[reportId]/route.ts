import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  dbHasSafetyRole,
} from "@/app/api/_lib/store/safetyDb";

import {
  resolveLegacyDirectMessageTargetUserId,
} from "@/app/api/_lib/safetyDirectMessageIdentity";

import {
  getProfile,
  getProfileByUserCode,
} from "@/app/api/auth/_lib/profile";

import {
  deleteFeedItemById,
  getFeedItemById,
} from "@/app/api/_lib/store/feedDb";

import {
  deleteEngagementForPost,
  findFeedCommentById,
} from "@/app/api/_lib/store/feedCommentDb";

import {
  dbAssignReportToAgent,
  dbGetSafetyAgentDashboard,
  dbGetSafetyCaseIntelligence,
  dbGetSafetySupervisorDashboard,
  dbHasActiveSafetyAgentRelationship,
  dbIssueSafetyReportDecision,
  dbGetSafetyTargetReportStats,
  dbGetSafetyTargetRiskAssessment,
  dbMarkSafetyReportEnforcementPending,
  dbRecordRemoveContentReconciliation,
} from "@/app/api/_lib/store/safetyReportDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function firstText(
  ...values: unknown[]
) {
  for (const value of values) {
    const text =
      String(value || "")
        .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function firstArrayValue(
  value: unknown
) {
  if (!Array.isArray(value)) {
    return "";
  }

  for (const row of value) {
    if (
      typeof row === "string" &&
      row.trim()
    ) {
      return row.trim();
    }

    if (
      row &&
      typeof row === "object"
    ) {
      const uri =
        firstText(
          (row as any).uri,
          (row as any).url,
          (row as any).mediaUri,
          (row as any).imageUrl
        );

      if (uri) {
        return uri;
      }
    }
  }

  return "";
}

function resolveProfileName(
  profile: any
) {
  return firstText(
    profile?.fullName,
    profile?.displayName,
    profile?.name,
    profile?.username,
    profile?.userCode
  );
}

function resolveProfileKristoId(
  profile: any
) {
  return firstText(
    profile?.userCode,
    profile?.kristoId,
    profile?.publicKristoId
  ).toUpperCase();
}

function resolveProfileAvatar(
  profile: any
) {
  return firstText(
    profile?.avatarUri,
    profile?.avatarUrl,
    profile?.photoURL,
    profile?.photoUrl,
    profile?.profileImageUri,
    profile?.profileImageUrl,
    profile?.imageUri
  );
}

function resolveProfileChurchName(
  profile: any
) {
  return firstText(
    profile?.churchName,
    profile?.activeChurchName,
    profile?.church?.name
  );
}

async function resolveSafetyProfile(
  userId: unknown,
  kristoId: unknown
) {
  const uid =
    String(userId || "")
      .trim();

  const kid =
    String(kristoId || "")
      .trim()
      .toUpperCase();

  let profile: any = null;

  if (uid) {
    profile =
      await getProfile(uid)
        .catch(() => null);
  }

  if (!profile && kid) {
    profile =
      await getProfileByUserCode(
        kid
      ).catch(() => null);
  }

  return profile;
}

function resolveFeedText(
  item: any
) {
  return firstText(
    item?.text,
    item?.caption,
    item?.description,
    item?.body,
    item?.content,
    item?.message,
    item?.postText,
    item?.announcementText,
    item?.testimonyText,
    item?.prayerRequestText,
    item?.summary,
    item?.title
  );
}

function resolveFeedTitle(
  item: any
) {
  return firstText(
    item?.title,
    item?.headline,
    item?.postTitle,
    item?.mediaTitle,
    item?.announcementTitle,
    item?.caption,
    item?.text
  );
}

function resolveFeedOwnerUserId(
  item: any
) {
  return firstText(
    item?.createdBy,
    item?.createdByUserId,
    item?.authorUserId,
    item?.ownerUserId,
    item?.publisherUserId,
    item?.postedByUserId,
    item?.actorUserId,
    item?.profileUserId,
    item?.userId,

    item?.owner?.userId,
    item?.author?.userId,
    item?.actor?.userId,
    item?.profile?.userId,

    item?.mediaOwnerPastorUserId,
    item?.actualChurchPastorUserId,
    item?.churchPastorUserId,
    item?.scheduleCreatedByUserId
  );
}

function resolveFeedOwnerName(
  item: any
) {
  return firstText(
    item?.churchMediaName,
    item?.mediaName,

    item?.authorName,
    item?.ownerName,
    item?.createdByName,
    item?.postedByName,
    item?.publisherName,
    item?.actorLabel,
    item?.actorName,
    item?.profileName,
    item?.displayName,

    item?.owner?.fullName,
    item?.owner?.displayName,
    item?.owner?.name,

    item?.author?.fullName,
    item?.author?.displayName,
    item?.author?.name,

    item?.actor?.fullName,
    item?.actor?.displayName,
    item?.actor?.name,

    item?.profile?.fullName,
    item?.profile?.displayName,
    item?.profile?.name,

    item?.churchName,
    item?.churchLabel
  );
}

function resolveFeedOwnerKristoId(
  item: any
) {
  return firstText(
    item?.authorKristoId,
    item?.ownerKristoId,
    item?.createdByKristoId,
    item?.postedByKristoId,
    item?.publisherKristoId,
    item?.actorKristoId,
    item?.profileKristoId,
    item?.kristoId,
    item?.userCode,

    item?.owner?.kristoId,
    item?.owner?.userCode,

    item?.author?.kristoId,
    item?.author?.userCode,

    item?.actor?.kristoId,
    item?.actor?.userCode,

    item?.profile?.kristoId,
    item?.profile?.userCode
  ).toUpperCase();
}

function resolveFeedOwnerAvatar(
  item: any
) {
  const media =
    item?.media &&
    typeof item.media === "object" &&
    !Array.isArray(item.media)
      ? item.media
      : null;

  return firstText(
    item?.authorAvatarUri,
    item?.actorAvatarUri,
    item?.profileAvatarUri,
    item?.publisherAvatarUri,
    item?.postedByAvatarUri,
    item?.ownerAvatarUri,
    item?.createdByAvatarUri,

    item?.mediaAvatarUri,
    item?.mediaLogoUrl,
    item?.mediaLogo,

    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.churchAvatar,
    item?.ownerChurchAvatarUri,
    item?.churchLogoUri,
    item?.churchLogoUrl,

    item?.avatarUri,
    item?.avatarUrl,

    item?.church?.avatarUri,
    item?.church?.avatarUrl,

    item?.owner?.avatarUri,
    item?.owner?.avatarUrl,

    item?.author?.avatarUri,
    item?.author?.avatarUrl,

    item?.actor?.avatarUri,
    item?.actor?.avatarUrl,

    item?.profile?.avatarUri,
    item?.profile?.avatarUrl,

    media?.avatarUri,
    media?.avatarUrl,
    media?.churchAvatarUri,
    media?.churchAvatarUrl
  );
}

function resolveFeedVideoUri(
  item: any
) {
  const media =
    item?.media &&
    typeof item.media === "object" &&
    !Array.isArray(item.media)
      ? item.media
      : null;

  return firstText(
    item?.videoUrl,
    item?.videoUri,
    item?.remoteVideoUrl,
    item?.playbackUrl,
    item?.streamUrl,
    item?.sourceVideoUrl,

    item?.mediaType === "video"
      ? item?.mediaUri
      : "",

    item?.type === "video"
      ? item?.mediaUri
      : "",

    media?.videoUrl,
    media?.videoUri,
    media?.playbackUrl,
    media?.uri
  );
}

function resolveFeedImageUri(
  item: any
) {
  const media =
    item?.media &&
    typeof item.media === "object" &&
    !Array.isArray(item.media)
      ? item.media
      : null;

  return firstText(
    item?.imageUrl,
    item?.imageUri,
    item?.photoUrl,
    item?.photoUri,
    item?.coverImageUri,
    item?.coverImageUrl,

    item?.mediaType === "image"
      ? item?.mediaUri
      : "",

    item?.type === "post" &&
    !resolveFeedVideoUri(item)
      ? item?.mediaUri
      : "",

    firstArrayValue(
      item?.images
    ),

    firstArrayValue(
      item?.imageUrls
    ),

    firstArrayValue(
      item?.attachments
    ),

    firstArrayValue(
      item?.mediaUrls
    ),

    Array.isArray(item?.media)
      ? firstArrayValue(
          item.media
        )
      : "",

    media?.imageUrl,
    media?.imageUri,
    media?.uri
  );
}

function resolveFeedThumbnail(
  item: any
) {
  const media =
    item?.media &&
    typeof item.media === "object" &&
    !Array.isArray(item.media)
      ? item.media
      : null;

  return firstText(
    item?.thumbnailUri,
    item?.thumbnailUrl,
    item?.posterUri,
    item?.videoPosterUri,
    item?.mediaPosterUri,
    item?.mediaThumbnailUri,
    item?.brandedPoster,
    item?.generatedPosterUrl,

    item?.imageUrl,
    item?.imageUri,

    firstArrayValue(
      item?.images
    ),

    firstArrayValue(
      item?.imageUrls
    ),

    firstArrayValue(
      item?.attachments
    ),

    media?.thumbnailUri,
    media?.thumbnailUrl,
    media?.posterUri,
    media?.videoPosterUri,
    media?.imageUri,
    media?.imageUrl
  );
}

function resolveFeedMediaType(
  item: any
):
  | "video"
  | "image"
  | "audio"
  | "text" {
  const explicit =
    String(
      item?.mediaType ||
      item?.type ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    explicit === "video" ||
    resolveFeedVideoUri(item)
  ) {
    return "video";
  }

  if (
    explicit === "image" ||
    resolveFeedImageUri(item)
  ) {
    return "image";
  }

  if (
    explicit === "audio" ||
    firstText(
      item?.audioUri,
      item?.audioUrl
    )
  ) {
    return "audio";
  }

  return "text";
}

async function hydrateSafetyCaseReport(
  report: any
) {
  const [
    reporterProfile,
    targetReportStats,
    targetRiskAssessment,
  ] = await Promise.all([
    resolveSafetyProfile(
      report?.reporterUserId,
      report?.reporterKristoId
    ),

    dbGetSafetyTargetReportStats({
      targetType:
        report?.targetType,
      targetId:
        report?.targetId,
      sourceType:
        report?.sourceType,
      sourceId:
        report?.sourceId,
    }).catch(() => null),

    dbGetSafetyTargetRiskAssessment({
      targetType:
        report?.targetType,
      targetId:
        report?.targetId,
      sourceType:
        report?.sourceType,
      sourceId:
        report?.sourceId,
      currentReporterUserId:
        report?.reporterUserId,
    }).catch(() => null),
  ]);

  const originalPostId =
    firstText(
      report?.targetType ===
        "comment"
        ? report?.sourceRoomId
        : "",
      report?.sourceId,
      report?.targetId
    );

  const commentId =
    report?.targetType ===
      "comment"
      ? firstText(
          report?.sourceMessageId,
          report?.targetId,
          report?.sourceId
        )
      : "";

  const [
    feedItem,
    comment,
  ] = await Promise.all([
    originalPostId
      ? getFeedItemById(
          originalPostId
        ).catch(() => null)
      : Promise.resolve(null),

    commentId
      ? findFeedCommentById(
          commentId
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  /*
   * Feed payloads and older comment rows contain
   * additional backwards-compatible fields that are
   * intentionally not part of their narrow TS interfaces.
   */
  const liveFeedItem: any =
    feedItem as any;

  const liveComment: any =
    comment as any;

  /*
   * Older direct-message reports may not contain
   * reportedUserId/targetOwnerUserId. Recover the
   * reported peer from the durable DM room identity.
   */
  console.log(
    "KRISTO_DM_LEGACY_REPORT_IDENTITY_INPUT",
    {
      reportId:
        report?.id || null,
      sourceType:
        report?.sourceType || null,
      sourceId:
        report?.sourceId || null,
      sourceRoomId:
        report?.sourceRoomId || null,
      sourceMessageId:
        report?.sourceMessageId || null,
      targetId:
        report?.targetId || null,
      reporterUserId:
        report?.reporterUserId || null,
      reportedUserId:
        report?.reportedUserId || null,
      targetOwnerUserId:
        report?.targetOwnerUserId || null,
    }
  );

  const directMessageOwnerUserId =
    resolveLegacyDirectMessageTargetUserId(
      report
    );

  const liveOwnerUserId =
    firstText(
      directMessageOwnerUserId,
      liveComment?.authorUserId,
      liveComment?.authorId,
      liveComment?.userId,
      liveComment?.createdBy,
      resolveFeedOwnerUserId(
        liveFeedItem
      ),
      report?.targetOwnerUserId,
      report?.reportedUserId
    );

  const liveOwnerKristoId =
    firstText(
      liveComment?.authorKristoId,
      liveComment?.kristoId,
      liveComment?.userCode,
      liveComment?.author?.kristoId,
      liveComment?.author?.userCode,
      resolveFeedOwnerKristoId(
        liveFeedItem
      ),
      report?.targetOwnerKristoId,
      report?.reportedKristoId
    );

  const targetOwnerProfile =
    await resolveSafetyProfile(
      liveOwnerUserId,
      liveOwnerKristoId
    );

  const commentText =
    firstText(
      liveComment?.text,
      liveComment?.body,
      liveComment?.content,
      liveComment?.message,
      liveComment?.comment
    );

  const feedText =
    resolveFeedText(
      liveFeedItem
    );

  const livePreview =
    report?.targetType ===
      "comment"
      ? firstText(
          commentText,
          report?.targetPreview
        )
      : firstText(
          feedText,
          report?.targetPreview
        );

  const mediaType =
    report?.targetType ===
      "comment"
      ? "text"
      : resolveFeedMediaType(
          liveFeedItem
        );

  const videoUri =
    resolveFeedVideoUri(
      liveFeedItem
    );

  const imageUri =
    resolveFeedImageUri(
      liveFeedItem
    );

  const audioUri =
    firstText(
      feedItem?.audioUri,
      feedItem?.audioUrl,
      feedItem?.mediaType ===
        "audio"
        ? feedItem?.mediaUri
        : ""
    );

  const mediaUri =
    mediaType === "video"
      ? videoUri
      : mediaType === "image"
        ? imageUri
        : mediaType === "audio"
          ? audioUri
          : "";

  const resolvedTargetTitle =
    report?.targetType === "comment"
      ? firstText("Reported comment", report?.targetTitle)
      : firstText(
          resolveFeedTitle(liveFeedItem),
          resolveFeedText(liveFeedItem),
          report?.targetTitle,
          "Reported post"
        );

  const resolvedThumbnailUri =
    firstText(
      resolveFeedThumbnail(liveFeedItem),
      report?.targetThumbnailUri
    ) || undefined;

  const intelligenceReportId =
    firstText(report?.id) || null;
  const intelligenceReporterUserId =
    firstText(report?.reporterUserId) || null;
  const intelligenceTargetUserId =
    firstText(
      liveOwnerUserId,
      report?.targetOwnerUserId,
      report?.reportedUserId
    ) || null;

  /*
   * Case Intelligence is required on every report-detail GET.
   * Forensic logs prove whether the DB function is entered.
   */
  console.log("KRISTO_CASE_BEFORE_INTELLIGENCE_CALL", {
    reportId: intelligenceReportId,
    reporterUserId: intelligenceReporterUserId,
    targetUserId: intelligenceTargetUserId,
    hasDbFn:
      typeof dbGetSafetyCaseIntelligence === "function",
    dbFnName:
      typeof dbGetSafetyCaseIntelligence === "function"
        ? dbGetSafetyCaseIntelligence.name ||
          "dbGetSafetyCaseIntelligence"
        : null,
  });

  console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_INPUT", {
    reportId: intelligenceReportId,
    reporterUserId: intelligenceReporterUserId,
    targetUserId: intelligenceTargetUserId,
    stage: "hydrate_route_before_call",
    hasDbFn:
      typeof dbGetSafetyCaseIntelligence === "function",
  });

  let caseIntelligence: Awaited<
    ReturnType<typeof dbGetSafetyCaseIntelligence>
  >;

  try {
    if (typeof dbGetSafetyCaseIntelligence !== "function") {
      throw new Error(
        "dbGetSafetyCaseIntelligence is not a function"
      );
    }

    caseIntelligence = await dbGetSafetyCaseIntelligence({
      report: {
        ...report,
        targetOwnerUserId:
          liveOwnerUserId || report?.targetOwnerUserId,
        reportedUserId:
          liveOwnerUserId || report?.reportedUserId,
        targetPreview: livePreview || report?.targetPreview,
        targetTitle: resolvedTargetTitle,
        targetThumbnailUri: resolvedThumbnailUri,
        targetMediaType: mediaType || report?.targetMediaType,
      },
      originalContentAvailable: Boolean(feedItem || comment),
      hasMediaUri: Boolean(mediaUri),
    });

    console.log("KRISTO_CASE_AFTER_INTELLIGENCE_CALL", {
      reportId: intelligenceReportId,
      reporterUserId: intelligenceReporterUserId,
      targetUserId: intelligenceTargetUserId,
      status: caseIntelligence?.status ?? null,
      hasCaseIntelligence: Boolean(caseIntelligence),
      credibilityScore:
        caseIntelligence?.reporter?.credibilityScore ?? null,
      targetRiskScore:
        caseIntelligence?.target?.riskScore ?? null,
      evidenceStrengthScore:
        caseIntelligence?.evidence?.strengthScore ?? null,
      caseRiskScore:
        caseIntelligence?.assessment?.caseRiskScore ?? null,
      confidence:
        caseIntelligence?.assessment?.confidence ?? null,
      recommendation:
        caseIntelligence?.assessment?.recommendation ?? null,
    });

    console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_READY", {
      reportId: intelligenceReportId,
      reporterUserId: intelligenceReporterUserId,
      targetUserId: intelligenceTargetUserId,
      status: caseIntelligence?.status ?? null,
      analysisMode: caseIntelligence?.analysisMode ?? null,
      caseRiskScore:
        caseIntelligence?.assessment?.caseRiskScore ?? null,
      recommendation:
        caseIntelligence?.assessment?.recommendation ?? null,
      confidence:
        caseIntelligence?.assessment?.confidence ?? null,
    });
  } catch (error: any) {
    console.log("KRISTO_CASE_AFTER_INTELLIGENCE_CALL", {
      reportId: intelligenceReportId,
      reporterUserId: intelligenceReporterUserId,
      targetUserId: intelligenceTargetUserId,
      status: "error",
      hasCaseIntelligence: false,
      error: String(
        error?.message || "hydrate_case_intelligence_failed"
      ),
    });
    console.log("KRISTO_SAFETY_CASE_INTELLIGENCE_FAILED", {
      reportId: intelligenceReportId,
      reporterUserId: intelligenceReporterUserId,
      targetUserId: intelligenceTargetUserId,
      stage: "hydrate_route",
      error: String(
        error?.message || "hydrate_case_intelligence_failed"
      ),
      stack: String(error?.stack || "") || null,
    });

    caseIntelligence = {
      status: "error",
      analysisMode: "heuristic",
      generatedAt: new Date().toISOString(),
      dataQuality: {
        reporterHistoryAvailable: false,
        targetHistoryAvailable: false,
        evidenceVerified: false,
        finalizedReporterCases: 0,
        finalizedTargetCases: 0,
        limitations: [
          String(
            error?.message || "hydrate_case_intelligence_failed"
          ),
        ],
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
        activeReports: 0,
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
        limitations: [
          String(
            error?.message || "hydrate_case_intelligence_failed"
          ),
        ],
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
      timelines: {
        target: {
          firstReportAt: null,
          lastReportAt: null,
          previousWarnings: 0,
          previousSuspensions: 0,
          previousRestrictions: 0,
          previousRemovals: 0,
          previousPermanentBans: 0,
          confirmedViolations: 0,
          noViolationDismissals: 0,
          repeatedCategories: [],
          trend: {
            reports7d: 0,
            reports30d: 0,
            reports90d: 0,
            lifetime: 0,
            direction: "insufficient_data",
          },
          enforcementHistory: [],
        },
        reporter: {
          lifetimeReports: 0,
          confirmedReports: 0,
          dismissedReports: 0,
          maliciousReports: 0,
          accuracyProgression: [],
          repeatedTargetingPattern: [],
          reports: [],
        },
      },
    };
  }

  /*
   * Legacy weighted-signal fields remain for older clients.
   * Case Intelligence is the decision-support source of truth.
   * Missing/failed legacy assessment → available=false (no fabricated scores).
   */
  const intelligenceAvailable =
    Boolean(
      targetRiskAssessment?.available
    ) &&
    typeof targetRiskAssessment?.weightedScore ===
      "number" &&
    Number.isFinite(
      targetRiskAssessment.weightedScore
    );

  const normalizedTargetReportCount =
    targetReportStats
      ? Number(
          targetReportStats.totalReports || 0
        ) || 0
      : intelligenceAvailable
        ? Number(
            targetRiskAssessment?.totalReports ||
              0
          ) || 0
        : null;

  const normalizedUniqueReporterCount =
    targetReportStats
      ? Number(
          targetReportStats.uniqueReporters ||
            0
        ) || 0
      : intelligenceAvailable
        ? Number(
            targetRiskAssessment?.uniqueReporters ||
              0
          ) || 0
        : null;

  const safeWeightedScore =
    intelligenceAvailable
      ? Math.min(
          10,
          Math.round(
            Number(
              targetRiskAssessment!
                .weightedScore
            ) * 100
          ) / 100
        )
      : null;

  const safeWeightedPercent =
    intelligenceAvailable &&
    safeWeightedScore !== null
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              safeWeightedScore * 10
            )
          )
        )
      : null;

  const safeActionThreshold =
    Number(
      targetRiskAssessment?.actionThreshold
    ) || 4.9;

  const safeActionRequired =
    intelligenceAvailable &&
    safeWeightedScore !== null
      ? safeWeightedScore >=
        safeActionThreshold
      : false;

  const safeSignalLevel =
    !intelligenceAvailable
      ? "calculating"
      : safeActionRequired
        ? "action_required"
        : (safeWeightedScore || 0) >= 3
          ? "review"
          : (safeWeightedScore || 0) >= 1.5
            ? "monitor"
            : "low";

  const safeReportRecommendation =
    !intelligenceAvailable
      ? "calculating"
      : safeActionRequired
        ? "agent_action_required"
        : (safeWeightedScore || 0) >= 3
          ? "review_evidence"
          : "monitor";

  const hydrated: Record<string, any> = {
    ...report,

    reporterDisplayName:
      firstText(
        resolveProfileName(
          reporterProfile
        ),
        report?.reporterKristoId,
        "Unknown reporter"
      ),

    reporterAvatarUri:
      resolveProfileAvatar(
        reporterProfile
      ) || undefined,

    reporterChurchName:
      resolveProfileChurchName(
        reporterProfile
      ) || undefined,

    reporterKristoId:
      firstText(
        resolveProfileKristoId(
          reporterProfile
        ),
        report?.reporterKristoId
      ).toUpperCase(),

    targetOwnerUserId:
      liveOwnerUserId ||
      report?.targetOwnerUserId,

    targetOwnerKristoId:
      firstText(
        resolveProfileKristoId(
          targetOwnerProfile
        ),
        liveOwnerKristoId,
        report?.targetOwnerKristoId,
        report?.reportedKristoId
      ).toUpperCase() ||
      undefined,

    targetOwnerName:
      firstText(
        resolveProfileName(
          targetOwnerProfile
        ),
        liveComment?.authorName,
        liveComment?.displayName,
        liveComment?.author?.fullName,
        liveComment?.author?.displayName,
        liveComment?.author?.name,
        resolveFeedOwnerName(
          liveFeedItem
        ),
        report?.targetOwnerName
      ) || undefined,

    targetOwnerAvatarUri:
      firstText(
        resolveProfileAvatar(
          targetOwnerProfile
        ),
        liveComment?.authorAvatarUri,
        liveComment?.avatarUri,
        liveComment?.author?.avatarUri,
        liveComment?.author?.avatarUrl,
        resolveFeedOwnerAvatar(
          liveFeedItem
        ),
        report?.targetOwnerAvatarUri
      ) || undefined,

    targetTitle:
      report?.targetType ===
        "comment"
        ? firstText(
            "Reported comment",
            report?.targetTitle
          )
        : firstText(
            resolveFeedTitle(
              liveFeedItem
            ),
            resolveFeedText(
              liveFeedItem
            ),
            report?.targetTitle,
            "Reported post"
          ),

    targetSubtitle:
      firstText(
        resolveProfileKristoId(
          targetOwnerProfile
        ),
        resolveProfileName(
          targetOwnerProfile
        ),
        report?.targetSubtitle,
        report?.targetId
      ) || undefined,

    targetPreview:
      livePreview ||
      report?.targetPreview,

    targetMediaType:
      mediaType ||
      report?.targetMediaType,

    targetMediaUri:
      mediaUri ||
      undefined,

    targetThumbnailUri:
      firstText(
        resolveFeedThumbnail(
          liveFeedItem
        ),
        report?.targetThumbnailUri
      ) || undefined,

    targetCreatedAt:
      firstText(
        liveComment?.createdAt,
        liveComment?.publishedAt,
        liveFeedItem?.createdAt,
        liveFeedItem?.publishedAt
      ) || undefined,

    targetChurchName:
      firstText(
        feedItem?.churchName,
        feedItem?.churchLabel,
        feedItem?.mediaChurchName,
        feedItem?.authorChurchName,
        feedItem?.ownerChurchName,
        liveFeedItem?.church?.name,
        liveFeedItem?.media?.churchName,
        feedItem?.mediaName,
        resolveProfileChurchName(
          targetOwnerProfile
        )
      ) || undefined,

    originalContentAvailable:
      Boolean(
        feedItem ||
        comment
      ),

    targetReportCount:
      normalizedTargetReportCount,

    targetUniqueReporterCount:
      normalizedUniqueReporterCount,

    targetActiveReportCount:
      Number(
        targetReportStats
          ?.activeReports || 0
      ),

    targetEscalatedReportCount:
      Number(
        targetReportStats
          ?.escalatedReports || 0
      ),

    targetResolvedReportCount:
      Number(
        targetReportStats
          ?.resolvedReports || 0
      ),

    targetDismissedReportCount:
      Number(
        targetReportStats
          ?.dismissedReports || 0
      ),

    reporterLifetimeReportCount:
      caseIntelligence?.reporter?.lifetimeReports ??
      null,

    /*
     * Legacy weighted-signal fields are kept only for
     * backward-compatible clients. Investigation Center and
     * Case Intelligence must not read these for decisions.
     */
    legacySignals: {
      aiIntelligenceAvailable: intelligenceAvailable,
      aiWeightedReportScore: safeWeightedScore,
      aiWeightedReportPercent: safeWeightedPercent,
      aiActionThreshold: safeActionThreshold,
      aiActionRequired: safeActionRequired,
      aiSignalLevel: safeSignalLevel,
      aiReportRecommendation: safeReportRecommendation,
      reporterVoteWeightPercent: intelligenceAvailable
        ? targetRiskAssessment
            ?.currentReporterVoteWeightPercent ?? null
        : null,
    },
  };

  // Attach last so spread/helpers cannot overwrite Case Intelligence.
  hydrated.caseIntelligence = caseIntelligence;

  console.log(
    "KRISTO_SAFETY_CASE_HYDRATED",
    {
      reportId:
        hydrated.id,
      reportCode:
        hydrated.reportCode,
      caseIntelligenceAttached: Boolean(
        hydrated.caseIntelligence
      ),
      reporterResolved:
        Boolean(
          reporterProfile
        ),
      targetResolved:
        Boolean(
          feedItem ||
          comment
        ),
      ownerResolved:
        Boolean(
          targetOwnerProfile ||
          hydrated.targetOwnerName ||
          hydrated.targetOwnerAvatarUri
        ),
      ownerUserId:
        hydrated.targetOwnerUserId ||
        null,
      ownerName:
        hydrated.targetOwnerName ||
        null,
      ownerKristoId:
        hydrated.targetOwnerKristoId ||
        null,
      hasOwnerAvatar:
        Boolean(
          hydrated.targetOwnerAvatarUri
        ),
      targetType:
        hydrated.targetType,
      targetMediaType:
        hydrated.targetMediaType,
      hasMedia:
        Boolean(
          hydrated.targetMediaUri ||
          hydrated.targetThumbnailUri
        ),
      targetReportCount:
        hydrated.targetReportCount,
      targetUniqueReporterCount:
        hydrated
          .targetUniqueReporterCount,
      targetActiveReportCount:
        hydrated
          .targetActiveReportCount,
      caseIntelligenceStatus:
        hydrated.caseIntelligence?.status,
      caseRiskScore:
        hydrated.caseIntelligence?.assessment
          ?.caseRiskScore,
      caseRecommendation:
        hydrated.caseIntelligence?.assessment
          ?.recommendation,
      hasLegacySignals: Boolean(hydrated.legacySignals),
    }
  );

  return hydrated;
}

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{
      reportId: string;
    }>;
  }
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  const viewerUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  if (!viewerUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You must be signed in.",
      },
      {
        status: 401,
      }
    );
  }

  const params =
    await context.params;

  const reportId =
    decodeURIComponent(
      String(
        params?.reportId || ""
      )
    ).trim();

  if (!reportId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety report ID is required.",
      },
      {
        status: 400,
      }
    );
  }

  console.log("KRISTO_SAFETY_CASE_GET", {
    reportId,
    viewerUserId,
  });

  const [
    isSupervisor,
    isActiveAgent,
  ] = await Promise.all([
    dbHasSafetyRole(
      viewerUserId,
      "Safety_Supervisor"
    ),

    dbHasActiveSafetyAgentRelationship(
      viewerUserId
    ),
  ]);

  if (
    !isSupervisor &&
    !isActiveAgent
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety case access required.",
      },
      {
        status: 403,
      }
    );
  }

  if (isSupervisor) {
    const dashboard =
      await dbGetSafetySupervisorDashboard(
        viewerUserId
      );

    const report =
      dashboard.reports.find(
        (row) =>
          String(
            row.id || ""
          ).trim() ===
          reportId
      );

    if (!report) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Report was not found or is not assigned to this supervisor.",
        },
        {
          status: 404,
        }
      );
    }

    const hydratedReport =
      await hydrateSafetyCaseReport(
        report
      );

    console.log("KRISTO_SAFETY_CASE_RESPONSE", {
      reportId,
      viewerMode: "supervisor",
      hasCaseIntelligence: Boolean(
        hydratedReport?.caseIntelligence
      ),
      status:
        hydratedReport?.caseIntelligence?.status ??
        null,
      caseRiskScore:
        hydratedReport?.caseIntelligence?.assessment
          ?.caseRiskScore ?? null,
      recommendation:
        hydratedReport?.caseIntelligence?.assessment
          ?.recommendation ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        viewerMode:
          "supervisor",
        permissions: {
          canInvestigate: true,
          canAssignAgent: true,
          canEscalate: true,
          canResolve: true,
        },
        report:
          hydratedReport,
        agents:
          dashboard.agents,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  }

  const dashboard =
    await dbGetSafetyAgentDashboard(
      viewerUserId
    );

  const report =
    dashboard.reports.find(
      (row) =>
        String(
          row.id || ""
        ).trim() ===
          reportId &&
        String(
          row.assignedAgentUserId ||
            ""
        ).trim() ===
          viewerUserId
    );

  if (!report) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This case is not assigned to your Safety Agent account.",
      },
      {
        status: 403,
      }
    );
  }

  const hydratedReport =
    await hydrateSafetyCaseReport(
      report
    );

  console.log(
    "KRISTO_SAFETY_AGENT_CASE_OPENED",
    {
      reportId,
      reportCode:
        report.reportCode,
      agentUserId:
        viewerUserId,
    }
  );

  console.log("KRISTO_SAFETY_CASE_RESPONSE", {
    reportId,
    viewerMode: "agent",
    hasCaseIntelligence: Boolean(
      hydratedReport?.caseIntelligence
    ),
    status:
      hydratedReport?.caseIntelligence?.status ?? null,
    caseRiskScore:
      hydratedReport?.caseIntelligence?.assessment
        ?.caseRiskScore ?? null,
    recommendation:
      hydratedReport?.caseIntelligence?.assessment
        ?.recommendation ?? null,
  });

  return NextResponse.json(
    {
      ok: true,
      viewerMode:
        "agent",
      permissions: {
        canInvestigate: true,
        canAssignAgent: false,
        canEscalate: true,
        canResolve: true,
      },
      report:
        hydratedReport,
      agents: [],
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(
  req: NextRequest,
  context: {
    params: Promise<{
      reportId: string;
    }>;
  }
) {
  const auth =
    await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const supervisorUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  const allowed =
    await dbHasSafetyRole(
      supervisorUserId,
      "Safety_Supervisor"
    );

  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety Supervisor access required.",
      },
      {
        status: 403,
      }
    );
  }

  const params =
    await context.params;

  const reportId =
    decodeURIComponent(
      String(
        params?.reportId || ""
      )
    ).trim();

  const body =
    await req.json().catch(
      () => ({})
    );

  const agentUserId =
    String(
      body?.agentUserId || ""
    ).trim();

  if (!reportId || !agentUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Report ID and Agent user ID are required.",
      },
      {
        status: 400,
      }
    );
  }

  const dashboard =
    await dbGetSafetySupervisorDashboard(
      supervisorUserId
    );

  const report =
    dashboard.reports.find(
      (row) =>
        String(row.id || "").trim() ===
        reportId
    );

  if (!report) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Report was not found or is not assigned to this supervisor.",
      },
      {
        status: 404,
      }
    );
  }

  if (
    report.status === "resolved" ||
    report.status === "dismissed"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Completed reports cannot be reassigned.",
      },
      {
        status: 409,
      }
    );
  }

  const agent =
    dashboard.agents.find(
      (row) =>
        row.userId ===
          agentUserId &&
        row.status ===
          "active"
    );

  if (!agent) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Choose an active Safety Agent from your team.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const assignedReport =
      await dbAssignReportToAgent({
        reportId,
        supervisorUserId,
        agentUserId,
      });

    const refreshedDashboard =
      await dbGetSafetySupervisorDashboard(
        supervisorUserId
      );

    console.log(
      "KRISTO_SAFETY_REPORT_ASSIGNED_TO_AGENT",
      {
        reportId,
        reportCode:
          assignedReport.reportCode,
        supervisorUserId,
        agentUserId,
        agentKristoId:
          agent.kristoId,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        report:
          refreshedDashboard.reports.find(
            (row) =>
              row.id === reportId
          ) || assignedReport,
        agents:
          refreshedDashboard.agents,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not assign this report."
        ),
      },
      {
        status: 400,
      }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: {
    params: Promise<{
      reportId: string;
    }>;
  }
) {
  const auth =
    await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  const viewerUserId =
    String(
      auth.viewer.userId || ""
    ).trim();

  const params =
    await context.params;

  const reportId =
    decodeURIComponent(
      String(
        params?.reportId || ""
      )
    ).trim();

  const body =
    await req.json().catch(
      () => ({})
    );

  if (
    String(
      body?.action || ""
    )
      .trim()
      .toLowerCase() !==
    "issue_decision"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unsupported Safety case action.",
      },
      {
        status: 400,
      }
    );
  }

  const [
    isSupervisor,
    isActiveAgent,
  ] = await Promise.all([
    dbHasSafetyRole(
      viewerUserId,
      "Safety_Supervisor"
    ),

    dbHasActiveSafetyAgentRelationship(
      viewerUserId
    ),
  ]);

  if (
    !isSupervisor &&
    !isActiveAgent
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Safety case access required.",
      },
      {
        status: 403,
      }
    );
  }

  const actorRole =
    isSupervisor
      ? "supervisor"
      : "agent";

  try {
    const dashboard =
      isSupervisor
        ? await dbGetSafetySupervisorDashboard(
            viewerUserId
          )
        : await dbGetSafetyAgentDashboard(
            viewerUserId
          );

    const currentReport =
      dashboard.reports.find(
        (row) =>
          String(
            row.id || ""
          ).trim() === reportId
      );

    if (!currentReport) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This case is not available to your Safety account.",
        },
        {
          status: 404,
        }
      );
    }

    const decisionType =
      String(
        body?.decisionType || ""
      )
        .trim()
        .toLowerCase();

    const explicitTargetUserId =
      String(
        currentReport
          .targetOwnerUserId ||
        currentReport.reportedUserId ||
        ""
      ).trim();

    const legacyDirectMessageTargetUserId =
      resolveLegacyDirectMessageTargetUserId(
        currentReport
      );

    const targetUserId =
      explicitTargetUserId ||
      legacyDirectMessageTargetUserId;

    let targetKristoId =
      String(
        currentReport
          .targetOwnerKristoId ||
        currentReport.reportedKristoId ||
        ""
      )
        .trim()
        .toUpperCase();

    /*
     * When identity was recovered from the legacy DM room,
     * resolve the canonical Kristo ID from the target profile
     * exactly as the owner-profile resolution does elsewhere.
     */
    if (
      !targetKristoId &&
      targetUserId &&
      targetUserId ===
        legacyDirectMessageTargetUserId
    ) {
      const recoveredTargetProfile =
        await resolveSafetyProfile(
          targetUserId,
          ""
        );

      targetKristoId =
        resolveProfileKristoId(
          recoveredTargetProfile
        );
    }

    const targetType =
      String(
        currentReport.targetType || ""
      )
        .trim()
        .toLowerCase();

    const targetPostId =
      String(
        currentReport.sourceId ||
        currentReport.targetId ||
        ""
      ).trim();

    let enforcement:
      | {
          type: string;
          applied: boolean;
          message: string;
          enforcementId?: string;
          expiresAt?: string;
        }
      | undefined;

    if (
      decisionType ===
        "remove_content"
    ) {
      const supportedContent =
        targetType === "post" ||
        targetType === "image" ||
        targetType === "video" ||
        targetType === "media" ||
        targetType === "content";

      if (
        !supportedContent ||
        !targetPostId
      ) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Remove Content currently supports feed posts, images and videos only.",
          },
          {
            status: 409,
          }
        );
      }

      const original =
        await getFeedItemById(
          targetPostId
        ).catch(
          () => null
        );

      if (!original) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "The original content is already unavailable.",
          },
          {
            status: 409,
          }
        );
      }

      /*
       * Content must be removed before the decision
       * is durable. A failed deletion must not leave
       * a resolved case with content still online.
       */
      await deleteEngagementForPost(
        targetPostId
      );

      const deleted =
        await deleteFeedItemById(
          targetPostId
        );

      if (!deleted) {
        const stillPresent =
          await getFeedItemById(
            targetPostId
          ).catch(
            () => null
          );

        if (!stillPresent) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "The original content is already unavailable.",
            },
            {
              status: 409,
            }
          );
        }

        return NextResponse.json(
          {
            ok: false,
            error:
              "The original content could not be removed. No decision was recorded.",
          },
          {
            status: 500,
          }
        );
      }

      /*
       * Content is gone. Mark the case so operators
       * can see the brief cross-store window before
       * the durable decision lands.
       */
      await dbMarkSafetyReportEnforcementPending(
        reportId
      ).catch(() => undefined);

      enforcement = {
        type:
          "remove_content",
        applied: true,
        message:
          "The original feed content and its engagement were removed.",
      };
    }

    const accountDecision =
      decisionType === "warning" ||
      decisionType ===
        "restrict_account" ||
      decisionType ===
        "suspend_account" ||
      decisionType ===
        "permanent_ban";

    console.log(
      "KRISTO_SAFETY_DECISION_TARGET_RESOLUTION",
      {
        reportId,
        sourceType:
          String(
            currentReport.sourceType || ""
          )
            .trim()
            .toLowerCase(),
        explicitTargetUserId:
          explicitTargetUserId || null,
        legacyDirectMessageTargetUserId:
          legacyDirectMessageTargetUserId ||
          null,
        resolvedTargetUserId:
          targetUserId || null,
        sourceRoomId:
          firstText(
            currentReport.sourceRoomId,
            currentReport.sourceId
          ) || null,
        reporterUserId:
          firstText(
            currentReport.reporterUserId
          ) || null,
      }
    );

    if (
      accountDecision &&
      !targetUserId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The reported account identity could not be resolved.",
        },
        {
          status: 409,
        }
      );
    }

    /*
     * Decision + account enforcement + audit event
     * commit atomically. For remove_content, deletion
     * already succeeded above so closing the case is safe.
     * If the decision write fails after deletion, record
     * durable reconciliation instead of leaving a silent gap.
     */
    let decisionResult;

    try {
      decisionResult =
        await dbIssueSafetyReportDecision({
          reportId,
          actorUserId:
            viewerUserId,
          actorRole,
          decisionType:
            body?.decisionType,
          reason:
            body?.reason,
          notes:
            body?.notes,
          confidence:
            body?.confidence,
          durationDays:
            body?.durationDays,
          accountEnforcement:
            accountDecision
              ? {
                  userId:
                    targetUserId,
                  kristoId:
                    targetKristoId,
                  enforcementType:
                    decisionType as
                      | "warning"
                      | "restrict_account"
                      | "suspend_account"
                      | "permanent_ban",
                }
              : undefined,
        });
    } catch (decisionError: any) {
      if (
        decisionType ===
          "remove_content" &&
        enforcement?.type ===
          "remove_content" &&
        enforcement.applied
      ) {
        const recon =
          await dbRecordRemoveContentReconciliation(
            {
              reportId,
              targetPostId,
              actorUserId:
                viewerUserId,
              actorRole,
              reason:
                String(
                  body?.reason || ""
                ),
              notes:
                body?.notes
                  ? String(body.notes)
                  : undefined,
              confidence:
                body?.confidence,
              errorMessage: String(
                decisionError?.message ||
                  decisionError ||
                  "Decision persistence failed after content deletion."
              ),
            }
          );

        return NextResponse.json(
          {
            ok: false,
            error:
              "Content was removed but the Safety decision could not be saved. Recovery has been queued.",
            details: {
              code:
                "SAFETY_RECOVERY_REQUIRED",
              reportId,
              reconciliationId:
                recon.id,
              status:
                "recovery_required",
            },
          },
          {
            status: 500,
          }
        );
      }

      throw decisionError;
    }

    const report =
      decisionResult.report;

    if (
      decisionResult.enforcement
    ) {
      const record =
        decisionResult.enforcement;

      enforcement = {
        type:
          record.enforcementType,
        applied: true,
        message:
          record.enforcementType ===
            "warning"
            ? "A durable Safety warning was added."
            : record.enforcementType ===
                "restrict_account"
              ? "The account was restricted."
              : record.enforcementType ===
                  "suspend_account"
                ? "The account was suspended."
                : "The account was permanently banned.",
        enforcementId:
          record.id,
        expiresAt:
          record.expiresAt,
      };
    }

    if (
      decisionType ===
        "no_violation"
    ) {
      enforcement = {
        type:
          "no_violation",
        applied: true,
        message:
          "The report was dismissed with no violation.",
      };
    }

    if (
      decisionType === "escalate"
    ) {
      enforcement = {
        type:
          "escalate",
        applied: true,
        message:
          "The case was escalated to the Safety Supervisor.",
      };
    }

    console.log(
      JSON.stringify({
        scope: "kristo_safety",
        event: "decision_issued",
        reportId:
          report.id,
        reportCode:
          report.reportCode,
        decisionType:
          report.decisionType,
        actorUserId:
          viewerUserId,
        actorRole,
        targetUserId:
          targetUserId || null,
        targetPostId:
          targetPostId || null,
        enforcementId:
          enforcement?.enforcementId ||
          null,
        at: new Date().toISOString(),
      })
    );

    if (enforcement?.applied) {
      console.log(
        JSON.stringify({
          scope: "kristo_safety",
          event: "enforcement_applied",
          reportId:
            report.id,
          reportCode:
            report.reportCode,
          enforcementType:
            enforcement.type,
          enforcementId:
            enforcement.enforcementId ||
            null,
          expiresAt:
            enforcement.expiresAt ||
            null,
          targetUserId:
            targetUserId || null,
          at: new Date().toISOString(),
        })
      );
    }

    return NextResponse.json(
      {
        ok: true,
        report,
        enforcement,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    const rawMessage =
      String(
        error?.message ||
        "Could not issue this decision."
      );

    const escalatedAgentLock =
      rawMessage.includes(
        "SAFETY_ESCALATED_AWAITING_SUPERVISOR"
      );

    const message =
      escalatedAgentLock
        ? "This escalated case awaits Supervisor review. Agents cannot issue another decision."
        : rawMessage;

    const forbidden =
      escalatedAgentLock ||
      message.includes(
        "not assigned"
      ) ||
      message.includes(
        "Supervisor approval"
      );

    const conflict =
      message.includes(
        "already has a final decision"
      );

    return NextResponse.json(
      {
        ok: false,
        error: message,
        ...(escalatedAgentLock
          ? {
              details: {
                code:
                  "SAFETY_ESCALATED_AWAITING_SUPERVISOR",
              },
            }
          : {}),
      },
      {
        status:
          forbidden
            ? 403
            : conflict
              ? 409
              : 400,
      }
    );
  }
}
