// app/(app)/dashboard/courtship/church/types.ts

export type MembershipStatus = "Requested" | "Active" | "Rejected" | "Banned";

export type ChurchLite = {
  id: string;
  name: string;
  country?: string;
  city?: string;
  pastorName?: string;
  pastorApprovalRequired?: boolean; // for courtship verification/discover gating
};

export type JoinRequest = {
  id: string;
  userId: string;
  churchId: string;
  message?: string;
  status: MembershipStatus;
  createdAt: number;
  updatedAt?: number;
};
