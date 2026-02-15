"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Gender = "MALE" | "FEMALE";
type DobVisibility = "Private" | "CorePastor" | "Public";
type MaritalVisibility = "Private" | "CorePastor" | "Public";
type MaritalStatus = "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";
type ProfileStatus = "Incomplete" | "Complete" | "Locked";

type UserProfile = {
  userId: string;
  coreId: string;
  coreIdBirth: string;

  fullName: string;
  gender?: Gender;
  dob?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  avatarUrl?: string;

  dobVisibility: DobVisibility;
  maritalStatus: MaritalStatus;
  maritalVisibility: MaritalVisibility;

  profileStatus: ProfileStatus;

  createdAt: number;
  updatedAt: number;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function initials(name: string) {
  const s = String(name || "").trim();
  if (!s) return "K";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] || "").toUpperCase();
  const b = (parts[1]?.[0] || "").toUpperCase();
  return (a + b).slice(0, 2) || a || "K";
}

type HubCardProps = {
  icon: string;
  title: string;
  subtitle?: string;
  meta?: string;
  onClick?: () => void;
  right?: React.ReactNode;
};
function HubCard({ icon, title, subtitle, meta, onClick, right }: HubCardProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ ...kpiCard, textAlign: "left", cursor: onClick ? "pointer" : "default" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 18, lineHeight: 1 }}>{icon}</div>
            <div style={{ fontWeight: 1000, color: "rgba(255,236,190,0.98)" }}>{title}</div>
          </div>
          {subtitle ? <div style={{ marginTop: 6, opacity: 0.78, fontSize: 12, lineHeight: 1.5 }}>{subtitle}</div> : null}
          {meta ? <div style={{ marginTop: 10, opacity: 0.92, fontWeight: 950, wordBreak: "break-all" }}>{meta}</div> : null}
        </div>
        {right ? <div style={{ flexShrink: 0, opacity: 0.8 }}>{right}</div> : <div style={{ opacity: 0.55 }}>›</div>}
      </div>
    </div>
  );
}


export default function DashboardProfilePage() {
  
  type ProfileTab = "posts" | "saved" | "likes";
  const [tab, setTab] = useState<ProfileTab>("posts");
const router = useRouter();
  const sp = useSearchParams();
  const next = useMemo(() => sp.get("next") || "/dashboard", [sp]);

  const fileRef = useRef<HTMLInputElement | null>(null);

  

  const avatarObjectUrlRef = useRef<string | null>(null);


  async function onPickAvatar(file: File | null) {
    try {
      if (!file) return;

      const prev = avatarObjectUrlRef.current;
      if (prev && prev.startsWith("blob:")) {
        try { URL.revokeObjectURL(prev); } catch {}
      }

      const url = URL.createObjectURL(file);
      avatarObjectUrlRef.current = url;
      setAvatarUrl(url);

      // allow picking the same file again
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setErr(e?.message || "Avatar failed.");
    }
  }

  // cleanup blob URLs (avoid memory leak)
  useEffect(() => {
    return () => {
      const prev = avatarObjectUrlRef.current;
      if (prev && prev.startsWith("blob:")) {
        try { URL.revokeObjectURL(prev); } catch {}
      }
      avatarObjectUrlRef.current = null;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [viewer, setViewer] = useState<{ userId: string; email: string; phone: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // edit form
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<Gender>("MALE");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [dobVisibility, setDobVisibility] = useState<DobVisibility>("Private");
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus>("SINGLE");
  const [maritalVisibility, setMaritalVisibility] = useState<MaritalVisibility>("CorePastor");
  // cards hub (no collapsibles)
  const [avatarUrl, setAvatarUrl] = useState<string>("");

  function applyToForm(p: UserProfile) {
    setFullName(String(p.fullName || ""));
    setGender(p.gender === "FEMALE" ? "FEMALE" : "MALE");
    setDob(String(p.dob || ""));
    setPhone(String(p.phone || ""));
    setCountry(String(p.country || ""));
    setCity(String(p.city || ""));
    setDobVisibility((p.dobVisibility as DobVisibility) || "Private");
    setMaritalStatus((p.maritalStatus as MaritalStatus) || "SINGLE");
    setMaritalVisibility((p.maritalVisibility as MaritalVisibility) || "CorePastor");
    setAvatarUrl(String(p.avatarUrl || ""));


  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      setErr("");
      setSaving(true);

      // MVP: no server PATCH yet; just update local UI so page feels alive
      const nextProfile: UserProfile = {
        ...(profile as any),
        fullName,
        gender,
        dob,
        phone,
        country,
        city,
        dobVisibility,
        maritalStatus,
        maritalVisibility,
        avatarUrl,
      };

      setProfile(nextProfile);
      setEditing(false);
    } catch (e: any) {
      setErr(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let on = true;

    (async () => {
      try {
        setErr("");
        setLoading(true);

        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const me = await meRes.json().catch(() => ({}));

        if (!meRes.ok || !me?.ok) {
          router.replace(`/login?next=${encodeURIComponent("/dashboard/profile")}`);
          return;
        }

        const prof = (me?.profile as UserProfile | null) || null;
        if (!prof) {
          router.replace("/onboarding");
          return;
        }

        if (!on) return;
        setProfile(prof);
        applyToForm(prof);
        setEditing(false);
      } catch (e: any) {
        if (on) setErr(e?.message || "Failed.");
      } finally {
        if (on) setLoading(false);
      }
    })();

    return () => {
      on = false;

      // cleanup avatar preview blob url too
      const prev = avatarObjectUrlRef.current;
      if (prev && prev.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          // ignore
        }
        avatarObjectUrlRef.current = null;
      }
    };
  }, [router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-white/80">Loading...</div>;
  }

  const p = profile;
  if (!p) {
    return <div className="min-h-screen flex items-center justify-center text-white/80">No profile...</div>;
  }



return (
    <div className="vip-root vip-profile min-h-screen px-4 py-10">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <div className="mx-auto w-full max-w-5xl relative">
        <div className="vip-card">
          <div className="vip-card-inner">

            {/* HERO (Roles-like) */}
            <div style={profileHero}>
              <div style={{ minWidth: 260 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h1 style={profileTitle}>{p.fullName || "Profile"}</h1>
                  <span style={pillOk}>VIP GOLD</span>
                  {p.profileStatus !== "Complete" ? <span style={pillWarn}>INCOMPLETE</span> : <span style={pillOk}>Live</span>}
                </div>

                <div style={profileSubtitle}>
                  <div style={{ opacity: 0.92 }}>
                    Core ID is nguzo ya vizazi. <span style={{ opacity: 0.78 }}>(Profile & privacy)</span>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {viewer?.email ? (
                      <span style={chip}>
                        ✉️ <b>{viewer.email}</b>
                      </span>
                    ) : null}
                    {viewer?.phone ? (
                      <span style={chip}>
                        📞 <b>{viewer.phone}</b>
                      </span>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <div className="vip-avatar shrink-0" style={{ width: 72, height: 72 }}>
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="vip-avatar-img" src={avatarUrl} alt="avatar" />
                      ) : (
                        <div className="vip-avatar-ph">{initials(p.fullName)}</div>
                      )}
                    </div>

                    <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
                      <div style={{ fontWeight: 950, opacity: 0.9 }}>
                        {p.gender ? `Gender: ${p.gender}` : ""}
                        {p.country || p.city ? ` • ${[p.city, p.country].filter(Boolean).join(", ")}` : ""}
                      </div>
                      <div style={{ opacity: 0.75, fontSize: 12, lineHeight: 1.5 }}>
                        Core IDs zipo chini kwenye cards. Fungua Privacy & Settings kubadilisha visibility.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions (Roles-like) */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "flex-end" }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPickAvatar(e.currentTarget.files?.[0] || null)}
                />

                <button
                  type="button"
                  style={saving ? btnDisabled : btnGold}
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Upload Avatar"}
                </button>

                <button
                  type="button"
                  style={saving ? btnDisabled : btnGhost}
                  onClick={() => setEditing((x) => !x)}
                  disabled={saving}
                >
                  {editing ? "Close Edit" : "Edit Profile"}
                </button>

                <button type="button" style={btnGhost} onClick={() => router.replace(next)}>
                  ← Back
                </button>
              </div>
            </div>
            {err ? (
              <div className="vip-alert mt-6">
                <div className="vip-alert-title">Kuna tatizo</div>
                <div className="vip-alert-body">{err}</div>
              </div>
            ) : null}

            {/* Profile HUB (VIP cards grid) */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <HubCard
                icon="🏠"
                title="Core ID"
                subtitle="Household / ndoa / familia"
                meta={p.coreId}
                right={
                  <button
                    type="button"
                    style={btnGhostSm}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try { await navigator.clipboard?.writeText(p.coreId); } catch {}
                    }}
                  >
                    Copy
                  </button>
                }
              />

              <HubCard
                icon="👶"
                title="Birth Core"
                subtitle="Watoto / vizazi"
                meta={p.coreIdBirth}
                right={
                  <button
                    type="button"
                    style={btnGhostSm}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try { await navigator.clipboard?.writeText(p.coreIdBirth); } catch {}
                    }}
                  >
                    Copy
                  </button>
                }
              />

              <HubCard
                icon="⛪"
                title="Church"
                subtitle="Active membership + roles"
                onClick={() => router.replace("/dashboard/churches")}
              />

              <HubCard
                icon="🧭"
                title="Ministries"
                subtitle="Your ministries inside church"
                onClick={() => router.replace("/dashboard/church/ministries")}
              />

              <HubCard
                icon="🔒"
                title="Privacy & Settings"
                subtitle={`DOB: ${p.dobVisibility} • Marital: ${p.maritalVisibility}`}
                onClick={() => router.replace("/dashboard/settings")}
              />

              <HubCard
                icon="👨‍👩‍👧"
                title="Family"
                subtitle="Parents + kids (coming)"
                onClick={() => alert("MVP: Family coming next")}
              />

              <HubCard
                icon="💾"
                title="Saved"
                subtitle="Videos you saved"
                onClick={() => setTab("saved")}
              />

              <HubCard
                icon="❤️"
                title="Likes"
                subtitle="Videos you liked"
                onClick={() => setTab("likes")}
              />

              <HubCard
                icon="🎥"
                title="Posts"
                subtitle="Your public posts"
                onClick={() => setTab("posts")}
              />
            </div>

            {/* Content zone (posts/saved/likes) */}
            <div className="mt-4">
              <div className="vip-panel">
                <div className="vip-tabs" role="tablist" aria-label="Profile tabs">
                  <button type="button" className={cn("vip-tab", tab === "posts" && "is-active")} onClick={() => setTab("posts")}>
                    Posts
                  </button>
                  <button type="button" className={cn("vip-tab", tab === "saved" && "is-active")} onClick={() => setTab("saved")}>
                    Saved
                  </button>
                  <button type="button" className={cn("vip-tab", tab === "likes" && "is-active")} onClick={() => setTab("likes")}>
                    Likes
                  </button>
                </div>

                {tab === "saved" ? (
                  <div>
                    <div className="vip-postgrid" aria-label="Saved grid">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          className="vip-postthumb"
                          onClick={() => router.replace("/dashboard/posts")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.replace("/dashboard/posts");
                            }
                          }}
                          title="Open saved"
                        >
                          <div className="vip-postthumb-inner" />
                          <div className="vip-postthumb-overlay" aria-hidden="true">
                            <div className="vip-postthumb-top">
                              <span className="vip-postpill">SAVED</span>
                              <span className="vip-postplay">▶</span>
                            </div>
                            <div className="vip-postthumb-bottom">
                              <div className="vip-postthumb-caption">Saved clip #{i + 1}</div>
                              <div className="vip-postthumb-metrics">
                                <span className="vip-postmetric">♥ 0</span>
                                <span className="vip-postmetric">💬 0</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {tab === "likes" ? (
                  <div>
                    <div className="vip-postgrid" aria-label="Likes grid">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div
                          key={i}
                          role="button"
                          tabIndex={0}
                          className="vip-postthumb"
                          onClick={() => router.replace("/dashboard/posts")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.replace("/dashboard/posts");
                            }
                          }}
                          title="Open liked"
                        >
                          <div className="vip-postthumb-inner" />
                          <div className="vip-postthumb-overlay" aria-hidden="true">
                            <div className="vip-postthumb-top">
                              <span className="vip-postpill">LIKED</span>
                              <span className="vip-postplay">▶</span>
                            </div>
                            <div className="vip-postthumb-bottom">
                              <div className="vip-postthumb-caption">Liked clip #{i + 1}</div>
                              <div className="vip-postthumb-metrics">
                                <span className="vip-postmetric">♥ 0</span>
                                <span className="vip-postmetric">💬 0</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {tab === "posts" ? (
                  <div className="vip-postgrid" aria-label="Posts grid">
                    {Array.from({ length: 18 }).map((_, i) => (
                      <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        className="vip-postthumb"
                        onClick={() => router.replace("/dashboard/posts")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.replace("/dashboard/posts");
                          }
                        }}
                        title="Open posts"
                      >
                        <div className="vip-postthumb-inner" />
                        <div className="vip-postthumb-overlay" aria-hidden="true">
                          <div className="vip-postthumb-top">
                            <span className="vip-postpill">PUBLIC</span>
                            <span className="vip-postplay">▶</span>
                          </div>
                          <div className="vip-postthumb-bottom">
                            <div className="vip-postthumb-caption">Sermon clip #{i + 1}</div>
                            <div className="vip-postthumb-metrics">
                              <span className="vip-postmetric">♥ 0</span>
                              <span className="vip-postmetric">💬 0</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Edit form */}
            {editing ? (
              <form onSubmit={onSubmit} className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 vip-divider" />

                <div className="sm:col-span-2">
                  <label className="vip-label">Full name</label>
                  <input className="vip-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>

                <div>
                  <label className="vip-label">Gender</label>
                  <select className="vip-input" value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                    <option value="MALE">MALE</option>
                    <option value="FEMALE">FEMALE</option>
                  </select>
                </div>

                <div>
                  <label className="vip-label">DOB</label>
                  <input className="vip-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                  <div className="vip-dim mt-1">DOB default ni Private; Pastor + Core wanaweza kuona (MVP).</div>
                </div>

                <div>
                  <label className="vip-label">Phone</label>
                  <input className="vip-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>

                <div>
                  <label className="vip-label">Country</label>
                  <input className="vip-input" value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>

                <div>
                  <label className="vip-label">City</label>
                  <input className="vip-input" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>

                <div>
                  <label className="vip-label">DOB visibility</label>
                  <select className="vip-input" value={dobVisibility} onChange={(e) => setDobVisibility(e.target.value as DobVisibility)}>
                    <option value="Private">Private</option>
                    <option value="CorePastor">CorePastor</option>
                    <option value="Public">Public</option>
                  </select>
                </div>

                <div>
                  <label className="vip-label">Marital status</label>
                  <select className="vip-input" value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value as MaritalStatus)}>
                    <option value="SINGLE">SINGLE</option>
                    <option value="MARRIED">MARRIED</option>
                    <option value="DIVORCED">DIVORCED</option>
                    <option value="WIDOWED">WIDOWED</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="vip-label">Marital visibility</label>
                  <select
                    className="vip-input"
                    value={maritalVisibility}
                    onChange={(e) => setMaritalVisibility(e.target.value as MaritalVisibility)}
                  >
                    <option value="Private">Private</option>
                    <option value="CorePastor">CorePastor</option>
                    <option value="Public">Public</option>
                  </select>
                </div>

                <div className="sm:col-span-2 flex gap-3 flex-wrap">
                  <button type="submit" className={cn("vip-btn", saving && "is-loading")} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" className="vip-btn ghost" onClick={() => setEditing(false)} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {/* Guidance */}
            {p.profileStatus !== "Complete" ? (
              <div className="mt-6 vip-dim">
                Ujumbe: profile yako bado <b>Incomplete</b>. Jaza fullName, phone, DOB, country, city ili iwe <b>Active</b>.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   PROFILE (Roles-like inline styles)
   ========================= */

const profileHero = {
  marginTop: 6,
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(120% 160% at 20% 0%, rgba(255,215,130,0.08), rgba(0,0,0,0)) , linear-gradient(180deg, rgba(16,16,16,0.72), rgba(8,8,8,0.36))",
  boxShadow: "0 22px 70px rgba(0,0,0,0.45)",
  padding: 16,
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
} as const;

const profileTitle = { fontSize: 26, fontWeight: 1000, margin: 0, color: "rgba(255,236,190,0.98)" } as const;
const profileSubtitle = { opacity: 0.86, marginTop: 8, lineHeight: 1.6, maxWidth: 980 } as const;

const pillBase = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.25)",
  fontWeight: 950,
  fontSize: 12,
} as const;

const pillOk = { ...pillBase, border: "1px solid rgba(34,197,94,0.26)", color: "rgba(220,255,235,0.95)" } as const;
const pillWarn = { ...pillBase, border: "1px solid rgba(245,158,11,0.28)", color: "rgba(255,236,190,0.95)" } as const;

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  fontWeight: 900,
  fontSize: 12,
  opacity: 0.95,
} as const;

const btnBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  color: "rgba(255,255,255,0.92)",
  fontWeight: 950,
  cursor: "pointer",
  textDecoration: "none",
} as const;

const btnGold = {
  ...btnBase,
  border: "1px solid rgba(212,175,55,0.30)",
  background: "linear-gradient(180deg, rgba(255,215,130,0.18), rgba(0,0,0,0.20))",
  color: "rgba(255,236,190,0.98)",
} as const;

const btnGhost = { ...btnBase, opacity: 0.92 } as const;
const btnDisabled = { ...btnBase, opacity: 0.55, cursor: "not-allowed" } as const;

const btnGoldSm = { ...btnGold, padding: "8px 10px", borderRadius: 12, fontSize: 13 } as const;
const btnGhostSm = { ...btnGhost, padding: "8px 10px", borderRadius: 12, fontSize: 13 } as const;

const kpiStrip = { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 } as const;

const kpiCard = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.18)",
  padding: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
} as const;

const kpiLabel = { opacity: 0.8, fontWeight: 950, fontSize: 12 } as const;
const kpiValue = { fontSize: 28, fontWeight: 1000, marginTop: 8, color: "rgba(255,236,190,0.98)" } as const;
const kpiMeta = { opacity: 0.75, marginTop: 6, fontSize: 12 } as const;

const miniLine = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
} as const;

