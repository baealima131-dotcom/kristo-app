import { apiFetch } from "./client";

export type MinistryStatus = "Active" | "Paused";

export type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
};

export function listMinistries() {
  return apiFetch<Ministry[]>("/api/church/ministries");
}

export function createMinistry(payload: { name: string; description?: string }) {
  return apiFetch<Ministry>("/api/church/ministries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMinistry(payload: {
  id: string;
  name?: string;
  description?: string;
  status?: MinistryStatus;
}) {
  return apiFetch<Ministry>("/api/church/ministries", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMinistry(id: string) {
  return apiFetch<{ id: string }>("/api/church/ministries", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}
