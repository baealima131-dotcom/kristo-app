"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function DashboardGate() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let on = true;

    (async () => {
      try {
        const isProfilePage = pathname === "/dashboard/profile";

        // 1) must have session
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const me = await meRes.json().catch(() => ({}));

        if (!meRes.ok || !me?.ok) {
          const next = encodeURIComponent(pathname + (sp.toString() ? `?${sp.toString()}` : ""));
          router.replace(`/sign-in?next=${next}`);
          return;
        }

        // 2) if no profile yet, force them to profile page (but do NOT block profile page itself)
        const hasProfile = Boolean(me?.profile);
        if (!hasProfile && !isProfilePage) {
          const next = encodeURIComponent(pathname + (sp.toString() ? `?${sp.toString()}` : ""));
          router.replace(`/dashboard/profile?next=${next}`);
          return;
        }

        if (on) setChecked(true);
      } catch {
        const next = encodeURIComponent(pathname + (sp.toString() ? `?${sp.toString()}` : ""));
        router.replace(`/sign-in?next=${next}`);
      } finally {
        if (on) setChecked(true);
      }
    })();

    return () => {
      on = false;
    };
  }, [router, pathname, sp]);

  if (!checked) {
    return <div style={{ padding: 16, opacity: 0.75, fontSize: 13 }}>Loading...</div>;
  }

  return null;
}
