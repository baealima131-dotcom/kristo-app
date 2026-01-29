// app/(app)/dashboard/church/roles/_lib/roles.types.ts

export type RoleId =
  | "youth_leader"
  | "choir_leader"
  | "women_leader"
  | "prayer_leader"
  | "usher_leader"
  | "media_leader"
  | "secretary"
  | "treasurer"
  | "evangelism_leader";

export type RoleTier = "Member" | "Leader" | "Admin";

export type Permission =
  | "VIEW_DASHBOARD"
  | "MANAGE_MEMBERS"
  | "ASSIGN_TASKS"
  | "VIEW_REPORTS"
  | "POST_ANNOUNCEMENTS"
  | "MANAGE_EVENTS"
  | "MANAGE_ATTENDANCE"
  | "MANAGE_FINANCE";

export type RoleDefinition = {
  id: RoleId;
  name: string; // label shown in UI
  tier: RoleTier;
  description: string;
  icon: string; // emoji/icon for now
  dashboardPath: string; // route to role dashboard
  permissions: Permission[];
};

export type RoleAssignmentStatus = "Active" | "Suspended" | "Ended";

export type RoleAssignment = {
  id: string;
  churchId: string;
  roleId: RoleId;
  memberId: string;
  memberName: string;
  ministryId?: string;
  ministryName?: string;

  assignedByPastorId: string;
  assignedByPastorName: string;

  status: RoleAssignmentStatus;
  assignedAt: string; // ISO
  endsAt?: string; // ISO
  note?: string;
};

export type RoleTaskStatus = "Open" | "InProgress" | "Done" | "Cancelled";

export type RoleTask = {
  id: string;
  churchId: string;
  roleId: RoleId;

  title: string;
  description?: string;
  status: RoleTaskStatus;

  createdAt: string;
  createdBy: string; // pastorId or leaderId
  dueAt?: string;

  assignedToMemberId?: string;
  assignedToMemberName?: string;
};

export type RoleKpi = {
  label: string;
  value: string | number;
  hint?: string;
};
