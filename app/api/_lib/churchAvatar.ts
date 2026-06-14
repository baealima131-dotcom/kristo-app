import type { ChurchProfile } from "@/app/api/_lib/churches";

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const uri = String(value || "").trim();
    if (uri) return uri;
  }
  return "";
}

export function churchAvatarUpdatedAtMs(profile: ChurchProfile | null | undefined) {
  const raw = (profile as any)?.avatarUpdatedAt ?? profile?.updatedAt ?? profile?.createdAt;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveChurchAvatarFields(profile: ChurchProfile | null | undefined) {
  const p = profile as any;
  const avatarUri = firstNonEmpty(p?.avatarUri, p?.avatarUrl, p?.profileImage, p?.profilePhoto, p?.photo, p?.image);
  const avatarUrl = firstNonEmpty(p?.avatarUrl, p?.avatarUri);
  const logoUri = firstNonEmpty(
    p?.logoUri,
    p?.churchLogoUri,
    p?.churchLogo,
    p?.logo,
    p?.churchProfileImage
  );
  const logoUrl = firstNonEmpty(p?.logoUrl, p?.churchLogoUrl, logoUri);
  const churchAvatarUri = firstNonEmpty(p?.churchAvatarUri, p?.churchAvatarUrl, avatarUri, logoUri, logoUrl);
  const churchLogoUrl = firstNonEmpty(p?.churchLogoUrl, p?.churchLogoUri, logoUrl, logoUri);

  const candidates: Array<{ source: string; uri: string }> = [];
  const push = (source: string, uri: string) => {
    if (!uri || candidates.some((c) => c.uri === uri)) return;
    candidates.push({ source, uri });
  };

  push("avatarUri", avatarUri);
  push("avatarUrl", avatarUrl);
  push("logoUri", logoUri);
  push("logoUrl", logoUrl);
  push("churchAvatarUri", churchAvatarUri);
  push("churchLogoUrl", churchLogoUrl);

  const chosen = candidates[0];
  return {
    avatarUri: avatarUri || chosen?.uri || "",
    avatarUrl: avatarUrl || avatarUri || chosen?.uri || "",
    logoUri: logoUri || "",
    logoUrl: logoUrl || "",
    churchAvatarUri: churchAvatarUri || chosen?.uri || "",
    churchLogoUrl: churchLogoUrl || "",
    finalAvatarUri: chosen?.uri || "",
    source: chosen?.source || "none",
  };
}

export function logChurchOverviewGetAvatar(churchId: string, profile: ChurchProfile | null | undefined) {
  const fields = resolveChurchAvatarFields(profile);
  console.log("KRISTO_CHURCH_OVERVIEW_GET_AVATAR", {
    churchId,
    avatarUri: fields.avatarUri,
    avatarUrl: fields.avatarUrl,
    logoUri: fields.logoUri,
    logoUrl: fields.logoUrl,
    finalAvatarUri: fields.finalAvatarUri,
    source: fields.source,
  });
  return fields;
}
