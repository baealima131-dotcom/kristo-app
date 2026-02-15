"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";

export default function MinistryLeaderPage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "").trim();

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 22, fontWeight: 1000 }}>🛡️ Leader Dashboard</div>
        <div style={{ opacity: 0.8, marginTop: 8 }}>
          Ministry ID: <span style={{ fontWeight: 900 }}>{ministryId || "(missing)"}</span>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <Link style={btn} href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}/leader/announcements`}>
            📣 Announcements
          </Link>
          <Link style={btn} href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}`}>
            ← Back to Ministry Profile
          </Link>
          <Link style={ghost} href="/dashboard/church/ministries">
            ← Back to Ministries
          </Link>
        </div>

        <div style={{ opacity: 0.7, marginTop: 14, fontSize: 12 }}>
          VIP next: tasks, schedule, requests, members management…
        </div>
      </div>
    </div>
  );
}

const wrap: CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: 14 };
const card: CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.24)",
  padding: 16,
};
const btn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  fontWeight: 900,
  textDecoration: "none",
};
const ghost: CSSProperties = { ...btn, background: "rgba(0,0,0,0.18)" };
