"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MeChurchResponse = {
  ok: boolean;
  membership?: { status: string } | null;
};

type Props = {
  navItemStyle: React.CSSProperties;
  sectionLabelStyle: React.CSSProperties;
  badgeStyle: React.CSSProperties;
};

export default function ChurchNav({ navItemStyle, sectionLabelStyle, badgeStyle }: Props) {
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        const res = await fetch("/api/me/church", { cache: "no-store" });
        const data = (await res.json()) as MeChurchResponse;
        const isActive = data?.membership?.status === "Active";

        if (!mounted) return;
        setActive(isActive);
        setLoading(false);
      } catch {
        if (!mounted) return;
        setActive(false);
        setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <div style={sectionLabelStyle}>CHURCH</div>

      {loading ? (
        <Link href="/dashboard/church/join" style={navItemStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>Join Church</div>
            <span style={badgeStyle}>...</span>
          </div>
          <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>Checking membership...</div>
        </Link>
      ) : active ? (
        <>
          <Link href="/dashboard/church/overview" style={navItemStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Church Dashboard</div>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>Overview ya Kanisa</div>
          </Link>

          <Link href="/dashboard/church/members" style={navItemStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Members</div>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>Orodha ya waumini</div>
          </Link>

          <Link href="/dashboard/church/roles" style={navItemStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Church Roles</div>
              <span style={badgeStyle}>VIP</span>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>Vyeo • Leadership • Permissions</div>
          </Link>

          <Link href="/dashboard/church/ministries" style={navItemStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Ministries</div>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>Idara • Vikundi • Uongozi</div>
          </Link>
        </>
      ) : (
        <>
          <Link href="/dashboard/church/join" style={navItemStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Join Church</div>
              <span style={badgeStyle}>LOCKED</span>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
              Omba kuingia kanisani (Active membership required)
            </div>
          </Link>
        </>
      )}
    </>
  );
}
