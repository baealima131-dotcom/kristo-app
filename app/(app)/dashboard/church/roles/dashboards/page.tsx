"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardsIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/church/roles");
  }, [router]);

  return (
    <div style={{ padding: 16, opacity: 0.75, fontSize: 13 }}>
      Redirecting...
    </div>
  );
}
