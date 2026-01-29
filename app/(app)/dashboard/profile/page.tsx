"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Gender = "MALE" | "FEMALE";
type DobVisibility = "Private" | "CorePastor" | "Public";
type MaritalVisibility = "Private" | "CorePastor" | "Public";
type MaritalStatus = "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED";
type ProfileStatus = "Incomplete" | "Active" | "Locked";

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

  // collapsible cards
  const [openDash, setOpenDash] = useState(false);
  const [openInfo, setOpenInfo] = useState(true);
  const [openPrivacy, setOpenPrivacy] = useState(false);
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
          router.replace(`/sign-in?next=${encodeURIComponent("/dashboard/profile")}`);
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
                  {p.profileStatus !== "Active" ? <span style={pillWarn}>INCOMPLETE</span> : <span style={pillOk}>Live</span>}
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
                    <span style={chip}>
                      🔒 DOB: <b>{p.dobVisibility}</b> • Marital: <b>{p.maritalVisibility}</b>
                    </span>
                  </div>

                  <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div className="vip-avatar shrink-0" style={{ width: 72, height: 72 }}>
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="vip-avatar-img" src={avatarUrl} alt="avatar" />
                      ) : (
                        <div className="vip-avatar-ph">{initials(p.fullName)}</div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={miniLine}>
                          <div style={{ fontWeight: 1000 }}>🏠 Household Core</div>
                          <button
                            style={btnGhostSm}
                            type="button"
                            onClick={async () => {
                              const ok = await navigator.clipboard?.writeText(p.coreId);
                              // ignore (best-effort)
                              void ok;
                            }}
                            title="Copy Household Core"
                          >
                            Copy
                          </button>
                        </div>
                        <div style={{ opacity: 0.88, fontWeight: 950, wordBreak: "break-all" }}>{p.coreId}</div>
                        <div style={{ opacity: 0.72, fontSize: 12, lineHeight: 1.5 }}>
                          Familia / ndoa / nyumba — msingi wa kizazi
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={miniLine}>
                          <div style={{ fontWeight: 1000 }}>👶 Birth Core</div>
                          <button
                            style={btnGhostSm}
                            type="button"
                            onClick={async () => {
                              const ok = await navigator.clipboard?.writeText(p.coreIdBirth);
                              void ok;
                            }}
                            title="Copy Birth Core"
                          >
                            Copy
                          </button>
                        </div>
                        <div style={{ opacity: 0.88, fontWeight: 950, wordBreak: "break-all" }}>{p.coreIdBirth}</div>
                        <div style={{ opacity: 0.72, fontSize: 12, lineHeight: 1.5 }}>
                          Watoto / vizazi — link ya damu na historia
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, opacity: 0.70, fontSize: 12, lineHeight: 1.55 }}>
                    Udhibiti wa kinachoonekana kwa Public / CorePastor / Private.
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

{/* TikTok-style profile layout */}
            <div className="mt-6 flex flex-col gap-4 lg:grid lg:grid-cols-12">
              {/* Right: Stats + quick + info/privacy */}
              <div className="lg:col-span-4 grid gap-4">

                <div className={cn("vip-section", openDash && "is-open")}>
                  <button type="button" className="vip-section-head" onClick={() => setOpenDash((x) => !x)}>
                    <div className="min-w-0">
                      <div className="vip-section-title">Dashboard</div>
                      <div className="vip-section-sub">Followers • Following • Saved • Likes</div>
                    </div>
                    <div className="vip-chevron">›</div>
                  </button>

                  {/* Compact summary (always visible) */}
                  <div className="vip-section-body pt-0">
                    <div className="flex flex-wrap gap-2">
                      <span className="vip-pill">Followers <b className="ml-1">0</b></span>
                      <span className="vip-pill">Following <b className="ml-1">0</b></span>
                      <span className="vip-pill">Saved <b className="ml-1">12</b></span>
                      <span className="vip-pill">Likes <b className="ml-1">12</b></span>
                    </div>
                  </div>

                  {/* Expanded grid */}
                  {openDash ? (
                    <div className="vip-section-body grid gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="vip-stat"><div className="vip-stat-n">0</div><div className="vip-stat-l">Followers</div></div>
                        <div className="vip-stat"><div className="vip-stat-n">0</div><div className="vip-stat-l">Following</div></div>
                        <div className="vip-stat"><div className="vip-stat-n">12</div><div className="vip-stat-l">Saved</div></div>
                        <div className="vip-stat"><div className="vip-stat-n">12</div><div className="vip-stat-l">Likes</div></div>
                      </div>
                    </div>
                  ) : null}
                </div>


                <div className="vip-panel">
                  <div className="vip-panel-title">Quick</div>
                  <div className="mt-3 grid gap-2">
                    <div
                      className="vip-rowline vip-rowlink"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.replace("/dashboard/churches")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.replace("/dashboard/churches");
                        }
                      }}
                    >
                      <div>
                        <div className="vip-rowlabel">Church</div>
                        <div className="vip-rowvalue">Active membership + roles</div>
                      </div>
                      <div className="vip-mini" style={{ cursor: "default" }}>›</div>
                    </div>

                    <div
                      className="vip-rowline vip-rowlink"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.replace("/dashboard/settings")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.replace("/dashboard/settings");
                        }
                      }}
                    >
                      <div>
                        <div className="vip-rowlabel">Settings</div>
                        <div className="vip-rowvalue">Privacy + account</div>
                      </div>
                      <div className="vip-mini" style={{ cursor: "default" }}>›</div>
                    </div>

                    <div
                      className="vip-rowline vip-rowlink"
                      role="button"
                      tabIndex={0}
                      onClick={() => alert("MVP: Family coming next")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          alert("MVP: Family coming next");
                        }
                      }}
                    >
                      <div>
                        <div className="vip-rowlabel">Family</div>
                        <div className="vip-rowvalue">Parents + kids (coming)</div>
                      </div>
                      <div className="vip-mini" style={{ cursor: "default" }}>›</div>
                    </div>
                  </div>
                </div>

                <div className={cn("vip-section", openInfo && "is-open")}>
                  <button type="button" className="vip-section-head" onClick={() => setOpenInfo((x) => !x)}>
                    <div className="min-w-0">
                      <div className="vip-section-title">Info</div>
                      <div className="vip-section-sub">Majina, contacts, location</div>
                    </div>
                    <div className="vip-chevron">›</div>
                  </button>
                  {openInfo ? (
                    <div className="vip-section-body grid gap-2">
                      <div className="vip-rowline"><div><div className="vip-rowlabel">Gender</div><div className="vip-rowvalue">{p.gender || "—"}</div></div></div>
                      <div className="vip-rowline"><div><div className="vip-rowlabel">Phone</div><div className="vip-rowvalue">{p.phone || viewer?.phone || "—"}</div></div></div>
                      <div className="vip-rowline"><div><div className="vip-rowlabel">Country</div><div className="vip-rowvalue">{p.country || "—"}</div></div></div>
                      <div className="vip-rowline"><div><div className="vip-rowlabel">City</div><div className="vip-rowvalue">{p.city || "—"}</div></div></div>
                    </div>
                  ) : null}
                </div>

                <div className={cn("vip-section", openPrivacy && "is-open")}>
                  <button type="button" className="vip-section-head" onClick={() => setOpenPrivacy((x) => !x)}>
                    <div className="min-w-0">
                      <div className="vip-section-title">Privacy</div>
                      <div className="vip-section-sub">DOB + marital visibility</div>
                    </div>
                    <div className="vip-chevron">›</div>
                  </button>
                  {openPrivacy ? (
                    <div className="vip-section-body grid gap-2">
                      <div className="vip-rowline">
                        <div><div className="vip-rowlabel">DOB</div><div className="vip-rowvalue">{p.dob || "—"}</div></div>
                        <div className="vip-mini" style={{ cursor: "default" }}>Vis: {p.dobVisibility}</div>
                      </div>
                      <div className="vip-rowline">
                        <div><div className="vip-rowlabel">Marital status</div><div className="vip-rowvalue">{p.maritalStatus}</div></div>
                        <div className="vip-mini" style={{ cursor: "default" }}>Vis: {p.maritalVisibility}</div>
                      </div>
                      <div className="vip-rowline"><div><div className="vip-rowlabel">Profile status</div><div className="vip-rowvalue">{p.profileStatus}</div></div></div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

{/* Left: Tabs + posts grid */}
              <div className="lg:col-span-8">
                <div className="vip-panel">
                  <div className="vip-tabs" role="tablist" aria-label="Profile tabs">
                    <button
                      type="button"
                      className={cn("vip-tab", tab === "posts" && "is-active")}
                      onClick={() => setTab("posts")}
                    >
                      Posts
                    </button>
                    <button
                      type="button"
                      className={cn("vip-tab", tab === "saved" && "is-active")}
                      onClick={() => setTab("saved")}
                    >
                      Saved
                    </button>
                    <button
                      type="button"
                      className={cn("vip-tab", tab === "likes" && "is-active")}
                      onClick={() => setTab("likes")}
                    >
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
            {p.profileStatus !== "Active" ? (
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

