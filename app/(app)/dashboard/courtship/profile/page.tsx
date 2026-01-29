// app/(app)/dashboard/courtship/profile/page.tsx
"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import CourtshipTabs from "../_components/CourtshipTabs";
import { useCourtshipStore, type VerificationStatus, type ChatSender } from "../_lib/courtshipStore";

function getChurchMeta(p: any, churches: any[]) {
  const churchId = String(p?.churchId || "").trim();
  const churchNameFromProfile = String(p?.churchName || "").trim();
  const pastorIdFromProfile = String(p?.pastorId || "").trim();

  const church = churchId ? (churches || []).find((c) => c?.id === churchId) : null;

  const churchName = String(church?.name || churchNameFromProfile || "").trim();
  const pastorId = String(church?.pastorId || pastorIdFromProfile || "").trim();
  const pastorName = String(church?.pastorName || "").trim();

  // aligned: "None" | "Pending" | "Verified" | "Rejected"
  const rawStatus = String(p?.verificationStatus || "").trim();
  const status: VerificationStatus =
    rawStatus === "Pending" || rawStatus === "Verified" || rawStatus === "Rejected" ? (rawStatus as any) : "None";

  const requestedAt = String(p?.verificationRequestedAt || "").trim();
  const decidedAt = String(p?.verificationDecidedAt || "").trim();
  const note = String(p?.verificationNote || "").trim();

  const isLinked = Boolean(churchId);
  const isVerified = status === "Verified";

  return {
    churchId,
    churchName,
    pastorId,
    pastorName,
    status,
    requestedAt,
    decidedAt,
    note,
    isLinked,
    isVerified,
  };
}

function reqProfileId(r: any) {
  return String(r?.profileId ?? r?.targetUserId ?? r?.toUserId ?? "").trim();
}

async function apiPostJson(body: any) {
  const res = await fetch(`/api/courtship`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error((json as any)?.error || "API POST failed");
  return json as any;
}

export default function ProfilePage() {
  const sp = useSearchParams();
  const id = String(sp.get("id") || "").trim();

  const store = useCourtshipStore();
  const churches = useMemo(() => store.churches || [], [store.churches]);
  const { db, loading } = store;

  const [sending, setSending] = useState(false);

  // submit-to-pastor UI state (only for my own profile)
  const [submitNote, setSubmitNote] = useState<string>("Please verify my membership.");
  const [selectedChurchId, setSelectedChurchId] = useState<string>("");

  const p = useMemo(() => {
    if (!id) return null;
    const list = db?.profiles || [];
    return list.find((x: any) => x?.id === id) || null;
  }, [db?.profiles, id]);

  const dbChurches = useMemo(() => db?.churches || [], [db?.churches]);
  const viewer: ChatSender = store.mode;

  const church = useMemo(() => (p ? getChurchMeta(p as any, dbChurches as any[]) : null), [p, dbChurches]);

  // if viewing my own profile (demo mode matches owner)
  const isMine = useMemo(() => {
    if (!p) return false;
    const owner = String((p as any)?.owner || "").trim();
    return owner === viewer;
  }, [p, viewer]);

  // default church dropdown
  useEffect(() => {
    if (!isMine) return;

    // prefer profile churchId, else first church
    const preferred = String((p as any)?.churchId || "").trim();
    const first = String((dbChurches as any[])?.[0]?.id || "").trim();

    setSelectedChurchId((prev) => prev || preferred || first || "");
  }, [isMine, p, dbChurches]);

  // Detect request/match state for this profile (robust)
  const state = useMemo(() => {
    const reqs = db?.requests || [];
    const matches = db?.matches || [];

    const pending = id ? reqs.some((r: any) => reqProfileId(r) === id && r.status === "Pending") : false;
    const accepted = id ? reqs.some((r: any) => reqProfileId(r) === id && r.status === "Accepted") : false;

    const match = id ? (matches as any[]).find((m: any) => m?.profileId === id) || null : null;

    return {
      pending,
      accepted,
      match,
      matched: Boolean(match),
      acceptedButNoMatch: Boolean(accepted && !match),
    };
  }, [db?.requests, db?.matches, id]);

  const busy = loading || sending;

  /**
   * IMPORTANT RULE (matches server policy):
   * If pastorApproval is Required:
   * - must be linked to church
   * - AND must be VERIFIED (REQUIRE_VERIFIED_FOR_REQUIRED = true)
   */
  const mustHaveChurchLink = p?.pastorApproval === "Required";
  const hasChurchLink = Boolean(church?.isLinked);

  const requireVerifiedBeforeInterest = mustHaveChurchLink;
  const hasVerified = Boolean(church?.isVerified);

  const canSendInterest = !mustHaveChurchLink
    ? true
    : requireVerifiedBeforeInterest
    ? hasChurchLink && hasVerified
    : hasChurchLink;

  const cta = state.matched
    ? "Matched ✅"
    : state.pending
    ? "Already Sent ✅"
    : sending
    ? "Sending..."
    : "Send Interest";

  function blockReason() {
    if (!p) return null;

    if (viewer !== "Sender") return "⛔ Huwezi kutuma interest ukiwa RECEIVER. Badilisha Demo Mode kuwa SENDER.";
    if (state.matched) return "✅ Tayari mmekuwa MATCH. Nenda Matches.";
    if (state.pending) return "📩 Interest tayari imeshatumwa. Subiri Receiver a-accept kwenye Requests.";
    if (!mustHaveChurchLink) return null;

    if (!hasChurchLink) return "⚠️ Pastor approval is required: lazima u-link Church kwanza.";
    if (!hasVerified) return "⚠️ Pastor approval is required: profile lazima iwe VERIFIED na pastor/church kwanza.";
    return null;
  }

  const reason = blockReason();
  const disableSend = busy || state.pending || state.matched || !canSendInterest;

  async function submitMineToPastor() {
    if (!isMine) return;
    if (viewer !== "Sender" && viewer !== "Receiver") {
      alert("Only Sender/Receiver can submit profile.");
      return;
    }

    const cid = String(selectedChurchId || "").trim();
    if (!cid) {
      alert("Chagua church kwanza.");
      return;
    }

    setSending(true);
    try {
      await apiPostJson({
        action: "submit_profile",
        user: viewer,
        churchId: cid,
        note: String(submitNote || "").trim(),
      });

      alert("✅ Profile submitted to Pastor. Nenda Church Dashboard → Queue uone item, kisha Verify/Reject.");
      await store.refreshAll();
    } catch (e: any) {
      alert(e?.message || "Failed to submit profile");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <CourtshipTabs />

      <div style={panel}>
        {loading && <div style={{ opacity: 0.85 }}>Loading...</div>}

        {!loading && !id && (
          <div style={emptyBox}>
            <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 6 }}>No profile selected</div>
            <div style={{ opacity: 0.9, lineHeight: 1.7 }}>
              Fungua profile kwa kutumia link kama:
              <div style={codeLine}>/dashboard/courtship/profile?id=p1</div>
              Au rudi Discover uchague mtu.
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/dashboard/courtship/discover" style={btnGhostLink}>
                Back to Discover
              </Link>
              <Link href="/dashboard/courtship/matches" style={btnGhostLink}>
                Go to Matches
              </Link>
              <Link href="/dashboard/courtship/me" style={btnGhostLink}>
                My Profile / Link Church
              </Link>
            </div>
          </div>
        )}

        {!loading && id && p && (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.avatarUrl} alt={p.name} style={avatar} />

              <div style={{ flex: 1 }}>
                <div style={title}>
                  {p.name}, {p.age}
                </div>
                <div style={{ opacity: 0.85 }}>
                  {p.gender} • {p.city}, {p.state} • {p.faith} • Goal: <b>{p.goal}</b>
                </div>
                <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
                  Viewer Mode: <b>{viewer}</b> {isMine ? <span style={{ marginLeft: 8 }}>• (This is MY profile)</span> : null}
                </div>
              </div>

              <div style={p.pastorApproval === "Required" ? pillRequired : pillOptional}>
                {p.pastorApproval === "Required" ? "Pastor approval required" : "Pastor approval optional"}
              </div>
            </div>

            {/* ✅ SUBMIT MY PROFILE TO PASTOR (only when viewing my profile) */}
            {isMine ? (
              <div style={box}>
                <div style={secTitle}>Submit My Profile to Pastor</div>

                <div style={{ opacity: 0.9, lineHeight: 1.6 }}>
                  Hii button inatengeneza <b>Pending verification</b> kwenye Church Dashboard → <b>Queue</b>.
                  Ukisha-verify, profile yako itaenda <b>Active + Verified</b>.
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10, maxWidth: 520 }}>
                  <div>
                    <div style={miniLabel}>Choose Church</div>
                    <select
                      style={select}
                      value={selectedChurchId}
                      onChange={(e) => setSelectedChurchId(e.target.value)}
                      disabled={busy}
                    >
                      {churches.length === 0 ? <option value="">No churches</option> : null}
                      {churches.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.id}) — {c.pastorName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={miniLabel}>Note to Pastor</div>
                    <textarea
                      style={textarea}
                      value={submitNote}
                      onChange={(e) => setSubmitNote(e.target.value)}
                      disabled={busy}
                      rows={3}
                      placeholder="Please verify my membership..."
                    />
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={btnGold} onClick={submitMineToPastor} disabled={busy}>
                      {busy ? "Submitting..." : "Submit to Pastor"}
                    </button>

                    <Link href="/dashboard/church" style={btnGhostLink}>
                      Open Church Dashboard
                    </Link>
                  </div>
                </div>

                {church?.status === "Pending" ? (
                  <div style={{ marginTop: 10, ...bannerSoft }}>
                    ⏳ <b>Already Pending.</b> Subiri Pastor a-decide kwenye Church Dashboard.
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* CHURCH LINK + VERIFICATION */}
            <div style={box}>
              <div style={secTitle}>Church & Pastor Verification</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={chip}>
                  <b>Church:</b>{" "}
                  {church?.churchName ? church.churchName : church?.churchId ? `Church ID: ${church.churchId}` : "— None"}
                </div>

                <div style={church?.status === "Verified" ? chipGood : church?.status === "Pending" ? chipSoft : chip}>
                  <b>Status:</b>{" "}
                  {church?.status === "Verified"
                    ? "Verified ✅"
                    : church?.status === "Pending"
                    ? "Pending ⏳"
                    : church?.status === "Rejected"
                    ? "Rejected ❌"
                    : "None"}
                </div>

                {church?.pastorName ? (
                  <div style={chip}>
                    <b>Pastor:</b> {church.pastorName}
                  </div>
                ) : null}

                {church?.decidedAt ? (
                  <div style={chip}>
                    <b>Decided At:</b> {new Date(church.decidedAt).toLocaleString()}
                  </div>
                ) : null}

                {church?.note ? (
                  <div style={chip}>
                    <b>Note:</b> {church.note}
                  </div>
                ) : null}
              </div>

              {mustHaveChurchLink && !hasChurchLink && (
                <div style={bannerWarn}>
                  ⚠️ <b>Pastor approval is required.</b> Hii profile lazima iwe <b>linked na Church</b>.
                  <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Link href="/dashboard/courtship/me" style={btnGhostLink}>
                      Link Church (My Profile)
                    </Link>
                    <Link href="/dashboard/courtship/discover" style={btnGhostLink}>
                      Back to Discover
                    </Link>
                  </div>
                </div>
              )}

              {mustHaveChurchLink && hasChurchLink && !hasVerified && (
                <div style={bannerSoft}>
                  ✅ Church ime-linkiwa. Kwa policy ya sasa, <b>verification</b> lazima iwe <b>Verified</b> kabla ya interest
                  (API inazuia).
                </div>
              )}

              {mustHaveChurchLink && hasVerified && (
                <div style={bannerGood}>
                  ✅ <b>Verified.</b> Hii profile tayari ime-thibitishwa na pastor/church.
                </div>
              )}
            </div>

            {(state.pending || state.matched || state.acceptedButNoMatch) && (
              <div style={state.matched ? bannerGood : bannerSoft}>
                {state.matched ? (
                  <>
                    ✅ <b>Matched.</b> Nenda <b>Matches</b> → <b>Pastor Approval</b> → <b>Couple</b>.
                  </>
                ) : state.acceptedButNoMatch ? (
                  <>
                    ⚠️ <b>Accepted</b> lakini <b>match record</b> haipo. (Data mismatch) — fanya <b>Reset All</b> au re-accept
                    request.
                  </>
                ) : (
                  <>
                    📩 <b>Interest already sent.</b> Subiri Receiver a-accept kwenye <b>Requests</b>.
                  </>
                )}
              </div>
            )}

            <div style={box}>
              <div style={secTitle}>Biography</div>
              <div style={{ opacity: 0.9, lineHeight: 1.8 }}>{p.bio}</div>
            </div>

            <div style={box}>
              <div style={secTitle}>Details</div>
              <div style={{ opacity: 0.9, lineHeight: 1.9 }}>
                <div>
                  <b>Kazi:</b> {p.job}
                </div>
                <div>
                  <b>Ana mtoto?</b> {p.hasKids ? "Ndiyo" : "Hapana"}
                </div>
                <div>
                  <b>Pastor approval:</b> {p.pastorApproval}
                </div>
              </div>
            </div>

            {/* CTA ROW */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button
                style={disableSend ? btnGoldDisabled : btnGold}
                disabled={disableSend}
                onClick={async () => {
                  if (!p?.id) return;

                  if (viewer !== "Sender") {
                    alert("⛔ Huwezi kutuma interest ukiwa RECEIVER. Badilisha Demo Mode kuwa SENDER.");
                    return;
                  }

                  if (!canSendInterest) {
                    alert(reason || "⚠️ Huwezi kutuma interest kwa sasa.");
                    return;
                  }

                  setSending(true);
                  try {
                    await store.sendInterest(p.id);
                    alert("✅ Interest sent. Nenda Requests (Receiver) u-ACCEPT, kisha Matches.");
                    await store.refreshAll();
                  } catch (e: any) {
                    alert(e?.message || "Failed to send interest");
                  } finally {
                    setSending(false);
                  }
                }}
              >
                {cta}
              </button>

              <Link href="/dashboard/courtship/discover" style={btnGhostLink}>
                Back to Discover
              </Link>

              <Link href="/dashboard/courtship/matches" style={btnGhostLink}>
                Go to Matches
              </Link>

              <Link href="/dashboard/courtship/me" style={btnGhostLink}>
                My Profile / Link Church
              </Link>
            </div>

            {reason ? (
              <div style={ruleWarn}>
                <b>Blocked:</b> {reason}
              </div>
            ) : null}

            <div style={rule}>✅ Pastor mmoja akisha-approve → Engagement Mode.</div>
          </>
        )}

        {!loading && id && !p && (
          <div style={{ opacity: 0.88 }}>
            Profile not found.{" "}
            <Link style={backLink} href="/dashboard/courtship/discover">
              Back to Discover
            </Link>
          </div>
        )}
      </div>
    </div>
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

const emptyBox: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
  opacity: 0.95,
  lineHeight: 1.7,
};

const codeLine: CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.20)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  display: "inline-block",
};

const title: CSSProperties = { fontSize: 34, fontWeight: 950 };

const avatar: CSSProperties = {
  width: 80,
  height: 80,
  borderRadius: 20,
  objectFit: "cover",
  border: "1px solid rgba(255,255,255,0.16)",
};

const box: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
};

const secTitle: CSSProperties = { fontWeight: 950, marginBottom: 8, color: "rgba(255,236,190,0.98)" };

const pillRequired: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
  fontWeight: 950,
  whiteSpace: "nowrap",
};

const pillOptional: CSSProperties = {
  ...pillRequired,
  border: "1px solid rgba(212,175,55,0.26)",
  background: "rgba(212,175,55,0.08)",
  color: "rgba(255,236,190,0.95)",
};

const bannerSoft: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.95,
  lineHeight: 1.6,
};

const bannerGood: CSSProperties = {
  ...bannerSoft,
  border: "1px solid rgba(120,255,180,0.18)",
  background: "linear-gradient(180deg, rgba(120,255,180,0.08), rgba(255,255,255,0.03))",
};

const bannerWarn: CSSProperties = {
  ...bannerSoft,
  border: "1px solid rgba(255,180,120,0.18)",
  background: "linear-gradient(180deg, rgba(255,180,120,0.10), rgba(255,255,255,0.03))",
};

const btnGold: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.34)",
  background:
    "radial-gradient(120px 60px at 30% 0%, rgba(212,175,55,0.25), transparent 70%), linear-gradient(180deg, rgba(212,175,55,0.18), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  cursor: "pointer",
  boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
};

const btnGoldDisabled: CSSProperties = {
  ...btnGold,
  opacity: 0.55,
  cursor: "not-allowed",
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

const chip: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.14)",
  fontWeight: 800,
  opacity: 0.95,
};

const chipSoft: CSSProperties = {
  ...chip,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "rgba(212,175,55,0.08)",
};

const chipGood: CSSProperties = {
  ...chip,
  border: "1px solid rgba(120,255,180,0.22)",
  background: "rgba(120,255,180,0.08)",
};

const rule: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "linear-gradient(180deg, rgba(212,175,55,0.10), rgba(255,255,255,0.03))",
  opacity: 0.95,
};

const ruleWarn: CSSProperties = {
  ...rule,
  border: "1px solid rgba(255,180,120,0.22)",
  background: "linear-gradient(180deg, rgba(255,180,120,0.10), rgba(255,255,255,0.03))",
};

const backLink: CSSProperties = {
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  textDecoration: "none",
};

const miniLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  opacity: 0.85,
  marginBottom: 6,
};

const select: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "rgba(255,255,255,0.92)",
  fontWeight: 800,
  outline: "none",
};

const textarea: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "rgba(255,255,255,0.92)",
  fontWeight: 700,
  outline: "none",
  resize: "vertical",
};
