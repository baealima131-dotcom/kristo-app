"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type MeChurchResponse = {
  ok: boolean;
  membership?: { status: string } | null;
};

export default function CourtshipLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const [msg, setMsg] = useState("Checking church membership...");

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        const res = await fetch("/api/me/church", { cache: "no-store" });
        const data = (await res.json()) as MeChurchResponse;

        const status = data?.membership?.status || "";
        const isActive = status === "Active";

        if (!mounted) return;

        if (!isActive) {
          // Courtship is church-gated: must be Active member
          const next = `/dashboard/church/join?next=${encodeURIComponent(pathname || "/dashboard/courtship")}`;
          router.replace(next);
          return;
        }

        setAllowed(true);
      } catch {
        if (!mounted) return;
        setMsg("Failed to check membership. Refresh the page.");
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [router, pathname]);

  if (!allowed) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Courtship</div>
        <div>{msg}</div>
      </div>
    );
  }

  return <>{children}</>;
}
