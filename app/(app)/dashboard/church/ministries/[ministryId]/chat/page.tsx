"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import MinistryChat from "../_components/MinistryChat";
import type { CSSProperties } from "react";

export default function MinistryChatPage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "");

  const wrap: CSSProperties = {
    padding: "18px 28px", width: "100%",
    
    
  };

  const btn: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.20)",
    color: "inherit",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  return (
    <div style={{ width: "100%" }}>
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 1000, marginBottom: 6 }}>💬 Ministry Chat</div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            ministryId: <span style={{ opacity: 0.95 }}>{ministryId}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}`} style={btn}>
            ← Back to Ministry Profile
          </Link>
        </div>
      </div>

      <MinistryChat ministryId={ministryId} title="💬 Ministry Group Chat" />
    </div>
    </div>
  );
}
