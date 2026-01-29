"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type MeChurchResponse = {
  ok: boolean;
  activeChurchId?: string;
  membership?: { status: string } | null;
};

export default function ChurchEntryGate() {
  const router = useRouter();
  const [msg, setMsg] = useState("Checking your church membership...");

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        const res = await fetch("/api/me/church", { cache: "no-store" });
        const data = (await res.json()) as MeChurchResponse;

        const status = data?.membership?.status || "";
        const isActive = status === "Active";

        if (!mounted) return;

        if (isActive) {
          router.replace("/dashboard/church/overview");
          return;
        }

        router.replace("/dashboard/church/join");
      } catch (e) {
        if (!mounted) return;
        setMsg("Failed to check membership. Refresh the page.");
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Church</div>
      <div>{msg}</div>
    </div>
  );
}
