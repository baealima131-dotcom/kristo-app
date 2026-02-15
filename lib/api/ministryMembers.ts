import { apiFetch } from "./client";

export type MinistryMemberRole = "Member" | "Assistant" | "Leader";

export type MinistryMember = {
  id: string;
  ministryId: string;
  userId: string;
  role: MinistryMemberRole;
  createdAt: string;
  updatedAt?: string;
};

export function listMinistryMembers(ministryId: string) {
  return apiFetch<MinistryMember[]>(
    `/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`
  );
}

export function addMinistryMember(payload: {
  ministryId: string;
  userId: string;
  role: MinistryMemberRole;
}) {
  return apiFetch<MinistryMember>("/api/church/ministry-members", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removeMinistryMember(id: string) {
  return apiFetch<{ id: string }>("/api/church/ministry-members?id=" + encodeURIComponent(id), {
    method: "DELETE",
  });
}

export function updateMinistryMemberRole(payload: { id: string; role: MinistryMemberRole }) {
  return apiFetch<MinistryMember>("/api/church/ministry-members?id=" + encodeURIComponent(payload.id), {
    method: "PATCH",
    body: JSON.stringify({ role: payload.role }),
  });
}
