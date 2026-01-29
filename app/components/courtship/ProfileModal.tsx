"use client";

import React from "react";

type Profile = {
  id: string;
  name: string;
  age: number;
  gender: "Male" | "Female";
  location: string;
  faith: string; // imani
  goalTag: string; // mfano: "Ndoa"
  bio: string;
  job: string;
  hasKids: boolean;
  kidsCount?: number;
  pastorApproval: "Required" | "Optional";
};

export default function ProfileModal({
  open,
  profile,
  onClose,
  onSendInterest,
}: {
  open: boolean;
  profile: Profile | null;
  onClose: () => void;
  onSendInterest: (id: string) => void;
}) {
  if (!open || !profile) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={topRow}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar name={profile.name} size={54} />
            <div>
              <div style={title}>{profile.name}, {profile.age}</div>
              <div style={sub}>
                {profile.gender} • {profile.location}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Chip text={profile.faith} />
                <Chip text={profile.goalTag} />
              </div>
            </div>
          </div>

          <button onClick={onClose} style={closeBtn} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={section}>
          <div style={sectionTitle}>Biography</div>
          <div style={box}>{profile.bio}</div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>Details</div>
          <div style={box}>
            <div><b>Kazi:</b> {profile.job}</div>
            <div style={{ marginTop: 6 }}>
              <b>Ana mtoto?</b>{" "}
              {profile.hasKids ? `Ndiyo (${profile.kidsCount ?? 1})` : "Hapana"}
            </div>
            <div style={{ marginTop: 6 }}>
              <b>Pastor approval:</b> {profile.pastorApproval}
            </div>
          </div>
        </div>

        <div style={bottomRow}>
          <button style={btnGhost} onClick={onClose}>
            Back
          </button>
          <button
            style={btnGold}
            onClick={() => onSendInterest(profile.id)}
          >
            Send Interest
          </button>
        </div>

        <div style={ruleBar}>
          ✅ <b>Golden Pure Rule:</b> Si lazima wawe kanisa moja — pastor mmoja tu akubali kutoka upande wowote.
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: "1px solid rgba(212,175,55,0.35)",
        background:
          "radial-gradient(circle at 30% 30%, rgba(212,175,55,0.35), rgba(255,255,255,0.06))",
        display: "grid",
        placeItems: "center",
        color: "rgba(255,255,255,0.92)",
        fontWeight: 900,
        fontSize: size >= 54 ? 20 : 16,
        boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
        userSelect: "none",
      }}
      title={name}
    >
      {initial}
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <span
      style={{
        borderRadius: 999,
        padding: "6px 10px",
        border: "1px solid rgba(212,175,55,0.25)",
        background:
          "linear-gradient(180deg, rgba(212,175,55,0.14), rgba(255,255,255,0.03))",
        fontSize: 12,
        fontWeight: 800,
        color: "rgba(255,255,255,0.92)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "grid",
  placeItems: "center",
  padding: 18,
  zIndex: 50,
};

const modal: React.CSSProperties = {
  width: "min(760px, 96vw)",
  borderRadius: 18,
  border: "1px solid rgba(212,175,55,0.25)",
  background:
    "linear-gradient(180deg, rgba(20,20,24,0.98), rgba(16,16,20,0.94))",
  boxShadow: "0 26px 60px rgba(0,0,0,0.65)",
  padding: 16,
};

const topRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const closeBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.9)",
  fontWeight: 900,
  cursor: "pointer",
};

const title: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
};

const sub: React.CSSProperties = {
  opacity: 0.85,
  marginTop: 2,
};

const section: React.CSSProperties = { marginTop: 14 };

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  marginBottom: 8,
  opacity: 0.95,
};

const box: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 12,
  lineHeight: 1.6,
};

const bottomRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  marginTop: 14,
};

const btnGold: React.CSSProperties = {
  borderRadius: 12,
  padding: "10px 14px",
  border: "1px solid rgba(212,175,55,0.35)",
  background:
    "linear-gradient(180deg, rgba(212,175,55,1), rgba(212,175,55,0.65))",
  color: "#1a1200",
  fontWeight: 900,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  borderRadius: 12,
  padding: "10px 14px",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.92)",
  fontWeight: 900,
  cursor: "pointer",
};

const ruleBar: React.CSSProperties = {
  marginTop: 12,
  borderRadius: 12,
  padding: 10,
  border: "1px solid rgba(212,175,55,0.22)",
  background:
    "linear-gradient(180deg, rgba(212,175,55,0.10), rgba(255,255,255,0.03))",
  opacity: 0.95,
};
