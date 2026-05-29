export type LiveMediaAuthorityInput = {
  currentUserId?: string;
  actualChurchPastorUserId?: string;
  churchPastorUserId?: string;
  scheduleCreatedByUserId?: string;
  createdByUserId?: string;
  createdBy?: string;
  mediaHostIds?: string | string[];
  backendLivePastorUserId?: string;
};

export type LiveMediaAuthority = {
  actualChurchPastorUserId: string;
  scheduleCreatedByUserId: string;
  mediaHostIds: string[];
  isActualChurchPastor: boolean;
  isMediaScheduleCreator: boolean;
  isMediaHost: boolean;
  isMediaOwnerHost: boolean;
};

export function parseMediaHostIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function resolveActualChurchPastorUserId(input: LiveMediaAuthorityInput): string {
  return String(
    input.actualChurchPastorUserId ||
    input.churchPastorUserId ||
    input.backendLivePastorUserId ||
    ""
  ).trim();
}

export function resolveScheduleCreatedByUserId(input: LiveMediaAuthorityInput): string {
  return String(
    input.scheduleCreatedByUserId ||
    input.createdByUserId ||
    ""
  ).trim();
}

export function evaluateLiveMediaAuthority(
  input: LiveMediaAuthorityInput
): LiveMediaAuthority {
  const currentUserId = String(input.currentUserId || "").trim();
  const actualChurchPastorUserId = resolveActualChurchPastorUserId(input);
  const scheduleCreatedByUserId = resolveScheduleCreatedByUserId(input);
  const mediaHostIds = parseMediaHostIds(input.mediaHostIds);

  const isActualChurchPastor =
    !!currentUserId && actualChurchPastorUserId === currentUserId;
  const isMediaScheduleCreator =
    !!currentUserId && scheduleCreatedByUserId === currentUserId;
  const isMediaHost =
    !!currentUserId && mediaHostIds.includes(currentUserId);
  const isMediaOwnerHost =
    isActualChurchPastor || isMediaScheduleCreator || isMediaHost;

  return {
    actualChurchPastorUserId,
    scheduleCreatedByUserId,
    mediaHostIds,
    isActualChurchPastor,
    isMediaScheduleCreator,
    isMediaHost,
    isMediaOwnerHost,
  };
}

export function logLiveMediaAuthority(
  context: string,
  authority: LiveMediaAuthority,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_LIVE_AUTHORITY_SPLIT", {
    context,
    actualChurchPastorUserId: authority.actualChurchPastorUserId,
    scheduleCreatedByUserId: authority.scheduleCreatedByUserId,
    mediaHostIds: authority.mediaHostIds,
    isActualChurchPastor: authority.isActualChurchPastor,
    isMediaScheduleCreator: authority.isMediaScheduleCreator,
    isMediaHost: authority.isMediaHost,
    isMediaOwnerHost: authority.isMediaOwnerHost,
    ...extra,
  });

  if (authority.isActualChurchPastor) {
    console.log("KRISTO_ACTUAL_PASTOR_HOST", { context, ...extra });
  }
  if (authority.isMediaScheduleCreator) {
    console.log("KRISTO_MEDIA_SCHEDULE_CREATOR", { context, ...extra });
  }
  if (authority.isMediaHost) {
    console.log("KRISTO_MEDIA_HOST_AUTHORITY", { context, ...extra });
  }
}

export function extractLiveMediaAuthorityFromRecord(record: Record<string, any> | null | undefined) {
  const item = record || {};
  return {
    actualChurchPastorUserId: String(
      item.actualChurchPastorUserId || item.churchPastorUserId || ""
    ).trim(),
    scheduleCreatedByUserId: String(
      item.scheduleCreatedByUserId || item.createdByUserId || ""
    ).trim(),
    mediaHostIds: String(item.mediaHostIds || item.hostIds || "").trim(),
  };
}

export function buildLiveRoomAuthorityParams(record: Record<string, any> | null | undefined) {
  const fields = extractLiveMediaAuthorityFromRecord(record);
  return {
    actualChurchPastorUserId: fields.actualChurchPastorUserId,
    churchPastorUserId: fields.actualChurchPastorUserId,
    scheduleCreatedByUserId: fields.scheduleCreatedByUserId,
    mediaHostIds: fields.mediaHostIds,
    pastorUserId: fields.actualChurchPastorUserId,
  };
}
