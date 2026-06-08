"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inspectWebSessionStorage, webAuthFetch } from "@/lib/webSession";

export default function DashboardGate() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let on = true;

    (async () => {
      const storage = inspectWebSessionStorage();
      console.log("KRISTO_DASHBOARD_GATE_AUTH_RESULT", { phase: "start", path: pathname, storage });

      try {
        const isProfilePage = pathname === "/dashboard/profile";

        const meRes = await webAuthFetch("/api/auth/me", { cache: "no-store" });
        const me = await meRes.json().catch(() => ({}));

        const authOk = meRes.ok && me?.ok;
        console.log("KRISTO_DASHBOARD_GATE_AUTH_RESULT", {
          phase: "me-response",
          ok: authOk,
          status: meRes.status,
          authVia: me?.authVia || null,
          userId: me?.viewer?.userId || null,
          error: me?.error || null,
          storage,
        });

        if (!authOk) {
          const next = encodeURIComponent(pathname + (sp.toString() ? `?${sp.toString()}` : ""));
          console.log("KRISTO_WEB_SESSION_REDIRECT", {
            reason: "me-unauthorized",
            status: meRes.status,
            path: pathname,
            next,
            storage,
            meError: me?.error || null,
          });
          router.replace(`/sign-in?next=${next}`);
          return;
        }

        const hasProfile = Boolean(me?.profile);
        if (!hasProfile && !isProfilePage) {
          const next = encodeURIComponent(pathname + (sp.toString() ? `?${sp.toString()}` : ""));
          router.replace(`/dashboard/profile?next=${next}`);
          return;
        }

        if (on) setChecked(true);
      } catch (error) {
        const next = encodeURIComponent(pathname + (sp.toString() ? `?${sp.toString()}` : ""));
        console.log("KRISTO_WEB_SESSION_REDIRECT", {
          reason: "me-fetch-error",
          path: pathname,
          next,
          storage,
          error: error instanceof Error ? error.message : String(error),
        });
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
