// app/(app)/dashboard/courtship/_components/CourtshipTabs.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useCourtshipStore, type ChatSender } from "../_lib/courtshipStore";

/* =========================
   TABS
   ========================= */

const tabs = [
  { href: "/dashboard/courtship", label: "Overview" },
  { href: "/dashboard/courtship/discover", label: "Discover" },
  { href: "/dashboard/courtship/requests", label: "Requests" },
  { href: "/dashboard/courtship/matches", label: "Matches" },
  { href: "/dashboard/courtship/couple", label: "Couple" },
  { href: "/dashboard/courtship/pastor", label: "Pastor" },
] as const;

function normalizePath(p: string) {
  if (!p) return "/";
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function isActivePathname(pathnameRaw: string, hrefRaw: string) {
  const pathname = normalizePath(pathnameRaw);
  const href = normalizePath(hrefRaw);

  if (href === "/dashboard/courtship") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function isChatViewer(role: string): role is ChatSender {
  return role === "Sender" || role === "Receiver" || role === "Pastor";
}

export default function CourtshipTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const store = useCourtshipStore();

  const [isDesktop, setIsDesktop] = useState(false);

  // ✅ enable hover only for desktop-ish pointers
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ✅ match ids for summary (server-side)
  const matchIds = useMemo(() => (store.matches || []).map((m) => m.id), [store.matches]);
  const matchIdsKey = useMemo(() => matchIds.join(","), [matchIds]);

  // ✅ unread summary (server-side) + pastor queue
  useEffect(() => {
    const viewer: ChatSender = isChatViewer(store.mode) ? store.mode : "Sender";

    // initial fetch
    store.fetchUnreadSummary(matchIds).catch(() => {});
    if (store.pastorSession?.pastorId) store.fetchPastorQueue().catch(() => {});

    // interval polling (stable)
    const t = setInterval(() => {
      const v2: ChatSender = isChatViewer(store.mode) ? store.mode : "Sender";
      // store uses mode internally; call anyway
      store.fetchUnreadSummary(matchIds).catch(() => {});
      if (store.pastorSession?.pastorId) store.fetchPastorQueue().catch(() => {});
      void v2; // avoid lint unused in some setups
      void viewer;
    }, 12_000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.mode, store.pastorSession?.pastorId, matchIdsKey]);

  const counts = useMemo(() => {
    // ✅ IMPORTANT: Requests badge should be Pending only
    const incomingPending =
      store.mode === "Receiver"
        ? ((store.incomingRequests || []) as any[]).filter((r) => String(r?.status || "") === "Pending").length
        : 0;

    const matches = store.matches?.length ?? 0;
    const approved = store.matches?.filter((m) => m.approved).length ?? 0;
    const waiting = Math.max(matches - approved, 0);

    // unread from server summary
    const unreadTotal = store.totalUnread ?? 0;

    // pastor pending verifications (from pastorQueue)
    const pastorPending = store.pastorQueue?.length ?? 0;

    return { incomingPending, matches, approved, waiting, unreadTotal, pastorPending };
  }, [store.mode, store.incomingRequests, store.matches, store.totalUnread, store.pastorQueue]);

  // ✅ keep matchId when jumping Couple/Pastor (optional)
  const matchIdFromUrl = sp.get("matchId") || "";

  function getHrefWithMatchId(baseHref: string) {
    if (!matchIdFromUrl) return baseHref;
    if (baseHref === "/dashboard/courtship/couple" || baseHref === "/dashboard/courtship/pastor") {
      return `${baseHref}?matchId=${encodeURIComponent(matchIdFromUrl)}`;
    }
    return baseHref;
  }

  return (
    <div style={wrap}>
      <div style={headerRow}>
        <div style={{ minWidth: 220 }}>
          <div style={title}>Courtship</div>
          <div style={sub}>Golden Pure VIP • Discover → Requests → Matches → Pastor → Engagement Mode</div>

          {/* mini status line */}
          <div style={miniLine}>
            <span style={miniDot} /> Mode: <b>{store.mode}</b>
            <span style={miniSep}>•</span>
            Matches: <b>{counts.matches}</b>
            <span style={miniSep}>•</span>
            Approved: <b>{counts.approved}</b>
            <span style={miniSep}>•</span>
            Waiting: <b>{counts.waiting}</b>
            <span style={miniSep}>•</span>
            Unread: <b>{counts.unreadTotal}</b>

            {store.pastorSession ? (
              <>
                <span style={miniSep}>•</span>
                Pastor Pending: <b>{counts.pastorPending}</b>
              </>
            ) : null}
          </div>
        </div>

        <div style={rightSide}>
          <div style={vipBadge}>👑 VIP GOLD PURE</div>

          {/* MODE SWITCH */}
          <div style={modeWrap}>
            <button
              type="button"
              onClick={() => store.setMode("Sender")}
              style={store.mode === "Sender" ? modeBtnActive : modeBtn}
            >
              Sender
            </button>

            <button
              type="button"
              onClick={() => store.setMode("Receiver")}
              style={store.mode === "Receiver" ? modeBtnActive : modeBtn}
            >
              Receiver
              {store.mode === "Receiver" && counts.incomingPending > 0 ? (
                <span style={badgePill}>{counts.incomingPending}</span>
              ) : null}
            </button>
          </div>
        </div>
      </div>

      <div style={tabRow}>
        {tabs.map((t) => {
          const active = isActivePathname(pathname, t.href);

          // ✅ badges by tab
          let badge: number | undefined;

          // Requests: only receiver & pending
          if (t.href === "/dashboard/courtship/requests" && store.mode === "Receiver" && counts.incomingPending > 0) {
            badge = counts.incomingPending;
          }

          // Matches: show waiting approvals
          if (t.href === "/dashboard/courtship/matches" && counts.waiting > 0) {
            badge = counts.waiting;
          }

          // Couple: show total unread chats
          if (t.href === "/dashboard/courtship/couple" && counts.unreadTotal > 0) {
            badge = counts.unreadTotal;
          }

          // Pastor: show pending verifications if pastor logged in
          if (t.href === "/dashboard/courtship/pastor" && store.pastorSession && counts.pastorPending > 0) {
            badge = counts.pastorPending;
          }

          return (
            <TabChip
              key={t.href}
              href={getHrefWithMatchId(t.href)}
              label={t.label}
              active={active}
              isDesktop={isDesktop}
              badge={badge}
            />
          );
        })}
      </div>
    </div>
  );
}

/* =========================
   TAB CHIP (hover + glow)
   ========================= */

function TabChip(props: { href: string; label: string; active: boolean; isDesktop: boolean; badge?: number }) {
  const [hover, setHover] = useState(false);

  const style: CSSProperties = {
    ...(props.active ? tabActive : tab),
    ...(props.isDesktop && hover ? tabHover : {}),
  };

  return (
    <Link href={props.href} style={style} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span>{props.label}</span>
      {typeof props.badge === "number" ? <span style={badgeDot}>{props.badge}</span> : null}
    </Link>
  );
}

/* =========================
   STYLES
   ========================= */

const wrap: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 350px at 20% 0%, rgba(212,175,55,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
  marginBottom: 14,
};

const headerRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "flex-start",
};

const title: CSSProperties = { fontSize: 34, fontWeight: 950, marginBottom: 6 };
const sub: CSSProperties = { opacity: 0.86, lineHeight: 1.5 };

const rightSide: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const vipBadge: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.28)",
  background:
    "radial-gradient(120px 60px at 30% 0%, rgba(212,175,55,0.28), transparent 70%), linear-gradient(180deg, rgba(212,175,55,0.14), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  whiteSpace: "nowrap",
  boxShadow: "0 10px 28px rgba(0,0,0,0.30)",
};

const miniLine: CSSProperties = {
  marginTop: 8,
  opacity: 0.86,
  fontSize: 12,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
};

const miniDot: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 99,
  background: "rgba(212,175,55,0.75)",
  display: "inline-block",
};

const miniSep: CSSProperties = { opacity: 0.55, margin: "0 4px" };

const modeWrap: CSSProperties = {
  display: "inline-flex",
  padding: 4,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  gap: 6,
};

const modeBtn: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "transparent",
  color: "inherit",
  borderRadius: 999,
  padding: "8px 12px",
  fontWeight: 950,
  cursor: "pointer",
  opacity: 0.9,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const modeBtnActive: CSSProperties = {
  ...modeBtn,
  border: "1px solid rgba(212,175,55,0.34)",
  background:
    "radial-gradient(120px 60px at 30% 0%, rgba(212,175,55,0.22), transparent 70%), rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
  opacity: 1,
};

const badgePill: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.98)",
  fontWeight: 950,
  fontSize: 11,
  lineHeight: "14px",
};

const tabRow: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 };

const tab: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.16)",
  textDecoration: "none",
  color: "inherit",
  fontWeight: 900,
  opacity: 0.9,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
};

const tabHover: CSSProperties = {
  transform: "translateY(-2px)",
  boxShadow: "0 14px 32px rgba(0,0,0,0.45)",
  border: "1px solid rgba(212,175,55,0.24)",
};

const tabActive: CSSProperties = {
  ...tab,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
  opacity: 1,
  boxShadow: "0 0 0 1px rgba(212,175,55,0.14) inset",
};

const badgeDot: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.98)",
  fontWeight: 950,
  fontSize: 11,
  lineHeight: "14px",
};