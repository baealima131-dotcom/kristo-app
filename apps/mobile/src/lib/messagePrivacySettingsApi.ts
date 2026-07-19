import { apiGet, apiPatch } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  DEFAULT_MESSAGE_PRIVACY_SETTINGS,
  type MessagePrivacySettingsPatch,
  type MessagePrivacySettingsV1,
} from "@/src/lib/messagePrivacySettingsTypes";

function authHeaders() {
  return getKristoHeaders();
}

function normalizeSettings(raw: any): MessagePrivacySettingsV1 {
  return {
    ...DEFAULT_MESSAGE_PRIVACY_SETTINGS,
    ...(raw && typeof raw === "object" ? raw : {}),
    version: 1,
    updatedAt: Number(raw?.updatedAt || 0),
  } as MessagePrivacySettingsV1;
}

export async function fetchMessagePrivacySettings(): Promise<MessagePrivacySettingsV1> {
  const res: any = await apiGet("/api/auth/message-privacy-settings", {
    headers: authHeaders(),
  });
  if (!res?.ok || !res?.data) {
    throw new Error(String(res?.error || "Could not load message settings."));
  }
  return normalizeSettings(res.data);
}

export async function patchMessagePrivacySettings(
  patch: MessagePrivacySettingsPatch
): Promise<MessagePrivacySettingsV1> {
  const res: any = await apiPatch(
    "/api/auth/message-privacy-settings",
    patch,
    { headers: authHeaders() }
  );
  if (!res?.ok || !res?.data) {
    const detail = Array.isArray(res?.details)
      ? res.details.map((d: any) => d?.message).filter(Boolean).join(" ")
      : "";
    throw new Error(
      String(detail || res?.error || "Could not save message settings.")
    );
  }
  return normalizeSettings(res.data);
}
