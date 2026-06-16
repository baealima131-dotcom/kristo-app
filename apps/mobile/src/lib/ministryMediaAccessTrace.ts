export type MinistryMediaAccessSaveLog = {
  ministryId?: string | null;
  churchId?: string | null;
  mediaAccess?: boolean;
  payloadSent?: unknown;
  payloadStored?: unknown;
  phase?: "request" | "response" | "persist";
  source?: string;
};

export type MinistryMediaAccessLoadLog = {
  ministryId?: string | null;
  churchId?: string | null;
  mediaAccess?: boolean;
  payloadStored?: unknown;
  source?: string;
  count?: number;
};

export function logMinistryMediaAccessSave(args: MinistryMediaAccessSaveLog) {
  console.log("KRISTO_MINISTRY_MEDIA_ACCESS_SAVE", {
    ministryId: String(args.ministryId || "").trim() || null,
    churchId: String(args.churchId || "").trim() || null,
    mediaAccess: args.mediaAccess === true,
    payloadSent: args.payloadSent ?? null,
    payloadStored: args.payloadStored ?? null,
    phase: args.phase || "response",
    source: args.source || null,
  });
}

export function logMinistryMediaAccessLoad(args: MinistryMediaAccessLoadLog) {
  console.log("KRISTO_MINISTRY_MEDIA_ACCESS_LOAD", {
    ministryId: String(args.ministryId || "").trim() || null,
    churchId: String(args.churchId || "").trim() || null,
    mediaAccess: args.mediaAccess === true,
    payloadStored: args.payloadStored ?? null,
    source: args.source || null,
    count: typeof args.count === "number" ? args.count : undefined,
  });
}

export function evaluateMinistryMediaAccessPermission(args: {
  ministryId: string;
  churchId?: string;
  mediaAccess?: boolean;
  churchSubscriptionActive?: boolean | null;
  ministryRole?: string;
  source: string;
}) {
  const mediaAccess = args.mediaAccess === true;
  const role = String(args.ministryRole || "").trim().toLowerCase();
  const isLeaderOrPastor =
    role.includes("pastor") ||
    role.includes("leader") ||
    role.includes("admin") ||
    role.includes("assistant");
  const subscriptionActive = args.churchSubscriptionActive === true;

  const permissionResult = {
    ministryMediaEnabled: mediaAccess,
    appearsInMediaAssignment: mediaAccess,
    assignmentRoomEligible: mediaAccess,
    mediaStudioMinistryEligible: mediaAccess && subscriptionActive,
    ministryToolsEligible: mediaAccess && isLeaderOrPastor,
    churchSubscriptionActive: subscriptionActive,
  };

  console.log("KRISTO_MINISTRY_MEDIA_ACCESS_PERMISSION", {
    ministryId: String(args.ministryId || "").trim() || null,
    churchId: String(args.churchId || "").trim() || null,
    mediaAccess,
    permissionResult,
    source: args.source,
  });

  return permissionResult;
}
