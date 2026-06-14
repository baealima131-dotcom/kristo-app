// app/(app)/dashboard/layout.tsx
import Link from "next/link";
import type { ReactNode, CSSProperties } from "react";
import { Suspense } from "react";
import ChurchNav from "./_components/ChurchNav";
import UserMenu from "./_components/UserMenu";
import DashboardGate from "./_components/DashboardGate";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={wrap}>
      {/* Sidebar */}
      <aside style={sidebar}>
        <div style={topRow}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Kristo App</div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>VIP • Gold Pure</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={vipPill}>👑 VIP GOLD</div>
            {/* ✅ Logout menu */}
            <UserMenu />
          </div>
        </div>

        {/* MAIN */}
        <NavItem href="/dashboard" title="Overview" subtitle="VIP dashboard" />
        <NavItem href="/dashboard/posts" title="Latest Posts" subtitle="Sermon • Worship • Testimony" />
        <NavItem href="/dashboard/profile" title="Profile" subtitle="My profile & privacy" badge="VIP" />

        {/* CHURCH (GATED) */}
        <ChurchNav navItemStyle={navItem} sectionLabelStyle={sectionLabel} badgeStyle={badgeStyle} />

        {/* COURTSHIP */}
        <div style={sectionLabel}>COURTSHIP</div>
        <NavItem href="/dashboard/courtship" title="Courtship" subtitle="Discover • Matches • Chat" badge="NEW" />

        {/* OTHER */}
        <div style={sectionLabel}>OTHER</div>
        <NavItem href="/dashboard/messages" title="Messages" subtitle="Inbox & conversations" />
        <NavItem href="/dashboard/donate" title="Donate" subtitle="Toa sadaka & michango" />
        <NavItem href="/dashboard/settings" title="Settings" subtitle="Account & app" />

      </aside>

      {/* Content */}
      <main style={main}>
        <Suspense fallback={<div style={{ padding: 16, opacity: 0.75, fontSize: 13 }}>Loading...</div>}>
          <DashboardGate />
        </Suspense>
        <div style={content}>{children}</div>
      </main>
    </div>
  );
}

function NavItem({
  href,
  title,
  subtitle,
  badge,
}: {
  href: string;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <Link href={href} style={navItem}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>{title}</div>
        {badge ? <span style={badgeStyle}>{badge}</span> : null}
      </div>
      <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>{subtitle}</div>
    </Link>
  );
}

/* =========================
   STYLES
   ========================= */

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  background: "#0b0f1a",
  color: "#fff",
  boxSizing: "border-box",
  overflowX: "hidden",
};

const sidebar: CSSProperties = {
  width: 320,
  minWidth: 320,
  padding: 18,
  borderRight: "1px solid rgba(255,255,255,0.08)",
  background: "linear-gradient(180deg, rgba(18,18,24,0.95), rgba(10,12,18,0.95))",
  boxSizing: "border-box",
};

const main: CSSProperties = {
  flex: 1,
  width: "100%",
  maxWidth: "none",
  padding: 26,
  boxSizing: "border-box",
  overflowX: "hidden",
};

const content: CSSProperties = {
  width: "100%",
  maxWidth: "none",
  boxSizing: "border-box",
};

const topRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
};

const vipPill: CSSProperties = {
  border: "1px solid rgba(255,215,0,0.45)",
  color: "gold",
  padding: "6px 10px",
  borderRadius: 999,
  fontWeight: 700,
  fontSize: 12,
};

const sectionLabel: CSSProperties = {
  marginTop: 14,
  marginBottom: 6,
  paddingLeft: 6,
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: 1.2,
  color: "rgba(255,236,190,0.85)",
  opacity: 0.9,
};

const navItem: CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: "inherit",
  padding: 14,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  marginTop: 10,
  boxSizing: "border-box",
};

const badgeStyle: CSSProperties = {
  fontSize: 10,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,215,0,0.45)",
  color: "gold",
  fontWeight: 800,
};
