import { apiGet } from "@/src/lib/kristoApi";

export type ChurchPastorResolution = {
  actualChurchPastorUserId: string;
  sourceField: string;
};

export type ChurchPastorProfile = ChurchPastorResolution & {
  pastorName: string;
  pastorAvatarUrl: string;
};

function pickPastorFromMembers(items: any[]): ChurchPastorProfile {
  const pastor = items.find(
    (m) => String(m?.role || m?.churchRole || m?.roleLabel || "").trim() === "Pastor"
  );
  if (pastor?.userId) {
    return {
      actualChurchPastorUserId: String(pastor.userId).trim(),
      sourceField: "membership.churchRole.Pastor",
      pastorName: String(pastor?.name || pastor?.displayName || "Pastor").trim(),
      pastorAvatarUrl: String(pastor?.avatarUrl || pastor?.avatar || "").trim(),
    };
  }

  const admin = items.find(
    (m) => String(m?.role || m?.churchRole || m?.roleLabel || "").trim() === "Church_Admin"
  );
  if (admin?.userId) {
    return {
      actualChurchPastorUserId: String(admin.userId).trim(),
      sourceField: "membership.churchRole.Church_Admin",
      pastorName: String(admin?.name || admin?.displayName || "Church Admin").trim(),
      pastorAvatarUrl: String(admin?.avatarUrl || admin?.avatar || "").trim(),
    };
  }

  return {
    actualChurchPastorUserId: "",
    sourceField: "",
    pastorName: "",
    pastorAvatarUrl: "",
  };
}

export async function fetchChurchPastorUserId(
  churchId: string,
  headers?: Record<string, string>
): Promise<ChurchPastorResolution> {
  const profile = await fetchChurchPastorProfile(churchId, headers);
  return {
    actualChurchPastorUserId: profile.actualChurchPastorUserId,
    sourceField: profile.sourceField,
  };
}

export async function fetchChurchPastorProfile(
  churchId: string,
  headers?: Record<string, string>
): Promise<ChurchPastorProfile> {
  const cid = String(churchId || "").trim();
  if (!cid) {
    return {
      actualChurchPastorUserId: "",
      sourceField: "",
      pastorName: "",
      pastorAvatarUrl: "",
    };
  }

  try {
    const res: any = await apiGet("/api/church/members", {
      headers,
      cache: "no-store" as RequestCache,
    });

    const items = Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.data)
          ? res.data
          : [];

    return pickPastorFromMembers(items);
  } catch {
    return {
      actualChurchPastorUserId: "",
      sourceField: "",
      pastorName: "",
      pastorAvatarUrl: "",
    };
  }
}

export function logChurchPastorResolution(params: {
  churchId: string;
  actualChurchPastorUserId: string;
  sourceField: string;
  scheduleCreatedByUserId?: string;
  currentUserId?: string;
}) {
  console.log("KRISTO_CHURCH_PASTOR_RESOLUTION", {
    churchId: params.churchId,
    actualChurchPastorUserId: params.actualChurchPastorUserId,
    sourceField: params.sourceField,
    scheduleCreatedByUserId: String(params.scheduleCreatedByUserId || ""),
    currentUserId: String(params.currentUserId || ""),
  });
}
