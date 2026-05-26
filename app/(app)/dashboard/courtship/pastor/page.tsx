"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useCourtshipStore, type Profile, type VerificationStatus } from "../_lib/courtshipStore";

type TabKey = "verify" | "approve";

function badgeForStatus(s?: VerificationStatus) {
  const v = (s || "None") as VerificationStatus;
  if (v === "Verified") return { label: "VERIFIED", style: badgeGreen };
  if (v === "Pending") return { label: "PENDING", style: badgeGold };
  if (v === "Rejected") return { label: "REJECTED", style: badgeRed };
  return { label: "NONE", style: badgeGray };
}

export default function PastorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "#fff" }}>Loading…</div>}>
      <PastorPageContent />
    </Suspense>
  );
}

function PastorPageContent() {
  const store = useCourtshipStore();
  const sp = useSearchParams();
  const router = useRouter();

  // ✅ Responsive: 2 columns on wide screens
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1100px)");
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Tabs: Verification Queue vs Couple Approval
  const [tab, setTab] = useState<TabKey>("verify");

  // ---------- Pastor Login (NEW) ----------
  const pastors = useMemo(() => {
    return [
      { pastorId: "pastor_1", label: "Pastor John (Dallas)" },
      { pastorId: "pastor_2", label: "Pastor Sarah (Houston)" },
      { pastorId: "pastor_3", label: "Pastor David (Bujumbura)" },
    ];
  }, []);

  const [pastorPick, setPastorPick] = useState<string>(pastors[0]?.pastorId || "pastor_1");

  // ✅ CHANGED: decideNote is per verificationId (NOT per profileId)
  const [decideNote, setDecideNote] = useState<Record<string, string>>({}); // per verificationId

  const myChurch = store.myPastorChurch;

  const isLogged = Boolean(store.pastorSession?.pastorId);

  async function onPastorLogin() {
    try {
      await store.pastorLogin(pastorPick);
      await store.refreshAll();
      await store.fetchPastorQueue();
      alert("✅ Pastor logged in");
      setTab("verify");
    } catch (e: any) {
      alert(e?.message || "Pastor login failed");
    }
  }

  function onPastorLogout() {
    store.pastorLogout();
    alert("✅ Pastor logged out");
  }

  async function refreshQueue() {
    try {
      await store.refreshAll();
      if (store.pastorSession?.pastorId) await store.fetchPastorQueue();
    } catch {}
  }

  // ✅ CHANGED: decide takes verificationId
  async function decide(verificationId: string, decision: "Verified" | "Rejected") {
    try {
      if (!store.pastorSession?.pastorId) throw new Error("Login kama Pastor kwanza.");
      if (!verificationId) throw new Error("verificationId missing");

      const note = decideNote[verificationId] || "";

      // ✅ IMPORTANT: pastorDecide now receives verificationId
      await store.pastorDecide(verificationId, decision, note);

      alert(`✅ ${decision} done`);
      setDecideNote((p) => ({ ...p, [verificationId]: "" }));
      await refreshQueue();
    } catch (e: any) {
      alert(e?.message || "Decision failed");
    }
  }

  // ---------- Couple Approval (OLD Step4) ----------
  const firstMatchId = store.matches[0]?.id || "";
  const [matchId, setMatchId] = useState<string>("");
  const [pastorName, setPastorName] = useState<string>("Pastor");

  // Init matchId from URL or fallback
  useEffect(() => {
    const fromUrl = sp.get("matchId") || "";

    if (fromUrl && fromUrl !== matchId) {
      setMatchId(fromUrl);
      return;
    }

    if (!fromUrl && !matchId && firstMatchId) setMatchId(firstMatchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, firstMatchId]);

  // Sync URL when matchId changes
  useEffect(() => {
    if (!matchId) return;
    const current = sp.get("matchId") || "";
    if (current === matchId) return;
    router.replace(`/dashboard/courtship/pastor?matchId=${encodeURIComponent(matchId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // PastorName from session if available
  useEffect(() => {
    if (store.pastorSession?.name) setPastorName(store.pastorSession.name);
  }, [store.pastorSession?.name]);

  const match = useMemo(() => (matchId ? store.getMatch(matchId) : undefined), [matchId, store]);
  const profile = useMemo(() => (match?.profileId ? store.getProfile(match.profileId) : undefined), [match, store]);

  const steps = useMemo(
    () => (matchId ? store.getSteps(matchId) : { s1: false, s2: false, s3: false, s4: false }),
    [matchId, store]
  );

  const canApprove = Boolean(steps.s1 && steps.s2 && steps.s3);
  const alreadyApproved = Boolean(match?.approved);

  const statusLabel = alreadyApproved ? `✅ Approved • ${match?.pastorName || "Pastor"}` : "⛔ Pending Approval";
  const progressCount = [steps.s1, steps.s2, steps.s3, steps.s4].filter(Boolean).length;
  const progressPct = Math.round((progressCount / 4) * 100);

  const approveDisabled = store.loading || alreadyApproved || !canApprove;
  const approveHint = alreadyApproved
    ? "Already approved."
    : !canApprove
    ? "⛔ Complete Steps 1–3 first (Agreement, Core Questions, Counseling Prep)."
    : "Ready to approve.";

  async function approve() {
    if (!matchId) return alert("No match selected.");
    if (!canApprove) return alert("⛔ Steps 1–3 lazima zikamilike kwanza.");
    try {
      await store.approveMatch(matchId, pastorName || "Pastor");
      alert("✅ Approved successfully");
      await store.refreshAll();
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }

  async function reset() {
    if (!matchId) return alert("No match selected.");
    try {
      await store.resetApproval(matchId);
      alert("✅ Reset approval");
      await store.refreshAll();
    } catch (e: any) {
      alert(e?.message || "Failed");
    }
  }

  async function onResetAll() {
    if (store.loading) return;

    const ok = confirm(
      "⚠️ RESET ALL (DEMO)\n\nItafuta: requests, matches, steps, chats, presence/read state, uploads.\n\nUna uhakika?"
    );
    if (!ok) return;

    try {
      await store.resetAll();
      await store.refreshAll();
      alert("✅ Reset All done.");
      router.replace("/dashboard/courtship/pastor");
      setMatchId("");
    } catch (e: any) {
      alert(e?.message || "Reset All failed");
    }
  }

  // ---------- Verify Queue UI data ----------
  const queueItems = store.pastorQueue || [];
  const pendingCount = queueItems.length;

  return (
    <div style={pageWrap}>
      <div style={pageTitle}>Pastor Panel</div>
      <div style={pageSub}>
        <b>2 things:</b> (1) Verify profiles (Church verification) + (2) Approve couple (Step 4).
      </div>

      <div style={panel}>
        {/* TOP BAR: Pastor session + Tabs */}
        <div style={topBar}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={vipBadge}>👑 VIP GOLD PURE</div>

            {isLogged ? (
              <div style={sessionPill}>
                Logged as <b>{store.pastorSession?.name || store.pastorSession?.pastorId}</b>
                {myChurch ? (
                  <span style={{ opacity: 0.8 }}>
                    {" "}
                    • {myChurch.name} ({myChurch.city})
                  </span>
                ) : null}
              </div>
            ) : (
              <div style={sessionPillDim}>No pastor session</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button style={tab === "verify" ? tabBtnActive : tabBtn} onClick={() => setTab("verify")}>
              ✅ Verification Queue {isLogged ? `(${pendingCount})` : ""}
            </button>
            <button style={tab === "approve" ? tabBtnActive : tabBtn} onClick={() => setTab("approve")}>
              💛 Couple Approval
            </button>
          </div>
        </div>

        {/* PASTOR LOGIN */}
        <div style={box}>
          <div style={rowBetween}>
            <div>
              <div style={label}>Pastor Login (Demo)</div>
              <div style={mini}>Chagua pastorId halisi (inalingana na church seed).</div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {isLogged ? (
                <button style={btnGhost} onClick={onPastorLogout}>
                  Logout
                </button>
              ) : (
                <button style={btnGold} onClick={onPastorLogin} disabled={store.loading}>
                  Login →
                </button>
              )}

              <button style={btnGhost} onClick={refreshQueue} disabled={store.loading}>
                Refresh
              </button>

              <button style={btnDanger} onClick={onResetAll} disabled={store.loading}>
                Reset All (Demo)
              </button>
            </div>
          </div>

          <div style={{ height: 10 }} />

          <select value={pastorPick} onChange={(e) => setPastorPick(e.target.value)} style={select} disabled={isLogged}>
            {pastors.map((p) => (
              <option key={p.pastorId} value={p.pastorId}>
                {p.label} • {p.pastorId}
              </option>
            ))}
          </select>

          <div style={dangerNote}>⚠️ Kwa demo: pastor session ni localStorage tu. Mfumo wa real utahitaji auth.</div>
        </div>

        {/* CONTENT */}
        {tab === "verify" ? (
          <div
            style={{
              ...grid,
              gridTemplateColumns: isWide ? "1.2fr 0.8fr" : "1fr",
              alignItems: "start",
              marginTop: 12,
            }}
          >
            {/* LEFT: Queue list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={box}>
                <div style={rowBetween}>
                  <div>
                    <div style={label}>Verification Queue</div>
                    <div style={mini}>Hapa pastor ataona profiles zilizoomba verification kwenye church yake.</div>
                  </div>
                  <div style={pillProgress}>{pendingCount} Pending</div>
                </div>

                {!isLogged ? (
                  <div style={empty}>Login kama Pastor kwanza ili uone queue.</div>
                ) : pendingCount === 0 ? (
                  <div style={empty}>Hakuna pending verifications kwa church yako.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                    {queueItems.map((item: any) => {
                      const p = item?.profile as Profile | null;
                      const v = item?.verification as any;
                      const ch = item?.church as any;

                      // ✅ KEY CHANGE: use verificationId
                      const verificationId = String(v?.id || "");

                      // ✅ Better: show badge based on verification status from verification record (live)
                      const st = badgeForStatus((v?.status as VerificationStatus) || p?.verificationStatus);

                      return (
                        <div key={verificationId || p?.id} style={queueCard}>
                          <div style={queueTop}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <div style={st.style}>{st.label}</div>
                              <div style={{ fontWeight: 950 }}>
                                {p?.name || "Unknown"} {p?.age ? `• ${p.age}` : ""}
                              </div>
                              <div style={{ opacity: 0.75 }}>
                                {p?.city || "—"}, {p?.state || "—"}
                              </div>
                            </div>
                            <div style={pillMini}>{ch?.name || p?.churchName || "No church"}</div>
                          </div>

                          <div style={{ marginTop: 8, opacity: 0.9, lineHeight: 1.6 }}>
                            <b>Requested by:</b> {v?.requestedBy || "—"} • <b>RequestedAt:</b>{" "}
                            {v?.requestedAt ? new Date(v.requestedAt).toLocaleString() : "—"}
                          </div>

                          {v?.note ? (
                            <div style={noteBox}>
                              <b>Note:</b> {v.note}
                            </div>
                          ) : null}

                          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <input
                              style={input}
                              // ✅ CHANGED: note keyed by verificationId
                              value={decideNote[verificationId] || ""}
                              onChange={(e) => setDecideNote((prev) => ({ ...prev, [verificationId]: e.target.value }))}
                              placeholder="Decision note (optional)..."
                              disabled={store.loading}
                            />
                            <button
                              style={btnGold}
                              // ✅ CHANGED: send verificationId
                              onClick={() => decide(verificationId, "Verified")}
                              disabled={store.loading || !verificationId}
                            >
                              Verify ✅
                            </button>
                            <button
                              style={btnDanger}
                              // ✅ CHANGED: send verificationId
                              onClick={() => decide(verificationId, "Rejected")}
                              disabled={store.loading || !verificationId}
                            >
                              Reject ⛔
                            </button>

                            <Link href={`/dashboard/courtship/me`} style={btnLink}>
                              Open “Me” page
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Rules */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={box}>
                <div style={rowBetween}>
                  <div>
                    <div style={label}>Verification Rules</div>
                    <div style={mini}>Discover policy</div>
                  </div>
                  <div style={pillMini}>VIP GOLD</div>
                </div>

                <div style={tip}>
                  ✅ Kama profile ina <b>Pastor Approval = Required</b>, lazima:
                  <ul style={{ margin: "8px 0 0 18px", opacity: 0.9, lineHeight: 1.7 }}>
                    <li>Ichague Church</li>
                    <li>Itume Verification Request</li>
                    <li>Pastor a-verify (status = Verified)</li>
                  </ul>
                  Ndipo i-appear kwenye <b>Discover</b> na kupokea interests.
                </div>

                <div style={tip}>🔁 Ukireject unaweza kuacha note. User anaweza kuomba tena.</div>
              </div>
            </div>
          </div>
        ) : (
          // tab === "approve"
          <div style={{ marginTop: 12 }}>
            {store.matches.length === 0 ? (
              <div style={empty}>
                Hakuna matches bado. Nenda <b>Requests</b> (Receiver) u-accept request kwanza.
              </div>
            ) : (
              <div
                style={{
                  ...grid,
                  gridTemplateColumns: isWide ? "1.2fr 0.8fr" : "1fr",
                  alignItems: "start",
                }}
              >
                {/* LEFT */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={box}>
                    <div style={rowBetween}>
                      <div>
                        <div style={label}>Chagua Match</div>
                        <div style={mini}>Match unayotaka ku-approve (Step 4)</div>
                      </div>
                      <div style={pillProgress}>{progressPct} Progress</div>
                    </div>

                    <select value={matchId} onChange={(e) => setMatchId(e.target.value)} style={select}>
                      {store.matches.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} (profile: {m.profileId})
                        </option>
                      ))}
                    </select>

                    <div style={{ height: 10 }} />

                    <div style={label}>Jina la Pastor (Step4)</div>
                    <input value={pastorName} onChange={(e) => setPastorName(e.target.value)} style={input} placeholder="Pastor name" />

                    <div style={{ height: 10 }} />

                    <div style={statusRow}>
                      <div style={{ fontWeight: 950 }}>Status:</div>
                      <div style={alreadyApproved ? pillApproved : pillPending}>{statusLabel}</div>
                      {!canApprove && !alreadyApproved ? <div style={pillWarn}>Not ready</div> : null}
                      {canApprove && !alreadyApproved ? <div style={pillReady}>Ready</div> : null}
                    </div>
                  </div>

                  {profile ? (
                    <div style={box}>
                      <div style={profileCardBig}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={profile.avatarUrl} alt={profile.name} style={avatarBig} />
                        <div style={{ flex: 1 }}>
                          <div style={pName}>
                            {profile.name}, {profile.age} • {profile.gender}
                          </div>
                          <div style={pMeta}>
                            {profile.city}, {profile.state} • {profile.faith}
                          </div>

                          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <div style={profile.pastorApproval === "Required" ? pillReq : pillOpt}>{profile.pastorApproval}</div>
                            <div style={pillMini}>Match: {matchId}</div>
                          </div>
                        </div>
                      </div>

                      {alreadyApproved && match?.approvedAt ? (
                        <div style={approvedInfo}>
                          Approved by <b>{match.pastorName || "Pastor"}</b> • {new Date(match.approvedAt).toLocaleString()}
                        </div>
                      ) : null}

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                        <button style={approveDisabled ? btnGoldDisabled : btnGold} disabled={approveDisabled} onClick={approve} title={approveHint}>
                          Approve Couple
                        </button>

                        <button style={btnGhost} disabled={store.loading || !alreadyApproved} onClick={reset}>
                          Reset Approval
                        </button>

                        <Link href={`/dashboard/courtship/couple?matchId=${encodeURIComponent(matchId || "")}`} style={btnLink}>
                          Open Couple Dashboard
                        </Link>

                        <Link href="/dashboard/courtship/matches" style={btnLink}>
                          Back to Matches
                        </Link>
                      </div>

                      {!canApprove && !alreadyApproved ? (
                        <div style={warnBox}>
                          ⛔ <b>Huwezi ku-approve bado.</b> Lazima steps 1–3 zikamilike kwanza kwenye Couple page: Agreement, Core Questions, Counseling Prep.
                        </div>
                      ) : alreadyApproved ? (
                        <div style={okBox}>
                          ✅ <b>Approved.</b> Sasa step 4 imekuwa ON (Engagement Mode).
                        </div>
                      ) : (
                        <div style={okBox}>
                          ✅ <b>Ready.</b> Steps 1–3 zimekamilika. Pastor anaweza ku-approve sasa.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={box}>
                      <div style={empty}>Profile haijapatikana kwa match hii.</div>
                    </div>
                  )}
                </div>

                {/* RIGHT */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={box}>
                    <div style={rowBetween}>
                      <div>
                        <div style={label}>Approval Rules</div>
                        <div style={mini}>Steps 1–3 required</div>
                      </div>
                      <div style={pillMini}>VIP GOLD</div>
                    </div>

                    <div style={stepsGrid}>
                      <StepItem title="Step 1" name="Agreement" done={steps.s1} />
                      <StepItem title="Step 2" name="Core Questions" done={steps.s2} />
                      <StepItem title="Step 3" name="Counseling Prep" done={steps.s3} />
                      <StepItem title="Step 4" name="Pastor Approval" done={steps.s4} />
                    </div>

                    <div style={tip}>Tip: Requests → Accept → Matches → (Complete Steps 1–3) → Pastor Approval → Engagement Mode.</div>
                  </div>

                  <div style={box}>
                    <div style={label}>Quick Actions</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Link href={`/dashboard/courtship/couple?matchId=${encodeURIComponent(matchId || "")}`} style={btnLink}>
                        Go to Couple Steps
                      </Link>
                      <Link href="/dashboard/courtship/requests" style={btnLink}>
                        Go to Requests
                      </Link>
                      <button style={btnGhost} onClick={() => store.refreshAll()} disabled={store.loading}>
                        Refresh
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StepItem(props: { title: string; name: string; done: boolean }) {
  return (
    <div style={stepCard}>
      <div style={stepTitle}>{props.title}</div>
      <div style={stepName}>{props.name}</div>
      <div style={props.done ? stepDone : stepPending}>{props.done ? "Done ✅" : "Pending ⏳"}</div>
    </div>
  );
}

/* =========================
   STYLES (unchanged)
   ========================= */

const pageWrap: CSSProperties = { width: "100%", maxWidth: "none" };

const pageTitle: CSSProperties = { fontSize: 34, fontWeight: 950, marginBottom: 6 };
const pageSub: CSSProperties = { opacity: 0.85, marginBottom: 12 };

const panel: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(800px 300px at 20% 0%, rgba(212,175,55,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
};

const topBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

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

const sessionPill: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.24)",
  background: "rgba(212,175,55,0.08)",
  fontWeight: 950,
  color: "rgba(255,236,190,0.95)",
};

const sessionPillDim: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  fontWeight: 950,
  opacity: 0.85,
};

const tabBtn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const tabBtnActive: CSSProperties = {
  ...tabBtn,
  border: "1px solid rgba(212,175,55,0.32)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 14,
};

const box: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  padding: 12,
};

const rowBetween: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 };

const empty: CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.9,
  lineHeight: 1.7,
};

const label: CSSProperties = { fontSize: 12, opacity: 0.85, fontWeight: 900, marginBottom: 6 };
const mini: CSSProperties = { fontSize: 12, opacity: 0.7, marginTop: -2 };

const select: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.20)",
  color: "inherit",
  outline: "none",
};

const input: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.20)",
  color: "inherit",
  outline: "none",
  minWidth: 240,
};

const pillMini: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.20)",
  fontWeight: 900,
  opacity: 0.9,
  fontSize: 12,
};

const pillProgress: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.30)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.95)",
  fontWeight: 950,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const statusRow: CSSProperties = { display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" };

const pillPending: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.20)",
  fontWeight: 950,
  opacity: 0.9,
};

const pillApproved: CSSProperties = {
  ...pillPending,
  border: "1px solid rgba(212,175,55,0.30)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.95)",
};

const pillWarn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
  fontWeight: 950,
};

const pillReady: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(120,255,180,0.20)",
  background: "rgba(120,255,180,0.10)",
  color: "rgba(210,255,235,0.95)",
  fontWeight: 950,
};

const btnGold: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.30)",
  background: "linear-gradient(180deg, rgba(212,175,55,0.22), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  cursor: "pointer",
};

const btnGoldDisabled: CSSProperties = {
  ...btnGold,
  opacity: 0.55,
  cursor: "not-allowed",
};

const btnGhost: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const btnLink: CSSProperties = {
  ...btnGhost,
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

const dangerNote: CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(255,120,120,0.22)",
  background: "rgba(255,120,120,0.06)",
  opacity: 0.92,
  fontSize: 12,
  lineHeight: 1.6,
};

const profileCardBig: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  borderRadius: 14,
};

const avatarBig: CSSProperties = {
  width: 92,
  height: 92,
  borderRadius: 18,
  objectFit: "cover",
  border: "1px solid rgba(255,255,255,0.12)",
};

const pName: CSSProperties = { fontWeight: 950, fontSize: 16 };
const pMeta: CSSProperties = { opacity: 0.8, marginTop: 2, fontSize: 13 };

const pillReq: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
  fontWeight: 950,
  whiteSpace: "nowrap",
};

const pillOpt: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  fontWeight: 950,
  opacity: 0.92,
  whiteSpace: "nowrap",
};

const approvedInfo: CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "linear-gradient(180deg, rgba(212,175,55,0.10), rgba(255,255,255,0.03))",
  opacity: 0.95,
  fontSize: 13,
};

const warnBox: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,120,120,0.22)",
  background: "linear-gradient(180deg, rgba(255,120,120,0.10), rgba(255,255,255,0.03))",
  opacity: 0.95,
  fontSize: 13,
  lineHeight: 1.6,
};

const okBox: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(120,255,180,0.18)",
  background: "linear-gradient(180deg, rgba(120,255,180,0.08), rgba(255,255,255,0.03))",
  opacity: 0.95,
  fontSize: 13,
  lineHeight: 1.6,
};

const stepsGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  marginTop: 10,
};

const stepCard: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.14)",
  padding: 12,
};

const stepTitle: CSSProperties = { fontSize: 12, opacity: 0.8, fontWeight: 900 };
const stepName: CSSProperties = { marginTop: 4, fontWeight: 950 };
const stepPending: CSSProperties = { marginTop: 8, opacity: 0.85, fontWeight: 900 };
const stepDone: CSSProperties = { marginTop: 8, fontWeight: 950, color: "rgba(210,255,235,0.95)" };

const tip: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "linear-gradient(180deg, rgba(212,175,55,0.10), rgba(255,255,255,0.03))",
  opacity: 0.92,
  lineHeight: 1.6,
};

const queueCard: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.14)",
  padding: 12,
};

const queueTop: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const noteBox: CSSProperties = {
  marginTop: 8,
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.95,
  lineHeight: 1.6,
  fontSize: 13,
};

// Badges
const badgeBase: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  fontWeight: 950,
  fontSize: 11,
  letterSpacing: 0.4,
};

const badgeGreen: CSSProperties = {
  ...badgeBase,
  border: "1px solid rgba(120,255,170,0.30)",
  background: "rgba(120,255,170,0.10)",
  color: "rgba(220,255,235,0.98)",
};

const badgeGold: CSSProperties = {
  ...badgeBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
};

const badgeRed: CSSProperties = {
  ...badgeBase,
  border: "1px solid rgba(255,120,120,0.30)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.98)",
};

const badgeGray: CSSProperties = {
  ...badgeBase,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.14)",
  color: "rgba(255,255,255,0.86)",
};
