// app/(app)/dashboard/courtship/me/page.tsx
"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import CourtshipTabs from "../_components/CourtshipTabs";
import {
  useCourtshipStore,
  type ChatSender,
  type PastorApproval,
  type Profile,
  type VerificationStatus,
} from "../_lib/courtshipStore";

/**
 * ✅ FIXES (THIS FILE)
 * 1) Security: upsertMyProfile now sends ONLY editable fields (no verificationStatus / timestamps etc.)
 * 2) UX: Pastor/Verification actions respect PastorApproval Required vs Optional.
 * 3) Better status display (shows profile.status if backend provides it).
 */

function emptyForm(owner: ChatSender): Profile {
  return {
    id: "",
    owner,
    name: "",
    age: 24,
    city: "",
    state: "",
    country: "US",
    gender: "Male",
    faith: "Christian",
    goal: "Marriage",
    bio: "",
    job: "",
    hasKids: false,
    pastorApproval: "Required",
    avatarUrl: "",
    tags: [],

    churchId: "",
    churchName: "",
    pastorId: "",
    verificationStatus: "None",
    verificationRequestedAt: "",
    verificationDecidedAt: "",
    verificationNote: "",

    // pastor gate (optional fields from type)
    status: "Draft",
    pastorGateNote: "",
    pastorGateAt: "",
    pastorGateBy: "",
  };
}

function statusTone(s?: VerificationStatus) {
  const v = (s || "None") as VerificationStatus;
  if (v === "Verified") return { label: "VERIFIED", style: badgeGreen };
  if (v === "Pending") return { label: "PENDING", style: badgeGold };
  if (v === "Rejected") return { label: "REJECTED", style: badgeRed };
  return { label: "NONE", style: badgeGray };
}

function profileStatusTone(s?: Profile["status"]) {
  const v = (s || "Draft") as NonNullable<Profile["status"]>;
  if (v === "Active") return { label: "ACTIVE", style: badgeGreen };
  if (v === "PendingPastor") return { label: "PENDING PASTOR", style: badgeGold };
  if (v === "Locked") return { label: "LOCKED", style: badgeRed };
  return { label: "DRAFT", style: badgeGray };
}

export default function MyCourtshipProfilePage() {
  const store = useCourtshipStore();
  const busy = store.loading;

  const role = store.mode as ChatSender; // Sender | Receiver (demo)

  const [loadingMe, setLoadingMe] = useState(false);
  const [err, setErr] = useState<string>("");
  const [okMsg, setOkMsg] = useState<string>("");

  const [me, setMe] = useState<Profile>(() => emptyForm(role));
  const [hasProfile, setHasProfile] = useState(false);

  const [tagInput, setTagInput] = useState("");
  const [noteToPastor, setNoteToPastor] = useState("");

  // Keep owner aligned on role change
  useEffect(() => {
    setMe((p) => ({ ...p, owner: role }));
     
  }, [role]);

  async function loadMe() {
    setErr("");
    setOkMsg("");
    setLoadingMe(true);
    try {
      // ensure db for churches
      if (!store.db) await store.refreshAll();

      const res = await store.fetchMyProfile();
      const p = res.profile;

      if (p) {
        setHasProfile(true);
        setMe((prev) => ({
          ...prev,
          ...p,
          owner: role,
          tags: Array.isArray(p.tags) ? p.tags : [],
          country: p.country || "US",
          status: (p.status as any) || prev.status || "Draft",
        }));
        setTagInput((Array.isArray(p.tags) ? p.tags : []).join(", "));
      } else {
        setHasProfile(false);
        setMe(emptyForm(role));
        setTagInput("");
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load profile");
    } finally {
      setLoadingMe(false);
    }
  }

  useEffect(() => {
    loadMe().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const churches = useMemo(() => store.churches || [], [store.churches]);
  const selectedChurch = useMemo(
    () => churches.find((c) => c.id === me.churchId) || null,
    [churches, me.churchId]
  );

  const verification = statusTone(me.verificationStatus);
  const gate = profileStatusTone(me.status);

  const requirePastor = me.pastorApproval === "Required";

  const hasId = Boolean(String(me.id || "").trim());
  const hasChurch = Boolean(String(me.churchId || "").trim());

  // ✅ Buttons states
  const canSave = !busy && !loadingMe;

  // Request Verification (needs church)
  const canRequestVerification =
    !busy &&
    hasId &&
    hasChurch &&
    (me.verificationStatus === "None" || me.verificationStatus === "Rejected");

  // Submit to pastor (ONLY when pastorApproval is Required; needs church)
  const canSubmitToPastor =
    requirePastor &&
    !busy &&
    hasId &&
    hasChurch &&
    (me.verificationStatus === "None" || me.verificationStatus === "Rejected");

  const isPending = me.verificationStatus === "Pending";
  const isVerified = me.verificationStatus === "Verified";

  async function onSave() {
    setErr("");
    setOkMsg("");

    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);

    try {
      // ✅ SECURITY: send ONLY editable fields (server controls verification + timestamps)
      const payload: Partial<Profile> = {
        // editable basics
        name: me.name,
        age: me.age,
        gender: me.gender,
        country: me.country || "US",
        city: me.city,
        state: me.state,
        faith: me.faith,
        goal: me.goal,
        job: me.job,
        hasKids: me.hasKids,
        bio: me.bio,
        avatarUrl: me.avatarUrl || "",
        tags,
        pastorApproval: me.pastorApproval,

        // linkage (user can choose churchId; server can derive churchName/pastorId)
        churchId: me.churchId || "",
        owner: role,
      };

      await store.upsertMyProfile(payload);
      await loadMe();

      setOkMsg("✅ Profile saved.");
      setTimeout(() => setOkMsg(""), 2000);
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    }
  }

  async function onRequestVerification() {
    setErr("");
    setOkMsg("");
    try {
      if (!hasId) throw new Error("Save profile first.");
      if (!hasChurch) throw new Error("Choose a Church first.");

      await store.requestVerification(me.id || "", me.churchId || "", noteToPastor || "");
      await loadMe();

      setOkMsg("✅ Verification request sent to pastor queue.");
      setNoteToPastor("");
      setTimeout(() => setOkMsg(""), 2200);
    } catch (e: any) {
      setErr(e?.message || "Request failed");
    }
  }

  async function onSubmitToPastor() {
    setErr("");
    setOkMsg("");
    try {
      if (!requirePastor) throw new Error("Pastor Approval is Optional. Submit is not required.");
      if (!hasId) throw new Error("Save profile first.");
      if (!hasChurch) throw new Error("Choose a Church first.");

      // ✅ uses POST action submit_profile
      await store.submitMyProfileToPastor(noteToPastor || "");
      await loadMe();

      setOkMsg("✅ Submitted to pastor (Pending).");
      setNoteToPastor("");
      setTimeout(() => setOkMsg(""), 2200);
    } catch (e: any) {
      setErr(e?.message || "Submit failed");
    }
  }

  return (
    <div>
      <CourtshipTabs />

      <div style={panel}>
        {/* Header */}
        <div style={topRow}>
          <div>
            <div style={h2}>My Profile</div>
            <div style={sub}>
              Hapa ndiyo user anajaza form yake ili aonekane kwenye <b>Discover</b>. <br />
              <span style={{ opacity: 0.9 }}>
                Policy: ukiweka <b>Pastor Approval = Required</b> lazima u-link Church, kisha pastor a-approve/verify ndipo
                uonekane Discover.
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={vipBadge}>👑 VIP GOLD PURE</div>

            <div style={roleWrap}>
              <div style={roleLabel}>Demo Role</div>
              <div style={roleBtns}>
                <button
                  type="button"
                  style={store.mode === "Sender" ? roleBtnActive : roleBtn}
                  onClick={() => store.setMode("Sender")}
                  disabled={busy || loadingMe}
                >
                  Sender
                </button>
                <button
                  type="button"
                  style={store.mode === "Receiver" ? roleBtnActive : roleBtn}
                  onClick={() => store.setMode("Receiver")}
                  disabled={busy || loadingMe}
                >
                  Receiver
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status row */}
        <div style={statusRow}>
          <div style={statusCard}>
            <div style={statusLabel}>Profile</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={hasProfile ? badgeGreen : badgeGray}>{hasProfile ? "EXISTS" : "NEW"}</div>
              <div style={gate.style}>{gate.label}</div>
              <div style={{ opacity: 0.85, fontWeight: 900 }}>Owner: {role}</div>
              <div style={{ opacity: 0.65, fontWeight: 900 }}>ID: {me.id ? me.id : "— (save to generate)"}</div>
            </div>

            {me.pastorGateNote ? (
              <div style={{ marginTop: 8, opacity: 0.8, lineHeight: 1.6, fontSize: 13 }}>
                <b>Pastor note:</b> {me.pastorGateNote}
              </div>
            ) : null}
          </div>

          <div style={statusCard}>
            <div style={statusLabel}>Verification</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={verification.style}>{verification.label}</div>
              {selectedChurch ? (
                <div style={{ opacity: 0.86 }}>
                  Church: <b>{selectedChurch.name}</b> • Pastor: <b>{selectedChurch.pastorName}</b>
                </div>
              ) : (
                <div style={{ opacity: 0.7 }}>No church linked</div>
              )}
            </div>
          </div>
        </div>

        {(err || okMsg) && (
          <div style={err ? alertErr : alertOk}>
            <b>{err ? "Error:" : "Done:"}</b> {err || okMsg}
          </div>
        )}

        {/* Form */}
        <div style={grid}>
          <Field label="Full Name">
            <input
              style={input}
              value={me.name}
              onChange={(e) => setMe((p) => ({ ...p, name: e.target.value }))}
              placeholder="Example: Prince Fariji"
            />
          </Field>

          <Field label="Age">
            <input
              style={input}
              type="number"
              min={18}
              max={70}
              value={me.age}
              onChange={(e) => setMe((p) => ({ ...p, age: Number(e.target.value || 0) }))}
            />
          </Field>

          <Field label="Gender">
            <select
              style={input}
              value={me.gender}
              onChange={(e) => setMe((p) => ({ ...p, gender: e.target.value as any }))}
            >
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </Field>

          <Field label="Country">
            <input
              style={input}
              value={me.country || "US"}
              onChange={(e) => setMe((p) => ({ ...p, country: e.target.value }))}
              placeholder="US"
            />
          </Field>

          <Field label="City">
            <input
              style={input}
              value={me.city}
              onChange={(e) => setMe((p) => ({ ...p, city: e.target.value }))}
              placeholder="Dallas"
            />
          </Field>

          <Field label="State">
            <input
              style={input}
              value={me.state}
              onChange={(e) => setMe((p) => ({ ...p, state: e.target.value }))}
              placeholder="TX"
            />
          </Field>

          <Field label="Faith">
            <input
              style={input}
              value={me.faith}
              onChange={(e) => setMe((p) => ({ ...p, faith: e.target.value }))}
              placeholder="Christian"
            />
          </Field>

          <Field label="Goal">
            <input
              style={input}
              value={me.goal}
              onChange={(e) => setMe((p) => ({ ...p, goal: e.target.value }))}
              placeholder="Marriage / Serious Dating"
            />
          </Field>

          <Field label="Job">
            <input
              style={input}
              value={me.job}
              onChange={(e) => setMe((p) => ({ ...p, job: e.target.value }))}
              placeholder="Uber driver / Nurse / Teacher..."
            />
          </Field>

          <Field label="Has Kids">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                style={me.hasKids ? toggleOn : toggleOff}
                onClick={() => setMe((p) => ({ ...p, hasKids: true }))}
              >
                Yes
              </button>
              <button
                type="button"
                style={!me.hasKids ? toggleOn : toggleOff}
                onClick={() => setMe((p) => ({ ...p, hasKids: false }))}
              >
                No
              </button>
            </div>
          </Field>

          <Field label="Pastor Approval">
            <select
              style={input}
              value={me.pastorApproval}
              onChange={(e) => setMe((p) => ({ ...p, pastorApproval: e.target.value as PastorApproval }))}
            >
              <option value="Required">Required (must approve for Discover)</option>
              <option value="Optional">Optional (can appear without approval)</option>
            </select>
          </Field>

          <Field label="Avatar URL (optional)">
            <input
              style={input}
              value={me.avatarUrl || ""}
              onChange={(e) => setMe((p) => ({ ...p, avatarUrl: e.target.value }))}
              placeholder="https://..."
            />
          </Field>

          <Field label="Tags / Languages (comma)">
            <input
              style={input}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="English, Swahili, French"
            />
          </Field>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Bio">
              <textarea
                style={textarea}
                value={me.bio}
                onChange={(e) => setMe((p) => ({ ...p, bio: e.target.value }))}
                placeholder="Write a short bio (values, vision, character)..."
              />
            </Field>
          </div>
        </div>

        {/* Church + verification */}
        <div style={box}>
          <div style={secTitle}>Church & Verification</div>

          <div style={twoCol}>
            <div>
              <div style={label}>Choose Church</div>
              <select
                style={input}
                value={me.churchId || ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const ch = churches.find((c) => c.id === id) || null;

                  setMe((p) => ({
                    ...p,
                    churchId: id || "",
                    churchName: ch?.name || "",
                    pastorId: ch?.pastorId || "",
                  }));
                }}
              >
                <option value="">— Select church —</option>
                {churches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.city || "—"})
                  </option>
                ))}
              </select>

              <div style={hint}>
                {requirePastor ? (
                  <>
                    <b>Required:</b> lazima u-link church + pastor a-approve, ndipo uonekane Discover.
                  </>
                ) : (
                  <>
                    <b>Optional:</b> unaweza kuonekana Discover hata bila church/verification (kulingana na backend).
                  </>
                )}
              </div>
            </div>

            <div>
              <div style={label}>Note to Pastor (optional)</div>
              <input
                style={input}
                value={noteToPastor}
                onChange={(e) => setNoteToPastor(e.target.value)}
                placeholder="Example: I'm an active member..."
              />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  type="button"
                  style={!canSubmitToPastor ? btnDisabled : btnGold}
                  disabled={!canSubmitToPastor}
                  onClick={onSubmitToPastor}
                  title="submit_profile (required only)"
                >
                  Submit to Pastor →
                </button>

                <button
                  type="button"
                  style={!canRequestVerification ? btnDisabled : btnGhost}
                  disabled={!canRequestVerification}
                  onClick={onRequestVerification}
                  title="request_verification"
                >
                  Request Verification
                </button>

                {(isPending || isVerified) && (
                  <div style={{ opacity: 0.78, lineHeight: 1.5, fontSize: 13 }}>
                    {isPending ? <>⏳ Waiting pastor decision… (Pending)</> : <>✅ Verified — Discover unlocked (if Required).</>}
                  </div>
                )}
              </div>

              <div style={{ opacity: 0.75, lineHeight: 1.5, fontSize: 13, marginTop: 8 }}>
                Pastor ataona request kwenye <b>Pastor Queue</b> na ata-approve/verify au reject.
              </div>
            </div>
          </div>

          {me.verificationRequestedAt ? (
            <div style={miniInfo}>
              <div>
                <b>Requested:</b> {me.verificationRequestedAt}
              </div>
              {me.verificationDecidedAt ? (
                <div>
                  <b>Decided:</b> {me.verificationDecidedAt}
                </div>
              ) : null}
              {me.verificationNote ? (
                <div>
                  <b>Note:</b> {me.verificationNote}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div style={actions}>
          <button type="button" style={!canSave ? btnDisabled : btnGold} disabled={!canSave} onClick={onSave}>
            💾 Save Profile
          </button>
          <button type="button" style={loadingMe || busy ? btnDisabled : btnGhost} disabled={loadingMe || busy} onClick={loadMe}>
            Refresh
          </button>
        </div>

        <div style={footerTip}>
          ✅ After save: nenda <b>Discover</b> uone kama unaonekana kwa role nyingine. <br />
          Kumbuka: <b>Sender</b> haoni profile yake mwenyewe (demo rule kwenye backend).
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={labelStyle}>{label}</div>
      {children}
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

const topRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const h2: CSSProperties = { fontSize: 26, fontWeight: 950, marginBottom: 6 };
const sub: CSSProperties = { opacity: 0.86, lineHeight: 1.6, maxWidth: 900 };

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

const roleWrap: CSSProperties = {
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  minWidth: 220,
};

const roleLabel: CSSProperties = { fontWeight: 950, opacity: 0.85, fontSize: 12, marginBottom: 8 };

const roleBtns: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };

const roleBtn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const roleBtnActive: CSSProperties = {
  ...roleBtn,
  border: "1px solid rgba(212,175,55,0.36)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
};

const statusRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  marginTop: 12,
};

const statusCard: CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
};

const statusLabel: CSSProperties = { opacity: 0.75, fontWeight: 950, fontSize: 12, marginBottom: 8 };

const alertBase: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  lineHeight: 1.6,
};

const alertErr: CSSProperties = {
  ...alertBase,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
};

const alertOk: CSSProperties = {
  ...alertBase,
  border: "1px solid rgba(120,255,170,0.24)",
  background: "rgba(120,255,170,0.08)",
  color: "rgba(220,255,235,0.95)",
};

const grid: CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
};

const labelStyle: CSSProperties = { fontWeight: 950, opacity: 0.85, fontSize: 12 };

const input: CSSProperties = {
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  color: "inherit",
  outline: "none",
  fontWeight: 850,
};

const textarea: CSSProperties = {
  ...input,
  minHeight: 110,
  resize: "vertical",
  fontWeight: 750,
  lineHeight: 1.6,
};

const toggleBase: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  fontWeight: 950,
  cursor: "pointer",
};

const toggleOn: CSSProperties = {
  ...toggleBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
};

const toggleOff: CSSProperties = {
  ...toggleBase,
  opacity: 0.85,
};

const box: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
};

const secTitle: CSSProperties = { fontWeight: 950, marginBottom: 10, color: "rgba(255,236,190,0.98)" };

const twoCol: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const label: CSSProperties = { fontWeight: 950, opacity: 0.85, fontSize: 12, marginBottom: 8 };

const hint: CSSProperties = { marginTop: 8, opacity: 0.78, lineHeight: 1.6, fontSize: 13 };

const miniInfo: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.92,
  lineHeight: 1.7,
  fontSize: 13,
};

const actions: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" };

const btnBase: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const btnGold: CSSProperties = {
  ...btnBase,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
};

const btnGhost: CSSProperties = {
  ...btnBase,
  opacity: 0.9,
};

const btnDisabled: CSSProperties = {
  ...btnBase,
  opacity: 0.55,
  cursor: "not-allowed",
};

const footerTip: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.92,
  lineHeight: 1.7,
  fontSize: 13,
};

/* Badges */
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
