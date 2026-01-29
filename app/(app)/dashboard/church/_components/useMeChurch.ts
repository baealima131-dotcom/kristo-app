"use client";

import { useEffect, useState } from "react";

export type MeChurch = {
  ok: boolean;
  viewer?: { userId: string; role: string; name?: string };
  activeChurchId?: string;
  membership?: { status: string; churchId: string } | null;
};

export function useMeChurch() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MeChurch | null>(null);
  const [error, setError] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/me/church", { cache: "no-store" });
      const json = (await res.json()) as MeChurch;
      setData(json);
    } catch {
      setError("Failed to load /api/me/church");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const role = data?.viewer?.role || "Member";
  const membershipStatus = data?.membership?.status || "None";

  return { loading, data, error, refresh, role, membershipStatus };
}
