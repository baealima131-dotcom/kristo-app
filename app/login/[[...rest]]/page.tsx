"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginLegacyPage() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const next = sp.get("next") || sp.get("redirect_url") || "/dashboard";
    router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
  }, [router, sp]);

  return (
    <div style={{ padding: 16, opacity: 0.75, fontSize: 13 }}>
      Redirecting to sign in...
    </div>
  );
}
