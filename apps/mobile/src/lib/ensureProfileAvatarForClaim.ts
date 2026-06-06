import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { buildAvatarDataUrl } from "@/src/lib/avatarCompress";
import { loadProfileDraft } from "@/src/lib/profileStore";
import {
  isClaimSlotDataUrlAvatar,
  isPersistableClaimSlotAvatarUri,
  sanitizePersistedClaimAvatarUri,
} from "@/src/lib/scheduleSlotUtils";

function pickPersistedAvatar(...candidates: unknown[]): string {
  for (const raw of candidates) {
    const sanitized = sanitizePersistedClaimAvatarUri(raw, "pre-claim-pick");
    if (sanitized && isPersistableClaimSlotAvatarUri(sanitized)) return sanitized;
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
}): Promise<string> {
  const userId = String(args.userId || "").trim();
  if (!userId) return "";

  const existing =
    pickPersistedAvatar(
      args.profileAvatarUri,
      args.session?.avatarUrl,
      args.session?.avatarUri,
      args.session?.profileImage
    ) || "";
  if (existing) return existing;

  const draft = await loadProfileDraft(userId);
  const draftUri = String(draft?.avatarUri || "").trim();

  let avatarData = "";
  if (draftUri.startsWith("file:")) {
    try {
      avatarData = await buildAvatarDataUrl(draftUri);
    } catch {
      avatarData = "";
    }
  } else if (isClaimSlotDataUrlAvatar(draftUri)) {
    avatarData = draftUri;
  } else if (isClaimSlotDataUrlAvatar(args.session?.avatarUri)) {
    avatarData = String(args.session?.avatarUri || "").trim();
  } else if (isClaimSlotDataUrlAvatar(args.session?.avatarUrl)) {
    avatarData = String(args.session?.avatarUrl || "").trim();
  }

  if (!avatarData) return "";

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

    const uploaded = pickPersistedAvatar(res?.profile?.avatarUrl, res?.profile?.avatarUri);
    if (uploaded) {
      console.log("KRISTO_PROFILE_AVATAR_URL_RESOLVED_FOR_CLAIM", {
        userId,
        source: "pre-claim-client-upload",
        avatarUrl: uploaded.slice(0, 160),
      });
    } else {
      console.log("KRISTO_PROFILE_AVATAR_DATA_URL_NEEDS_UPLOAD", {
        userId,
        stage: "pre-claim-client-upload",
      });
    }
    return uploaded;
  } catch (error) {
    console.log("KRISTO_PROFILE_AVATAR_UPLOAD_MISSING_FOR_CLAIM", {
      userId,
      reason: "pre-claim-client-upload-failed",
      error: String((error as any)?.message || error),
    });
    return "";
  }
}
