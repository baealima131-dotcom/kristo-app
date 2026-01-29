"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type MeChurchResponse = {
  ok: boolean;
  membership?: { status: string } | null;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function Sidebar() {
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [isActiveMember, setIsActiveMember] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        const res = await fetch("/api/me/church", { cache: "no-store" });
        const data = (await res.json()) as MeChurchResponse;
        const active = data?.membership?.status === "Active";

        if (!mounted) return;
        setIsActiveMember(active);
        setLoading(false);
      } catch {
        // if it fails, be safe: treat as not active
        if (!mounted) return;
        setIsActiveMember(false);
        setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, []);

  const churchLinks = useMemo(
    () => [
      { href: "/dashboard/church/overview", label: "Church Dashboard", sub: "Overview ya Kanisa" },
      { href: "/dashboard/church/members", label: "Members", sub: "Orodha ya waumini" },
      { href: "/dashboard/church/roles", label: "Church Roles", sub: "Vyeo • Leadership • Permissions" },
      { href: "/dashboard/church/ministries", label: "Ministries", sub: "Idara • Vikundi • Uongozi" },
      { href: "/dashboard/church/ministry-members", label: "Ministry Members", sub: "Wahudumu ndani ya idara" },
      { href: "/dashboard/church/notifications", label: "Notifications", sub: "Matangazo • alerts" },
      { href: "/dashboard/church/audit", label: "Audit", sub: "History ya mabadiliko" },
    ],
    []
  );

  const joinOnly = useMemo(
    () => [{ href: "/dashboard/church/join", label: "Join Church", sub: "Omba kuingia kanisani" }],
    []
  );

  const linksToShow = loading ? joinOnly : isActiveMember ? churchLinks : joinOnly;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 12, fontWeight: 800 }}>Kristo App</div>

      <div style={{ display: "grid", gap: 10 }}>
        {linksToShow.map((x) => {
          const active = pathname === x.href || pathname?.startsWith(x.href + "/");
          return (
            <Link
              key={x.href}
              href={x.href}
              className={cx("block", active && "active")}
              style={{
                display: "block",
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: active ? "rgba(255,255,255,0.08)" : "transparent",
                textDecoration: "none",
              }}
            >
              <div style={{ fontWeight: 800 }}>{x.label}</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>{x.sub}</div>
            </Link>
          );
        })}
      </div>

      {!loading && !isActiveMember ? (
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
          You must be an <b>Active</b> church member to access church features.
        </div>
      ) : null}
    </div>
  );
}
