"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ChurchAdminPage() {
  const router = useRouter();
  const params = useParams();
  const churchId = String((params as any)?.id || "");

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) {
          router.replace(`/sign-in?next=${encodeURIComponent(`/church/${churchId}/admin`)}`);
          return;
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router, churchId]);

  if (loading) return <div className="p-6 text-white/80">Loading...</div>;

  return (
    <div className="p-6 text-white/90 space-y-2">
      <h1 className="text-xl font-black">Church Admin</h1>
      <div className="text-white/70 text-sm">Church ID: {churchId}</div>
      <div className="text-white/70 text-sm">(RBAC ya Pastor/Church_Admin tutaunganisha baadaye)</div>
    </div>
  );
}
