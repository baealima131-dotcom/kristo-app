import { apiGet } from "@/src/lib/kristoApi";

export type ChurchPastorResolution = {
  actualChurchPastorUserId: string;
  sourceField: string;
};

function pickPastorFromMembers(items: any[]): ChurchPastorResolution {
  const pastor = items.find(
    (m) => String(m?.role || m?.churchRole || "").trim() === "Pastor"
  );
  if (pastor?.userId) {
    return {
      actualChurchPastorUserId: String(pastor.userId).trim(),
      sourceField: "membership.churchRole.Pastor",
    };
  }

  const admin = items.find(
    (m) => String(m?.role || m?.churchRole || "").trim() === "Church_Admin"
  );
  if (admin?.userId) {
    return {
      actualChurchPastorUserId: String(admin.userId).trim(),
      sourceField: "membership.churchRole.Church_Admin",
    };
  }

  return { actualChurchPastorUserId: "", sourceField: "" };
}

export async function fetchChurchPastorUserId(
  churchId: string,
  headers?: Record<string, string>
): Promise<ChurchPastorResolution> {
  const cid = String(churchId || "").trim();
  if (!cid) {
    return { actualChurchPastorUserId: "", sourceField: "" };
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
    return { actualChurchPastorUserId: "", sourceField: "" };
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
