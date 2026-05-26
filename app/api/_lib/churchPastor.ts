import { getMembershipsForChurch } from "@/app/api/_lib/memberships";

export type ChurchPastorResolution = {
  actualChurchPastorUserId: string;
  sourceField: string;
};

export async function resolveChurchPastorUserId(
  churchId: string
): Promise<ChurchPastorResolution> {
  const cid = String(churchId || "").trim();
  if (!cid) {
    return { actualChurchPastorUserId: "", sourceField: "" };
  }

  const members = await getMembershipsForChurch(cid, "Active");
  const pastor = members.find((m) => String(m.churchRole || "") === "Pastor");
  if (pastor?.userId) {
    return {
      actualChurchPastorUserId: String(pastor.userId).trim(),
      sourceField: "membership.churchRole.Pastor",
    };
  }

  const admin = members.find((m) => String(m.churchRole || "") === "Church_Admin");
  if (admin?.userId) {
    return {
      actualChurchPastorUserId: String(admin.userId).trim(),
      sourceField: "membership.churchRole.Church_Admin",
    };
  }

  return { actualChurchPastorUserId: "", sourceField: "" };
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
