// app/(app)/dashboard/courtship/page.tsx
"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CourtshipTabs from "./_components/CourtshipTabs";
import { useCourtshipStore } from "./_lib/courtshipStore";

export default function CourtshipOverviewPage() {
  const store = useCourtshipStore();
  const { db, loading } = store;
  const busy = loading;

  const pathname = usePathname();

  // ✅ Responsive columns: mobile 1, tablet 2, desktop 3
  const [cols, setCols] = useState<1 | 2 | 3>(3);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const calc = () => {
      const w = window.innerWidth;
      if (w <= 680) return setCols(1);
      if (w <= 1040) return setCols(2);
      return setCols(3);
    };

    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc as any);
  }, []);

  const stats = useMemo(() => {
    const profiles = db?.profiles?.length ?? 0;
    const matches = db?.matches?.length ?? 0;
    const approved = db?.matches?.filter((m) => m.approved).length ?? 0;
    const waiting = Math.max(matches - approved, 0);

    // ✅ optional (if your store uses unread summary)
    const unread = (store as any).totalUnread ?? 0;

    return { profiles, matches, approved, waiting, unread };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, (store as any).totalUnread]);

  const hasAnything = stats.profiles > 0 || stats.matches > 0;

  async function onReset() {
    if (busy) return;

    const ok = confirm(
      "Reset ALL courtship data (demo)?\n\nThis will delete matches, requests, steps, chats, presence, and uploads."
    );
    if (!ok) return;

    try {
      await (store as any).resetAll();
      await (store as any).refreshAll?.();
      alert("✅ Reset done.");
    } catch (e: any) {
      alert(e?.message || "Reset failed");
    }
  }

  const gridCols =
    cols === 1 ? "1fr" : cols === 2 ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))";

  return (
    <div>
      <CourtshipTabs />

      <div style={panel}>
        {/* HEADER */}
        <div style={top}>
          <div>
            <div style={h2}>Courtship Overview</div>
            <div style={sub}>VIP control center — shortcut za haraka + stats + flow.</div>
            <div style={{ opacity: 0.8, fontSize: 12, marginTop: 6 }}>
              Viewer role: <b>{store.mode}</b>
            </div>
          </div>

          <div style={vipBadge}>👑 VIP GOLD PURE</div>
        </div>

        {/* QUICK ACTIONS */}
        <div style={quickWrap}>
          <div style={secTitle}>Quick Actions</div>

          <div style={{ ...quickGrid, gridTemplateColumns: gridCols }}>
            <QuickCard pathname={pathname} href="/dashboard/courtship/discover" icon="🔍" title="Discover" desc="Tafuta profiles + send interest" />
            <QuickCard pathname={pathname} href="/dashboard/courtship/requests" icon="📥" title="Requests" desc="Accept / Decline interests" />
            <QuickCard pathname={pathname} href="/dashboard/courtship/matches" icon="💛" title="Matches" desc="View matches + status" />
            <QuickCard pathname={pathname} href="/dashboard/courtship/couple" icon="💬" title="Couple" desc="Steps 1–3 + chat room" />
            <QuickCard pathname={pathname} href="/dashboard/courtship/pastor" icon="⛪️" title="Pastor" desc="Approve → Engagement Mode" />
          </div>

          <div style={miniTip}>
            Tip: Ukiona “Waiting”, nenda <b>Requests</b> (Receiver) → <b>Accept</b> ndipo match ionekane.
          </div>
        </div>

        {/* FLOW */}
        <div style={box}>
          <div style={secTitle}>Flow (How it works)</div>

          <ol style={ol}>
            <li>
              <b>Discover</b>: tafuta watu + send interest
            </li>
            <li>
              <b>Requests</b>: Receiver anaona interests → accept/decline
            </li>
            <li>
              <b>Matches</b>: match inaonekana baada ya accept
            </li>
            <li>
              <b>Couple</b>: steps 1–3 + guided chat
            </li>
            <li>
              <b>Pastor</b>: pastor mmoja akubali → Engagement Mode (Approved)
            </li>
          </ol>

          <div style={rule}>
            ✅ <b>Rule:</b> Si lazima wawe kanisa moja. Inatosha pastor mmoja kutoka upande wowote akisha-approve.
          </div>
        </div>

        {/* STATS */}
        <div style={statsRow}>
          <Stat label="Profiles" value={stats.profiles} />
          <Stat label="Matches" value={stats.matches} />
          <Stat label="Approved" value={stats.approved} />
          <Stat label="Waiting" value={stats.waiting} />
          <Stat label="Unread" value={stats.unread} />

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              style={!hasAnything || busy ? btnDangerDisabled : btnDanger}
              disabled={!hasAnything || busy}
              onClick={onReset}
              title={!hasAnything ? "Nothing to reset" : "Reset demo data"}
            >
              Reset All (Demo)
            </button>
          </div>
        </div>

        {!busy && !hasAnything ? (
          <div style={empty}>
            Bado hujaanza. Anza na <b>Discover</b> → <b>Send Interest</b>, kisha nenda <b>Requests</b> (Receiver) →{" "}
            <b>Accept</b>.
          </div>
        ) : null}

        {loading ? <div style={note}>Loading...</div> : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={statBox}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  );
}

function QuickCard(props: { pathname: string; href: string; icon: string; title: string; desc: string }) {
  const isRoot = props.href === "/dashboard/courtship";
  const active = isRoot
    ? props.pathname === props.href
    : props.pathname === props.href || props.pathname.startsWith(props.href + "/");

  const [hover, setHover] = useState(false);
  const [hoverable, setHoverable] = useState(false);

  // ✅ only desktop-like devices should animate on hover
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setHoverable(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const cardStyle: CSSProperties = {
    ...(active ? quickCardActive : quickCard),
    ...(hoverable && hover ? quickCardHover : {}),
  };

  return (
    <Link
      href={props.href}
      style={cardStyle}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-current={active ? "page" : undefined}
    >
      <div style={quickTop}>
        <div style={active ? quickIconActive : quickIcon}>{props.icon}</div>
        <div style={quickTitle}>{props.title}</div>
        {active ? <div style={activeTag}>ACTIVE</div> : null}
      </div>

      <div style={quickDesc}>{props.desc}</div>

      <div style={quickGoRow}>
        <div style={active ? quickGoActive : quickGo}>Open →</div>
        <div style={chev}>{hoverable && hover ? "➜" : "›"}</div>
      </div>
    </Link>
  );
}

/* =========================
   STYLES
   ========================= */

const panel: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const top: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const h2: CSSProperties = { fontSize: 26, fontWeight: 950, marginBottom: 6 };
const sub: CSSProperties = { opacity: 0.86, lineHeight: 1.6 };

const vipBadge: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.28)",
  background:
    "radial-gradient(140px 70px at 30% 0%, rgba(212,175,55,0.28), transparent 70%), linear-gradient(180deg, rgba(212,175,55,0.14), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
  whiteSpace: "nowrap",
};

const secTitle: CSSProperties = { fontWeight: 950, marginBottom: 10, color: "rgba(255,236,190,0.98)" };

const quickWrap: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "radial-gradient(700px 260px at 15% 0%, rgba(212,175,55,0.10), transparent 60%), rgba(0,0,0,0.18)",
};

const quickGrid: CSSProperties = {
  display: "grid",
  gap: 10,
};

const quickCard: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(520px 220px at 15% 0%, rgba(212,175,55,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 12,
  textDecoration: "none",
  color: "inherit",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
  outline: "none",
  transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease, background 180ms ease",
};

const quickCardHover: CSSProperties = {
  transform: "translateY(-3px)",
  boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
  border: "1px solid rgba(212,175,55,0.28)",
};

const quickCardActive: CSSProperties = {
  ...quickCard,
  border: "1px solid rgba(212,175,55,0.36)",
  background:
    "radial-gradient(620px 260px at 15% 0%, rgba(212,175,55,0.18), transparent 62%), linear-gradient(180deg, rgba(212,175,55,0.12), rgba(255,255,255,0.03))",
  boxShadow: "0 18px 52px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,175,55,0.16) inset",
};

const quickTop: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };

const quickIcon: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(212,175,55,0.26)",
  background: "rgba(212,175,55,0.10)",
  fontSize: 18,
};

const quickIconActive: CSSProperties = {
  ...quickIcon,
  border: "1px solid rgba(212,175,55,0.38)",
  background: "rgba(212,175,55,0.16)",
};

const quickTitle: CSSProperties = { fontWeight: 950, fontSize: 15 };

const activeTag: CSSProperties = {
  marginLeft: "auto",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.30)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  fontSize: 11,
  letterSpacing: 0.4,
};

const quickDesc: CSSProperties = { opacity: 0.86, lineHeight: 1.5, fontSize: 13 };

const quickGoRow: CSSProperties = {
  marginTop: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const quickGo: CSSProperties = {
  fontWeight: 950,
  fontSize: 12,
  opacity: 0.92,
  color: "rgba(255,236,190,0.98)",
};

const quickGoActive: CSSProperties = { ...quickGo, opacity: 1 };

const chev: CSSProperties = { opacity: 0.85, fontWeight: 950 };

const miniTip: CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.92,
  lineHeight: 1.6,
  fontSize: 13,
};

const box: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
};

const ol: CSSProperties = { marginTop: 0, marginBottom: 0, opacity: 0.92, lineHeight: 1.9, paddingLeft: 18 };

const rule: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "linear-gradient(180deg, rgba(212,175,55,0.10), rgba(255,255,255,0.03))",
  opacity: 0.96,
  lineHeight: 1.6,
};

const statsRow: CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14, alignItems: "center" };

const statBox: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  minWidth: 120,
};

const statLabel: CSSProperties = { opacity: 0.85, fontWeight: 900, fontSize: 12 };
const statValue: CSSProperties = { fontSize: 22, fontWeight: 950, color: "rgba(255,236,190,0.98)" };

const btnDanger: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
  fontWeight: 950,
  cursor: "pointer",
};

const btnDangerDisabled: CSSProperties = {
  ...btnDanger,
  opacity: 0.55,
  cursor: "not-allowed",
};

const empty: CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.92,
  lineHeight: 1.7,
};

const note: CSSProperties = { marginTop: 12, opacity: 0.85 };
