// app/(app)/dashboard/courtship/church/mockChurches.ts
import type { ChurchLite } from "./types";

export const MOCK_CHURCHES: ChurchLite[] = [
  {
    id: "church_demo_1",
    name: "Kristo Church Central",
    country: "USA",
    city: "Dallas",
    pastorName: "Mch. David Kalonda",
    pastorApprovalRequired: true,
  },
  {
    id: "church_demo_2",
    name: "New Hope Ministry",
    country: "USA",
    city: "Houston",
    pastorName: "Mch. Sarah N.",
    pastorApprovalRequired: true,
  },
  {
    id: "church_demo_3",
    name: "Jesus Saves Church",
    country: "Burundi",
    city: "Bujumbura",
    pastorName: "Mch. Jean P.",
    pastorApprovalRequired: true,
  },
];

export function getChurchById(id: string | null | undefined) {
  if (!id) return null;
  return MOCK_CHURCHES.find((c) => c.id === id) ?? null;
}
