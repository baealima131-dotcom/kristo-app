// app/(app)/dashboard/courtship/requests/page.tsx
"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import Link from "next/link";
import CourtshipTabs from "../_components/CourtshipTabs";
import { useCourtshipStore, type CourtshipRequest, type Profile } from "../_lib/courtshipStore";

type ReqStatus = "Pending" | "Accepted" | "Declined";

function getReqId(r: Partial<CourtshipRequest> & { requestId?: string }) {
  // ✅ store schema uses `id`, but keep compatibility with older data/UI: `requestId`
  return String(r?.id ?? (r as any)?.requestId ?? "").trim();
}

function getProfileId(r: Partial<CourtshipRequest>) {
  // ✅ store schema uses `profileId`, keep compatibility for older UI/data
  return String((r as any)?.profileId ?? (r as any)?.targetUserId ?? (r as any)?.toUserId ?? "").trim();
}

function getStatus(r: Partial<CourtshipRequest>): ReqStatus {
  const s = String((r as any)?.status ?? "Pending").trim();
  if (s === "Accepted") return "Accepted";
  if (s === "Declined") return "Declined";
  return "Pending";
}

function toTime(x: any): number {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = String(x ?? "").trim();
  if (!s) return 0;
  const t = +new Date(s);
  return Number.isFinite(t) ? t : 0;
}

function normalizeProfile(p: Profile | undefined | null, fallbackName: string) {
  const name = String(p?.name ?? fallbackName ?? "Unknown").trim() || "Unknown";
  const age = typeof p?.age === "number" ? p.age : undefined;

  const city = String(p?.city ?? "").trim();
  const state = String(p?.state ?? "").trim();

  const faith = String(p?.faith ?? "").trim();

  const avatarUrl =
    String(p?.avatarUrl ?? "").trim() ||
    `https://dummyimage.com/100x100/111/fff.png&text=${encodeURIComponent(name || "GP")}`;

  return { name, age, city, state, faith, avatarUrl };
}

export default function RequestsPage() {
  const store = useCourtshipStore();
  const incomingRaw = useMemo(() => store.incomingRequests || [], [store.incomingRequests]);
  const sentRaw = useMemo(() => store.sentRequests || [], [store.sentRequests]);
  const viewer = store.mode; // "Sender" | "Receiver" (from store)

  // ✅ store already gives role-based lists

  // ✅ Build profileMap once (fast lookup)
  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of store.profiles || []) {
      if (p?.id) m.set(String(p.id), p);
    }
    return m;
  }, [store.profiles]);

  const incomingView = useMemo(() => {
    const list = (incomingRaw || []).map((r) => {
      const profileId = getProfileId(r);
      const p0 = profileId ? profileMap.get(profileId) : undefined;
      const p = normalizeProfile(p0, "Unknown");

      const reqId = getReqId(r);
      const status = getStatus(r);
      const createdAt = toTime((r as any)?.createdAt);

      // ✅ stable key even if reqId missing
      const key = reqId || `incoming_${profileId || "no_profile"}_${createdAt || 0}`;

      return { r, key, reqId, profileId, status, p, createdAt };
    });

    list.sort((a, b) => {
      const w = (s: ReqStatus) => (s === "Pending" ? 0 : s === "Accepted" ? 1 : 2);
      return w(a.status) - w(b.status) || b.createdAt - a.createdAt;
    });

    return list;
  }, [incomingRaw, profileMap]);

  const sentView = useMemo(() => {
    const list = (sentRaw || []).map((r) => {
      const profileId = getProfileId(r);
      const p0 = profileId ? profileMap.get(profileId) : undefined;
      const p = normalizeProfile(p0, "Unknown");

      const reqId = getReqId(r);
      const status = getStatus(r);
      const createdAt = toTime((r as any)?.createdAt);

      // ✅ stable key even if reqId missing
      const key = reqId || `sent_${profileId || "no_profile"}_${createdAt || 0}`;

      return { r, key, reqId, profileId, status, p, createdAt };
    });

    list.sort((a, b) => {
      const w = (s: ReqStatus) => (s === "Pending" ? 0 : s === "Accepted" ? 1 : 2);
      return w(a.status) - w(b.status) || b.createdAt - a.createdAt;
    });

    return list;
  }, [sentRaw, profileMap]);

  async function accept(reqId: string, currentStatus: ReqStatus) {
    if (viewer !== "Receiver") return alert("⛔ Receiver pekee ndiye ana-accept.");
    if (!reqId) return alert("❌ Request ID haipo (data is invalid).");
    if (currentStatus !== "Pending") return alert("ℹ️ Hii request si Pending tena.");

    try {
      // ✅ store.acceptRequest already refreshesAll inside store
      await store.acceptRequest(reqId);
      alert("✅ Accepted. Sasa nenda MATCHES uone match mpya.");
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }

  async function decline(reqId: string, currentStatus: ReqStatus) {
    if (viewer !== "Receiver") return alert("⛔ Receiver pekee ndiye ana-decline.");
    if (!reqId) return alert("❌ Request ID haipo (data is invalid).");
    if (currentStatus !== "Pending") return alert("ℹ️ Hii request si Pending tena.");

    try {
      // ✅ store.declineRequest already refreshesAll inside store
      await store.declineRequest(reqId);
      alert("✅ Declined.");
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }

  const isReceiver = viewer === "Receiver";
  const isSender = viewer === "Sender";

  return (
    <div>
      <CourtshipTabs />

      <div style={topRow}>
        <div>
          <div style={pageTitle}>Requests</div>
          <div style={pageSub}>
            Hapa unaona interests. <b>Receiver</b> ndiye ana-accept/decline. Match inatokea baada ya Accept.
          </div>
          <div style={{ opacity: 0.78, fontSize: 12 }}>
            Viewer role: <b>{viewer}</b>
          </div>
        </div>

        <div style={modeWrap}>
          <div style={modeLabel}>Demo Mode</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={viewer === "Sender" ? btnGold : btnGhost} onClick={() => store.setMode("Sender")}>
              Sender
            </button>
            <button style={viewer === "Receiver" ? btnGold : btnGhost} onClick={() => store.setMode("Receiver")}>
              Receiver
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
            {isSender
              ? "✅ Sender anaona alizotuma (status zote)."
              : "✅ Receiver anaona incoming (status zote) + anaweza Accept/Decline Pending."}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/dashboard/courtship/matches" style={btnGhostLink as any}>
              Go to Matches
            </Link>
            <button style={btnGhost} onClick={() => store.refreshAll()} disabled={store.loading}>
              {store.loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <div style={panel}>
        {isReceiver ? (
          <>
            <div style={sectionTitle}>Incoming Requests (Receiver)</div>

            {incomingView.length === 0 ? (
              <div style={empty}>Hakuna requests kwa sasa.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {incomingView.map(({ r, key, p, profileId, reqId, status }) => (
                  <div key={key} style={card}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.avatarUrl}
                        alt={p.name}
                        style={avatar}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src =
                            "https://dummyimage.com/100x100/111/fff.png&text=GP";
                        }}
                      />

                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={nameLine}>
                          {p.name}, {p.age ?? "—"} <span style={pill(status)}>{status}</span>
                        </div>
                        <div style={meta}>
                          {(p.city || "—")}, {(p.state || "—")} • {p.faith || "—"}
                        </div>
                        <div style={subMeta}>
                          Request ID: <b>{reqId || "—"}</b>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          style={status === "Pending" ? btnGold : btnGoldDisabled}
                          disabled={store.loading || status !== "Pending" || !reqId}
                          onClick={() => accept(reqId, status)}
                        >
                          Accept
                        </button>

                        <button
                          style={status === "Pending" ? btnDanger : btnDangerDisabled}
                          disabled={store.loading || status !== "Pending" || !reqId}
                          onClick={() => decline(reqId, status)}
                        >
                          Decline
                        </button>

                        {profileId ? (
                          <Link
                            href={`/dashboard/courtship/profile?id=${encodeURIComponent(profileId)}`}
                            style={btnGhostLink as any}
                          >
                            View Profile
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={ruleBar}>🔒 Rule: Hakuna Match bila Accept. Pastor anaingia baada ya hapo.</div>
          </>
        ) : (
          <>
            <div style={sectionTitle}>Sent Requests (Sender)</div>

            {sentView.length === 0 ? (
              <div style={empty}>Bado hujatuma interest yoyote.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sentView.map(({ r, key, p, profileId, reqId, status }) => (
                  <div key={key} style={card}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.avatarUrl}
                        alt={p.name}
                        style={avatar}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src =
                            "https://dummyimage.com/100x100/111/fff.png&text=GP";
                        }}
                      />

                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={nameLine}>
                          {p.name}, {p.age ?? "—"} <span style={pill(status)}>{status}</span>
                        </div>
                        <div style={meta}>
                          {(p.city || "—")}, {(p.state || "—")} • {p.faith || "—"}
                        </div>
                        <div style={subMeta}>
                          Request ID: <b>{reqId || "—"}</b>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {profileId ? (
                          <Link
                            href={`/dashboard/courtship/profile?id=${encodeURIComponent(profileId)}`}
                            style={btnGhostLink as any}
                          >
                            View Profile
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={ruleBar}>Tip: Badilisha Demo Mode kuwa RECEIVER ili uone incoming na u-accept.</div>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================
   STYLES
   ========================= */

const topRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
};
const pageTitle: CSSProperties = { fontSize: 34, fontWeight: 950, marginBottom: 6 };
const pageSub: CSSProperties = { opacity: 0.85, marginBottom: 12 };

const modeWrap: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  borderRadius: 14,
  padding: 12,
  minWidth: 240,
};
const modeLabel: CSSProperties = { fontSize: 12, opacity: 0.85, fontWeight: 900, marginBottom: 8 };

const panel: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 350px at 20% 0%, rgba(212,175,55,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
};

const sectionTitle: CSSProperties = { fontSize: 16, fontWeight: 950, marginBottom: 12 };

const empty: CSSProperties = {
  opacity: 0.85,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
};

const card: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  padding: 12,
};

const avatar: CSSProperties = {
  width: 50,
  height: 50,
  borderRadius: 999,
  objectFit: "cover",
  border: "1px solid rgba(255,255,255,0.12)",
};

const nameLine: CSSProperties = {
  fontWeight: 950,
  fontSize: 18,
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};
const meta: CSSProperties = { opacity: 0.8, marginTop: 2 };
const subMeta: CSSProperties = { opacity: 0.7, marginTop: 6, fontSize: 12 };

const btnGold: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.34)",
  background:
    "radial-gradient(120px 60px at 30% 0%, rgba(212,175,55,0.25), transparent 70%), linear-gradient(180deg, rgba(212,175,55,0.18), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  cursor: "pointer",
};
const btnGoldDisabled: CSSProperties = { ...btnGold, opacity: 0.55, cursor: "not-allowed" };

const btnGhost: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const btnGhostLink: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const btnDanger: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
  fontWeight: 950,
  cursor: "pointer",
};
const btnDangerDisabled: CSSProperties = { ...btnDanger, opacity: 0.55, cursor: "not-allowed" };

function pill(status: ReqStatus): CSSProperties {
  if (status === "Accepted") {
    return {
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(120,255,200,0.20)",
      background: "rgba(120,255,200,0.07)",
      color: "rgba(210,255,235,0.95)",
      fontWeight: 950,
      whiteSpace: "nowrap",
      fontSize: 12,
    };
  }
  if (status === "Declined") {
    return {
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,120,120,0.28)",
      background: "rgba(255,120,120,0.10)",
      color: "rgba(255,210,210,0.95)",
      fontWeight: 950,
      whiteSpace: "nowrap",
      fontSize: 12,
    };
  }
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    fontWeight: 950,
    opacity: 0.92,
    whiteSpace: "nowrap",
    fontSize: 12,
  };
}

const ruleBar: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "linear-gradient(180deg, rgba(212,175,55,0.10), rgba(255,255,255,0.03))",
  opacity: 0.92,
};
