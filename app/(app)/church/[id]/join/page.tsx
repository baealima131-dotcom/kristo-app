"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function JoinChurchPage() {
  const router = useRouter();
  const params = useParams();
  const churchId = String((params as any)?.id || "");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) {
          router.replace(`/sign-in?next=${encodeURIComponent(`/church/${churchId}/join`)}`);
          return;
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router, churchId]);

  async function onRequestJoin() {
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/church/memberships/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ churchId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) {
        setErr(String(d?.error || "Imeshindikana kutuma ombi la ku-join."));
        return;
      }
      setMsg("Ombi limetumwa. Subiri approval ya Pastor/Admin.");
    } catch (e: any) {
      setErr(e?.message || "Imeshindikana kutuma ombi la ku-join.");
    }
  }

  if (loading) return <div className="p-6 text-white/80">Loading...</div>;

  return (
    <div className="p-6 text-white/90 space-y-4">
      <h1 className="text-xl font-black">Join Church</h1>
      <div className="text-white/70 text-sm">Church ID: {churchId}</div>

      {err ? <div className="text-red-300 text-sm">{err}</div> : null}
      {msg ? <div className="text-green-300 text-sm">{msg}</div> : null}

      <button
        type="button"
        onClick={onRequestJoin}
        className="text-sm px-3 py-2 rounded-md border border-white/15 hover:bg-white/5"
      >
        Request to Join
      </button>
    </div>
  );
}
