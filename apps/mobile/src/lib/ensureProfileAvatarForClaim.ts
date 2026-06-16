import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { buildAvatarDataUrl } from "@/src/lib/avatarCompress";
import { loadProfileDraft } from "@/src/lib/profileStore";
import {
  isClaimSlotDataUrlAvatar,
  isPersistableClaimSlotAvatarUri,
  sanitizePersistedClaimAvatarUri,
} from "@/src/lib/scheduleSlotUtils";

export type ProfileAvatarBeforeClaimResult = {
  uploadedUrl: string;
  hasUploadedUrl: boolean;
  source: string;
};

function pickPersistedAvatar(...candidates: unknown[]): string {
  for (const raw of candidates) {
    const sanitized = sanitizePersistedClaimAvatarUri(raw, "pre-claim-pick");
    if (sanitized && isPersistableClaimSlotAvatarUri(sanitized)) return sanitized;
  }
  return "";
}

function collectAvatarDataForUpload(args: {
  profileAvatarUri?: string;
  session?: {
    avatarUri?: string;
    avatarUrl?: string;
    profileImage?: string;
  } | null;
  draftUri?: string;
}): string {
  const draftUri = String(args.draftUri || "").trim();
  if (draftUri.startsWith("file:")) {
    return draftUri;
  }

  const dataCandidates = [
    args.profileAvatarUri,
    draftUri,
    args.session?.avatarUri,
    args.session?.avatarUrl,
    args.session?.profileImage,
  ];

  for (const raw of dataCandidates) {
    const trimmed = String(raw || "").trim();
    if (isClaimSlotDataUrlAvatar(trimmed)) return trimmed;
  }

  return "";
}

/** Upload local/data-url profile avatar before claim so backend can persist a real URL on the slot. */
export async function ensureProfileAvatarUploadedBeforeClaim(args: {
  userId: string;
  session?: {
    userId?: string;
    avatarUri?: string;
    avatarUrl?: string;
    profileImage?: string;
    churchId?: string;
    role?: string;
  } | null;
  profileAvatarUri?: string;
  memberAvatarUri?: string;
}): Promise<ProfileAvatarBeforeClaimResult> {
  const userId = String(args.userId || "").trim();
  const empty: ProfileAvatarBeforeClaimResult = {
    uploadedUrl: "",
    hasUploadedUrl: false,
    source: "none",
  };
  if (!userId) return empty;

  const existing =
    pickPersistedAvatar(
      args.profileAvatarUri,
      args.memberAvatarUri,
      args.session?.avatarUrl,
      args.session?.avatarUri,
      args.session?.profileImage
    ) || "";
  if (existing) {
    const result = {
      uploadedUrl: existing,
      hasUploadedUrl: true,
      source: "existing-persisted",
    };
    console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
      uploadedUrl: result.uploadedUrl.slice(0, 160),
      hasUploadedUrl: result.hasUploadedUrl,
      source: result.source,
    });
    return result;
  }

  const draft = await loadProfileDraft(userId);
  const draftUri = String(draft?.avatarUri || "").trim();
  const avatarSource = collectAvatarDataForUpload({
    profileAvatarUri: args.profileAvatarUri,
    session: args.session,
    draftUri,
  });

  if (!avatarSource) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId,
      reason: "no-avatar-data",
    });
    const result = { ...empty, source: "no-avatar-data" };
    console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
      uploadedUrl: "",
      hasUploadedUrl: false,
      source: result.source,
    });
    return result;
  }

  let avatarData = "";
  if (avatarSource.startsWith("file:")) {
    try {
      avatarData = await buildAvatarDataUrl(avatarSource);
    } catch (error) {
      console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
        userId,
        reason: "file-read-failed",
        error: String((error as any)?.message || error),
      });
      const result = { ...empty, source: "file-read-failed" };
      console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
        uploadedUrl: "",
        hasUploadedUrl: false,
        source: result.source,
      });
      return result;
    }
  } else {
    avatarData = avatarSource;
  }

  if (!avatarData) {
    const result = { ...empty, source: "empty-avatar-data" };
    console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
      uploadedUrl: "",
      hasUploadedUrl: false,
      source: result.source,
    });
    return result;
  }

  try {
    const res: any = await apiPost(
      "/api/auth/profile",
      { avatarData },
      {
        headers: getKristoHeaders({
          userId,
          role: (args.session?.role || "Member") as any,
          churchId: args.session?.churchId || "",
        }),
      }
    );

    if (res?.ok === false) {
      throw new Error(String(res?.error || res?.reason || "profile avatar upload failed"));
    }

    const uploaded =
      pickPersistedAvatar(
        res?.uploadedAvatarUrl,
        res?.profile?.avatarUrl,
        res?.profile?.avatarUri
      ) || "";

    if (uploaded) {
      console.log("KRISTO_PROFILE_AVATAR_URL_RESOLVED_FOR_CLAIM", {
        userId,
        source: "pre-claim-client-upload",
        avatarUrl: uploaded.slice(0, 160),
      });
      const result = {
        uploadedUrl: uploaded,
        hasUploadedUrl: true,
        source: "pre-claim-client-upload",
      };
      console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
        uploadedUrl: result.uploadedUrl.slice(0, 160),
        hasUploadedUrl: result.hasUploadedUrl,
        source: result.source,
      });
      return result;
    }

    if (res?.storageMissing) {
      console.log("KRISTO_PROFILE_AVATAR_UPLOAD_STORAGE_MISSING", {
        userId,
        stage: "pre-claim-client-upload",
      });
    } else {
      console.log("KRISTO_PROFILE_AVATAR_DATA_URL_NEEDS_UPLOAD", {
        userId,
        stage: "pre-claim-client-upload",
      });
    }

    const result = { ...empty, source: "upload-not-persisted" };
    console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
      uploadedUrl: "",
      hasUploadedUrl: false,
      source: result.source,
    });
    return result;
  } catch (error) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId,
      reason: "pre-claim-client-upload-failed",
      error: String((error as any)?.message || error),
    });
    const result = { ...empty, source: "pre-claim-client-upload-failed" };
    console.log("KRISTO_PROFILE_AVATAR_BEFORE_CLAIM_RESULT", {
      uploadedUrl: "",
      hasUploadedUrl: false,
      source: result.source,
    });
    return result;
  }
}
