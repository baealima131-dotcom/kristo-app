"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

function useIsMobile(bp = 860) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setIsMobile(!!mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [bp]);
  return isMobile;
}


type Ann = {
  id: string;
  churchId: string;
  ministryId: string;
  title: string;
  body: string;
  pinned?: boolean;
  createdBy: { userId: string; role: string };
  createdAt: string;
  updatedAt?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

export default function MemberAnnouncementsPage() {
  const params = useParams<{ ministryId: string }>();
  const ministryId = String(params?.ministryId || "").trim();

  const isMobile = useIsMobile(860);

  const sp = useSearchParams();
  const focusAnnId = String(sp.get("ann") || "");

  const router = useRouter();

  function openAnnouncement(announcementId: string) {
    if (!ministryId || !announcementId) return;
    router.push("/dashboard/church/ministries/" + ministryId + "/member/announcements/" + announcementId);
  }

  function isInnerNavTarget(el: EventTarget | null) {
    if (!el) return false;
    const node = el as HTMLElement;
    return Boolean(node.closest?.('a,button,[role="button"],input,textarea,select,[data-nav="1"]'));
  }


  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flashId, setFlashId] = useState<string>("");

  // DEMO headers (member)
  const headers = useMemo(() => {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "x-kristo-user-id": "u-demo-3",
      "x-kristo-role": "Member",
      "x-kristo-church-id": "c-demo-1",
    };
    return h;
  }, []);

  const [items, setItems] = useState<Ann[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  async function load() {
    if (!ministryId) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/church/ministry-announcements?ministryId=${encodeURIComponent(ministryId)}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as ApiRes<Ann[]>;
      if (!r.ok || !j || (j as any).ok !== true) {
        setErr((j as any)?.error || `Load failed (${r.status})`);
        setItems([]);
      } else {
        const arr = Array.isArray((j as any).data) ? (j as any).data : [];
        // Pinned first, then newest first inside each group
        arr.sort((a: Ann, b: Ann) => {
          const p = Number(!!b.pinned) - Number(!!a.pinned);
          if (p !== 0) return p;
          return String(b.createdAt).localeCompare(String(a.createdAt));
        });
        setItems(arr);
      }
    } catch (e: any) {
      setErr(e?.message || "Load failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ministryId]);

  // Focus + flash by ?ann=
  useEffect(() => {
    if (!focusAnnId) return;
    if (!items.length) return;

    const el = refs.current[focusAnnId];
    if (!el) return;

    setFlashId(focusAnnId);
    const t = setTimeout(() => setFlashId(""), 2500);

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    return () => clearTimeout(t);
  }, [focusAnnId, items]);

  const pinnedCount = items.filter((x) => !!x.pinned).length;

  const flashChipS: CSSProperties = { ...chipS, borderColor: "rgba(120,220,255,0.55)", boxShadow: "0 0 0 6px rgba(120,220,255,0.10)" };
  const flashChipGoldS: CSSProperties = { ...chipGoldS, boxShadow: "0 0 0 6px rgba(255,215,0,0.10)" };

  const pageWrapS: CSSProperties = {
    ...pageWrap,
    padding: isMobile ? 12 : pageWrap.padding,
  };

  const heroS: CSSProperties = {
    ...hero,
    padding: isMobile ? 12 : hero.padding,
    borderRadius: isMobile ? 18 : hero.borderRadius,
  };

  const heroTopS: CSSProperties = {
    ...heroTop,
    gap: isMobile ? 10 : heroTop.gap,
  };

  const h1S: CSSProperties = {
    ...h1,
    fontSize: isMobile ? 20 : h1.fontSize,
  };

  const btnS: CSSProperties = {
    ...btn,
    width: isMobile ? "100%" : "auto",
    padding: isMobile ? "10px 12px" : btn.padding,
  };

  const listWrapS: CSSProperties = {
    ...listWrap,
    gap: isMobile ? 10 : listWrap.gap,
    marginTop: isMobile ? 12 : listWrap.marginTop,
  };

  const emptyS: CSSProperties = {
    ...empty,
    padding: isMobile ? 14 : empty.padding,
  };

  const titleTextS: CSSProperties = {
    ...titleText,
    fontSize: isMobile ? 15 : titleText.fontSize,
    lineHeight: isMobile ? 1.25 : 1.2,
  };

  const bodyTextS: CSSProperties = {
    ...bodyText,
    fontSize: isMobile ? 13 : bodyText.fontSize,
    lineHeight: isMobile ? 1.65 : bodyText.lineHeight,
  };

  const metaRowS: CSSProperties = {
    ...metaRow,
    gap: isMobile ? 10 : metaRow.gap,
  };

  const chipsRowS: CSSProperties = {
    ...chipsRow,
    gap: isMobile ? 6 : chipsRow.gap,
  };



  // VIP: responsive polish (mobile first)

  return (
    <div style={pageWrapS}>
      <div style={heroS}>
        <div style={heroTopS}>
          <div>
            <h1 style={h1S}>Announcements</h1>
            <div style={subtitle}>
              Member space • {items.length} total{pinnedCount ? ` • ${pinnedCount} pinned` : ""}
            </div>
          </div>

          <button style={btnS} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {err ? (
          <div style={alert}>
            <div style={{ fontWeight: 1000 }}>Kuna tatizo</div>
            <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>
          </div>
        ) : null}

        <div style={listWrapS}>
          {items.length === 0 ? (
            <div style={emptyS}>
              <div style={{ fontWeight: 1000 }}>No announcements yet.</div>
              <div style={{ marginTop: 6, opacity: 0.85 }}>Ukiona notification, itakuleta hapa na ku-highlight announcement yake.</div>
            </div>
          ) : (
            items.map((a) => {
              const isFlash = flashId === a.id;
              return (
                <div
                  key={a.id}
                  ref={(node) => {
                    refs.current[a.id] = node;
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    if (isInnerNavTarget(e.target)) return;
                    openAnnouncement(a.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openAnnouncement(a.id);
                    }
                  }}
                  className="annCard"
                  style={{
                    ...card,
                    cursor: "pointer",
                    
                    outline: isFlash ? "2px solid rgba(120,220,255,0.85)" : "none",
                    boxShadow: isFlash ? "0 0 0 6px rgba(120,220,255,0.12)" : card.boxShadow,
                  }}
                >
                  <div style={cardTop}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, width: "100%", flexWrap: "wrap" }}>
                        <div style={titleRow}>
                          <div style={titleTextS}>{a.title || "Announcement"}</div>
                        </div>
                        <div style={isMobile ? chipsRowS : chipsRow}>
                          {a.pinned ? <span style={isFlash ? flashChipGoldS : chipGoldS}>📌 PINNED</span> : null}
                          <span style={isFlash ? flashChipS : chipS}>🕒 {fmt(a.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                  <div style={divider} />

                  <div style={bodyTextS}>{a.body}</div>

                  <div style={metaRowS}>
                    <div style={metaChipLeft}>
                      <span style={dotTiny} />
                      <span>
                        <span style={chip}>👤 by <b>{a.createdBy?.role || "Unknown"}</b></span>
                      </span>
                    </div>
                    <span style={chip}>Announcement</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <style jsx>{`
            .annCard {
              transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
            }
            .annCard:hover {
              transform: translateY(-1px);
              border-color: rgba(255,255,255,0.22);
              box-shadow: 0 22px 70px rgba(0,0,0,0.55);
            }

            /* mobile hover soften */
            @media (max-width: 860px) {
              .annCard:hover {
                transform: none;
                box-shadow: 0 18px 50px rgba(0,0,0,0.42);
              }
            }
          `}</style>
      </div>
    </div>
  );
}

/* =========================
   VIP STYLES
   ========================= */

const pageWrap: CSSProperties = {
  padding: 16,
  maxWidth: 980,
  margin: "0 auto",
};

const hero: CSSProperties = {
  padding: 16,
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.14))",
  boxShadow: "0 18px 60px rgba(0,0,0,0.42)",
  backdropFilter: "blur(10px)",
};

const heroTop: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const h1: CSSProperties = {
  margin: 0,
  fontSize: 28,
  fontWeight: 1000,
  letterSpacing: 0.2,
};

const subtitle: CSSProperties = {
  marginTop: 6,
  opacity: 0.82,
  fontSize: 12,
  lineHeight: 1.4,
};

const btn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  fontWeight: 900,
  cursor: "pointer",
};

const alert: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 16,
  border: "1px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.10)",
};

const listWrap: CSSProperties = {
  marginTop: 14,
  display: "grid",
  gap: 12,
};

const empty: CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: "1px dashed rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.18)",
};

const card: CSSProperties = {
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.18))",
  boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
  backdropFilter: "blur(10px)",
};

const cardTop: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const titleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const titleText: CSSProperties = {
  fontWeight: 1000,
  fontSize: 18,
  letterSpacing: 0.2,
};

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.22)",
  fontSize: 12,
  letterSpacing: 0.15,
  lineHeight: 1.1,
  opacity: 0.92,
  whiteSpace: "nowrap",
};

const chipGold: CSSProperties = {
  ...chip,
  border: "1px solid rgba(255,215,0,0.35)",
  background: "rgba(255,215,0,0.10)",
  color: "rgba(255,236,190,0.98)",
};

/* Mobile-friendly aliases (for *_S usage) */
const chipS: CSSProperties = {
  ...chip,
  fontSize: 11,
  padding: "5px 8px",
  letterSpacing: 0.12,
  lineHeight: 1.05,
};

const chipGoldS: CSSProperties = {
  ...chipGold,
  fontSize: 11,
  padding: "5px 8px",
};


const chipsRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const bodyTextVip: CSSProperties = {
  marginTop: 12,
  whiteSpace: "pre-wrap",
  lineHeight: 1.7,
  fontSize: 14,
  opacity: 0.95,
  color: "rgba(255,255,255,0.92)",
};

const metaChipRow: CSSProperties = {
  marginTop: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

const metaChipLeft: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const dotTiny: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "rgba(120,220,255,0.85)",
  boxShadow: "0 0 0 6px rgba(120,220,255,0.10)",
};

const divider: CSSProperties = {
  marginTop: 12,
  borderTop: "1px solid rgba(255,255,255,0.10)",
};

const bodyText: CSSProperties = {
  marginTop: 12,
  whiteSpace: "pre-wrap",
  lineHeight: 1.7,
  fontSize: 14,
  opacity: 0.95,
  color: "rgba(255,255,255,0.92)",
};

const metaRow: CSSProperties = {
  marginTop: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  fontSize: 12,
  opacity: 0.85,
};

const metaLeft: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const dot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "rgba(120,220,255,0.85)",
  boxShadow: "0 0 0 6px rgba(120,220,255,0.10)",
};
