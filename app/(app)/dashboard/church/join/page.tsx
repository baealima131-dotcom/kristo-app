"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type MeChurchResponse = {
  ok: boolean;
  viewer?: { userId: string; role: string; name?: string };
  activeChurchId?: string;
  membership?: { id: string; churchId: string; status: string } | null;
};

export default function JoinChurchPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextUrl = useMemo(() => {
    const n = sp?.get("next");
    return n && n.startsWith("/") ? n : "/dashboard/church/overview";
  }, [sp]);

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeChurchResponse | null>(null);
  const [churchId, setChurchId] = useState("church_dev_default");
  const [statusMsg, setStatusMsg] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setStatusMsg("");
    const res = await fetch("/api/me/church", { cache: "no-store" });
    const data = (await res.json()) as MeChurchResponse;
    setMe(data);

    const current = data?.membership?.churchId || data?.activeChurchId || "";
    if (current) setChurchId(current);

    if (data?.membership?.status === "Active") {
      router.replace(nextUrl);
      return;
    }

    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestJoin() {
    setStatusMsg("Requesting...");
    const res = await fetch("/api/church/membership/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ churchId }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) {
      setStatusMsg(`Request sent. Status: ${data.membership?.status || "Requested"}`);
      await refresh();
      return;
    }

    setStatusMsg(data?.error ? String(data.error) : "Failed to request membership.");
  }

  const role = me?.viewer?.role || "";
  const membershipStatus = me?.membership?.status || "None";

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Join Church</div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <div>
              <b>User:</b> {me?.viewer?.name || "Dev User"} ({me?.viewer?.userId})
            </div>
            <div>
              <b>Role:</b> {role}
            </div>
            <div>
              <b>Membership:</b> {membershipStatus}
            </div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              <b>After approval, you will be redirected to:</b> {nextUrl}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <label style={{ fontWeight: 700 }}>Church ID</label>
            <input
              value={churchId}
              onChange={(e) => setChurchId(e.target.value)}
              placeholder="church_dev_default"
              style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
            />
            <button
              onClick={requestJoin}
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #111",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Request to Join
            </button>
            {statusMsg ? <div style={{ whiteSpace: "pre-wrap" }}>{statusMsg}</div> : null}
          </div>

          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.85 }}>
            <b>Note:</b> Pastor/Admin must approve your request.
          </div>
        </>
      )}
    </div>
  );
}
