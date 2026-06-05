import { readMinistryJsonFile as readJsonFile } from "@/app/api/_lib/store/ministryDb";

export type MinistryMemberRole = "Leader" | "Assistant" | "Host" | "Member";

type MinistryMemberRow = {
  churchId: string;
  ministryId: string;
  userId: string;
  role: MinistryMemberRole;
};

const STORE_FILE = "ministry-members.json";

export function isPastorAppRole(role: unknown) {
  const r = String(role || "").trim();
  return r === "Pastor" || r === "Church_Admin" || r === "System_Admin";
}

export async function getMinistryMemberRole(
  churchId: string,
  ministryId: string,
  userId: string
): Promise<MinistryMemberRole | ""> {
  const all = await readJsonFile<MinistryMemberRow[]>(STORE_FILE, []);
  const row = all.find(
    (mm) =>
      String(mm.churchId || "") === String(churchId || "") &&
      String(mm.ministryId || "") === String(ministryId || "") &&
      String(mm.userId || "") === String(userId || "")
  );
  return row?.role || "";
}

export async function listMinistryLeaderUserIds(churchId: string, ministryId: string) {
  const all = await readJsonFile<MinistryMemberRow[]>(STORE_FILE, []);
  return all
    .filter(
      (mm) =>
        String(mm.churchId || "") === churchId &&
        String(mm.ministryId || "") === ministryId &&
        (mm.role === "Leader" || mm.role === "Assistant")
    )
    .map((mm) => String(mm.userId || ""))
    .filter(Boolean);
}

export function assertLeaderCanAssignRole(args: {
  viewerAppRole: string;
  viewerMinistryRole: MinistryMemberRole | "";
  nextRole: MinistryMemberRole;
}) {
  if (isPastorAppRole(args.viewerAppRole)) return null;

  if (args.viewerMinistryRole === "Host") {
    return "Hosts cannot manage ministry members";
  }

  if (args.viewerMinistryRole !== "Leader" && args.viewerAppRole !== "Leader") {
    return "Forbidden (role)";
  }

  if (args.nextRole === "Leader" || args.nextRole === "Assistant") {
    return "Only Pastor can promote to Leader";
  }

  if (args.nextRole !== "Host" && args.nextRole !== "Member") {
    return "Leaders can only assign Host or Member roles";
  }

  return null;
}

export function assertLeaderCanModifyTarget(args: {
  viewerAppRole: string;
  viewerMinistryRole: MinistryMemberRole | "";
  targetRole: MinistryMemberRole;
  targetUserId: string;
  viewerUserId: string;
}) {
  if (isPastorAppRole(args.viewerAppRole)) return null;
  if (args.viewerMinistryRole === "Host") return "Hosts cannot manage ministry members";

  if (args.targetRole === "Leader" && args.targetUserId !== args.viewerUserId) {
    return "Leaders cannot modify another Leader";
  }

  if (args.targetRole === "Assistant" && args.targetUserId !== args.viewerUserId) {
    return "Leaders cannot modify another Leader";
  }

  return assertLeaderCanAssignRole({
    viewerAppRole: args.viewerAppRole,
    viewerMinistryRole: args.viewerMinistryRole,
    nextRole: args.targetRole,
  });
}

export async function canCreateOrEditScheduleSlots(args: {
  churchId: string;
  viewerUserId: string;
  viewerAppRole: string;
  ministryId?: string;
  isMediaSchedule?: boolean;
  isMediaHost?: boolean;
}) {
  if (isPastorAppRole(args.viewerAppRole)) return true;

  if (args.isMediaSchedule && args.isMediaHost) return true;

  const ministryId = String(args.ministryId || "").trim();
  if (!ministryId) return false;

  const role = await getMinistryMemberRole(args.churchId, ministryId, args.viewerUserId);
  return role === "Leader" || role === "Assistant" || role === "Host";
}
