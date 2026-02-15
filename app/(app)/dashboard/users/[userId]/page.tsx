"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";

type ProfileVisibility = "Private" | "CorePastor" | "Public";

type PublicProfile = {
  userId: string;
  fullName: string;
  gender: string;
  country: string;
  city: string;
  avatarUrl: string;

  dob: string;
  dobVisibility: ProfileVisibility;

  maritalStatus: string;
  maritalVisibility: ProfileVisibility;

  profileStatus: string;
};

type PublicPost = {
  id: string;
  userId: string;
  type: "video" | "image";
  caption: string;
  videoUrl?: string;
  imageUrl?: string;
  createdAt: number;

  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  repostsCount?: number;

  // optional (future)
  viewsCount?: number;
  soundId?: string;
  soundTitle?: string;
  soundAuthor?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

function initials(s: string) {
  const v = String(s || "").trim();
  if (!v) return "?";
  const parts = v.split(/\s+/).filter(Boolean);
  const a = (parts[0] || "").slice(0, 1);
  const b =
    parts.length > 1
      ? (parts[parts.length - 1] || "").slice(0, 1)
      : v.replace(/[^A-Za-z0-9]/g, "").slice(1, 2) || "";
  return (a + b).toUpperCase();
}

function fmtCompact(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  if (x < 1000) return String(x);
  if (x < 1_000_000) return `${Math.round((x / 1000) * 10) / 10}k`;
  if (x < 1_000_000_000) return `${Math.round((x / 1_000_000) * 10) / 10}M`;
  return `${Math.round((x / 1_000_000_000) * 10) / 10}B`;
}

function safeUrl(u?: string) {
  const v = String(u || "").trim();
  return v || "";
}

function deduceSound(p: PublicPost) {
  const base = (p.soundId || "").trim();
  if (base) {
    return {
      soundId: base,
      soundTitle: p.soundTitle || "Original Sound",
      soundAuthor: p.soundAuthor || "Kristo",
    };
  }
  const sid = `sound_${String(p.userId || "u")}_${String(p.id || "p")}`.slice(0, 48);
  return { soundId: sid, soundTitle: "Original Sound", soundAuthor: "Kristo" };
}

function readSaved(): Record<string, true> {
  try {
    const raw = localStorage.getItem("kristo_saved_posts_v1");
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object") return v as Record<string, true>;
    return {};
  } catch {
    return {};
  }
}
function writeSaved(map: Record<string, true>) {
  try {
    localStorage.setItem("kristo_saved_posts_v1", JSON.stringify(map));
  } catch {
    // ignore
  }
}

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams();
  const userId = String((params as any)?.userId || "").trim();

  const [data, setData] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsErr, setPostsErr] = useState("");

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [followed, setFollowed] = useState(false);

  const [shareOpen, setShareOpen] = useState(false);
  const [sharePost, setSharePost] = useState<PublicPost | null>(null);

  const [soundOpen, setSoundOpen] = useState(false);
  const [soundPost, setSoundPost] = useState<PublicPost | null>(null);

  const [savedMap, setSavedMap] = useState<Record<string, true>>({});

  const alive = useRef(true);

  const title = useMemo(() => {
    const name = data?.fullName?.trim();
    return name ? name : userId ? `User • ${userId}` : "User";
  }, [data?.fullName, userId]);

  useEffect(() => {
    try {
      setSavedMap(readSaved());
    } catch {}
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setErr("");

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}/public`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiRes<PublicProfile> | null;
      if (!alive.current) return;

      if (!res.ok || !json || (json as any).ok !== true) {
        setData(null);
        setErr((json as any)?.error || "Failed to load profile.");
        setLoading(false);
        return;
      }

      setData((json as any).data as PublicProfile);
      setLoading(false);
    } catch {
      if (!alive.current) return;
      setData(null);
      setErr("Network error.");
      setLoading(false);
    }
  }

  async function loadPosts() {
    if (!userId) return;
    setPostsLoading(true);
    setPostsErr("");

    const url = `/api/users/${encodeURIComponent(userId)}/posts?public=1&limit=30`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!alive.current) return;

      if (!res.ok || !json || json.ok !== true) {
        setPosts([]);
        setPostsErr("");
        setPostsLoading(false);
        return;
      }

      const items = json?.data?.items;
      const list: PublicPost[] = Array.isArray(items) ? (items as PublicPost[]) : [];

      const normalized = list.map((p) => {
        const v = Number.isFinite(p.viewsCount as any)
          ? Number(p.viewsCount)
          : Number.isFinite(p.sharesCount as any) || Number.isFinite(p.likesCount as any)
            ? Math.max(0, (Number(p.likesCount || 0) * 25) + (Number(p.commentsCount || 0) * 40) + (Number(p.sharesCount || 0) * 60))
            : 0;
        const s = deduceSound(p);
        return {
          ...p,
          viewsCount: v,
          soundId: s.soundId,
          soundTitle: s.soundTitle,
          soundAuthor: s.soundAuthor,
          likesCount: Number(p.likesCount || 0),
          commentsCount: Number(p.commentsCount || 0),
          sharesCount: Number(p.sharesCount || 0),
          repostsCount: Number(p.repostsCount || 0),
        };
      });

      setPosts(normalized);
      setPostsLoading(false);
    } catch {
      if (!alive.current) return;
      setPosts([]);
      setPostsErr("");
      setPostsLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    load();
    loadPosts();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const currentPost = viewerOpen ? posts[viewerIndex] : null;

  function openViewer(i: number) {
    setViewerIndex(Math.max(0, Math.min(i, Math.max(0, posts.length - 1))));
    setViewerOpen(true);
    setShareOpen(false);
    setSharePost(null);
    setSoundOpen(false);
    setSoundPost(null);
  }

  function closeViewer() {
    setViewerOpen(false);
    setShareOpen(false);
    setSharePost(null);
    setSoundOpen(false);
    setSoundPost(null);
  }

  function nextPost() {
    setViewerIndex((i) => Math.min(posts.length - 1, i + 1));
  }
  function prevPost() {
    setViewerIndex((i) => Math.max(0, i - 1));
  }

  useEffect(() => {
    if (!viewerOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowDown" || e.key === "ArrowRight") nextPost();
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") prevPost();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, posts.length]);

  function doFollow() {
    setFollowed(true);
    setPostsErr("Followed ✅");
    setTimeout(() => setPostsErr(""), 1200);
  }

  function toggleSave(p: PublicPost) {
    const id = String(p?.id || "");
    if (!id) return;
    const next = { ...savedMap };
    if (next[id]) {
      delete next[id];
      setSavedMap(next);
      writeSaved(next);
      setPostsErr("Removed from saved");
      setTimeout(() => setPostsErr(""), 900);
      return;
    }
    next[id] = true;
    setSavedMap(next);
    writeSaved(next);
    setPostsErr("Saved ✅");
    setTimeout(() => setPostsErr(""), 900);
  }

  async function copyLink(p: PublicPost) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const link = `${origin}${path}?userId=${encodeURIComponent(userId)}&post=${encodeURIComponent(p.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      setPostsErr("Copied link ✅");
      setTimeout(() => setPostsErr(""), 1200);
    } catch {
      setPostsErr("Copy failed.");
      setTimeout(() => setPostsErr(""), 1200);
    }
  }

  function openShare(p: PublicPost) {
    setSharePost(p);
    setShareOpen(true);
  }

  function openSound(p: PublicPost) {
    setSoundPost(p);
    setSoundOpen(true);
  }

  const soundFeed = useMemo(() => {
    if (!soundPost) return [];
    const sid = (soundPost.soundId || "").trim();
    if (!sid) return [];
    return posts.filter((p) => (p.soundId || "").trim() === sid);
  }, [posts, soundPost]);

  const profileName = data?.fullName?.trim() || title;

  return (
    <div style={wrap}>
      {/* HERO */}
      <div style={hero}>
        <div style={heroRow}>
          <div style={heroLeft}>
            <div style={avatarOuter} aria-hidden="true">
              {data?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.avatarUrl} alt="" style={avatarImg} />
              ) : (
                <div style={avatarFallback}>{initials(data?.fullName || userId)}</div>
              )}
            </div>

            <div>
              <div style={h1}>
                <span style={goldName}>{profileName}</span>
                {data?.fullName && <span style={verifiedBadge}>✓</span>}
              </div>
              <div style={sub}>
                {data ? (
                  <>
                    <span style={pillBase}>Status • {data.profileStatus || "—"}</span>
                    <span style={dot}>•</span>
                    <span style={{ opacity: 0.9 }}>
                      {data.city ? data.city : "—"}
                      {data.country ? `, ${data.country}` : ""}
                    </span>
                    {data.gender ? (
                      <>
                        <span style={dot}>•</span>
                        <span style={{ opacity: 0.9 }}>Gender • {data.gender}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span style={{ opacity: 0.85 }}>{userId ? `UserId: ${userId}` : "—"}</span>
                )}
              </div>
            </div>
          </div>

          <div style={heroRight}>
            <button type="button" onClick={() => router.back()} style={ghostBtn}>
              ← Back
            </button>
            <button type="button" onClick={() => { load(); loadPosts(); }} style={btn} disabled={loading || !userId}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {err ? (
        <div style={alert}>
          <div style={{ fontWeight: 950 }}>Kuna tatizo</div>
          <div style={{ opacity: 0.9, marginTop: 6 }}>{err}</div>
        </div>
      ) : null}

      {/* POSTS GRID */}
      <div style={panel}>
        <div style={postsTop}>
          <div>
            <div style={postsTitle}>
              Posts <span style={postsTitleGold}>VIP GOLD</span>
            </div>
            <div style={postsHint}>Click post to open premium viewer with full controls</div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={loadPosts} style={ghostBtn} disabled={postsLoading || !userId}>
              Reload posts
            </button>
          </div>
        </div>

        {postsErr ? <div style={{ marginTop: 10, opacity: 0.9 }}>{postsErr}</div> : null}

        {postsLoading ? (
          <div style={{ opacity: 0.85, marginTop: 12 }}>Loading posts…</div>
        ) : posts.length === 0 ? (
          <div style={{ opacity: 0.85, marginTop: 12 }}>
            Hakuna posts kwa sasa (au endpoint haijarudisha items). Endpoint yako inapaswa kuwa:
            <div style={{ opacity: 0.85, marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              /api/users/&lt;id&gt;/posts?public=1&amp;limit=30
            </div>
          </div>
        ) : (
          <div style={grid}>
            {posts.map((p, i) => {
              const isVideo = p.type === "video";
              const thumb = isVideo ? "" : safeUrl(p.imageUrl);
              const views = fmtCompact(Number(p.viewsCount || 0));
              return (
                <button key={p.id} type="button" onClick={() => openViewer(i)} style={postCard} aria-label={`Open post ${p.id}`}>
                  <div style={postFrame}>
                    <div style={postFrameInner}>
                      {isVideo ? (
                        <div style={thumbVideo}>
                          <div style={playBadge}>▶</div>
                          <div style={thumbDim} />
                        </div>
                      ) : thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" style={thumbImg} />
                      ) : (
                        <div style={thumbEmpty}>POST</div>
                      )}

                      <div style={postMeta}>
                        <div style={postCaption} title={p.caption || ""}>
                          {p.caption || "—"}
                        </div>
                        <div style={postStats}>
                          <span style={viewsPill}>{views} views</span>
                          <span style={vipChip}>VIP GOLD</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* VIEWER OVERLAY - PREMIUM DESIGN */}
      {viewerOpen && currentPost ? (
        <div style={overlay} role="dialog" aria-modal="true">
          <div style={overlayTop}>
            <button type="button" onClick={closeViewer} style={overlayClose}>
              ✕ Close
            </button>

            <div style={overlayTopRight}>
              <button type="button" onClick={prevPost} style={overlayNavBtn} disabled={viewerIndex <= 0}>
                ↑ Prev
              </button>
              <button type="button" onClick={nextPost} style={overlayNavBtn} disabled={viewerIndex >= posts.length - 1}>
                ↓ Next
              </button>
            </div>
          </div>

          <div style={viewerWrap}>
            <div style={premiumFrameOuter}>
              <div style={premiumFrameMid}>
                <div style={premiumFrameInner}>
                  {currentPost.type === "video" ? (
                    <video
                      key={currentPost.id}
                      src={safeUrl(currentPost.videoUrl)}
                      style={videoEl}
                      controls={false}
                      autoPlay
                      muted={false}
                      loop
                      playsInline
                      onClick={(e) => {
                        const v = e.currentTarget;
                        if (v.paused) v.play().catch(() => {});
                        else v.pause();
                      }}
                    />
                  ) : safeUrl(currentPost.imageUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={safeUrl(currentPost.imageUrl)} alt="" style={imageEl} />
                  ) : (
                    <div style={viewerEmpty}>No media</div>
                  )}

                  {/* right action rail - PREMIUM DESIGN */}
                  <div style={actionRail}>
                    <button type="button" style={railBtn} onClick={() => setPostsErr("Liked ✅")} aria-label="Like">
                      <div style={railIcon}>♥</div>
                      <div style={railCount}>{fmtCompact(Number(currentPost.likesCount || 0))}</div>
                    </button>

                    <button type="button" style={railBtn} onClick={() => setPostsErr("Open comments (coming)") } aria-label="Comment">
                      <div style={railIcon}>💬</div>
                      <div style={railCount}>{fmtCompact(Number(currentPost.commentsCount || 0))}</div>
                    </button>

                    <button type="button" style={railBtn} onClick={() => toggleSave(currentPost)} aria-label="Save">
                      <div style={railIcon}>{savedMap[String(currentPost.id)] ? "★" : "☆"}</div>
                      <div style={railCount}>Save</div>
                    </button>

                    <button type="button" style={railBtn} onClick={() => openShare(currentPost)} aria-label="Share">
                      <div style={railIcon}>↗</div>
                      <div style={railCount}>{fmtCompact(Number(currentPost.sharesCount || 0))}</div>
                    </button>

                    <button type="button" style={soundBtn} onClick={() => openSound(currentPost)} aria-label="Sound">
                      <div style={soundDisc} />
                      <div style={railCount}>Sound</div>
                    </button>
                  </div>

                  {/* bottom follow bar - PREMIUM DESIGN */}
                  <div style={followBar}>
                    <div style={followRing}>
                      <div style={followRingInner}>
                        <div style={followAvatar}>
                          {data?.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={data.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <div style={followAvatarFallback}>{initials(profileName)}</div>
                          )}
                        </div>

                        <button type="button" onClick={doFollow} style={followBtn} disabled={followed}>
                          {followed ? "✓ FOLLOWED" : "+ FOLLOW"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* caption + author */}
              <div style={captionPanel}>
                <div style={captionName}>
                  <span style={goldName}>{profileName}</span>
                </div>
                <div style={captionText}>{currentPost.caption || "—"}</div>

                <div style={captionMetaRow}>
                  <span style={metaPill}>{fmtCompact(Number(currentPost.viewsCount || 0))} views</span>
                  <span style={metaDot}>•</span>
                  <span style={metaPill}>{currentPost.type === "video" ? "Video" : "Photo"}</span>
                  <span style={metaDot}>•</span>
                  <span style={metaPill}>VIP GOLD</span>
                </div>
              </div>
            </div>
          </div>

          {/* SHARE SHEET - PREMIUM DESIGN */}
          {shareOpen && sharePost ? (
            <div style={sheetOverlay} onClick={() => setShareOpen(false)}>
              <div style={sheet} onClick={(e) => e.stopPropagation()}>
                <div style={sheetTitle}>Share Video</div>
                <div style={sheetSub}>Choose how to share or copy link</div>

                <div style={sheetGrid}>
                  <button type="button" style={shareOption} onClick={() => copyLink(sharePost)}>
                    <div style={shareIcon}>🔗</div>
                    <div style={shareLabel}>Copy Link</div>
                  </button>

                  <a
                    style={shareOption}
                    href={`https://wa.me/?text=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div style={shareIcon}>💚</div>
                    <div style={shareLabel}>WhatsApp</div>
                  </a>

                  <a
                    style={shareOption}
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div style={shareIcon}>📘</div>
                    <div style={shareLabel}>Facebook</div>
                  </a>

                  <a
                    style={shareOption}
                    href={`sms:&body=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
                  >
                    <div style={shareIcon}>💬</div>
                    <div style={shareLabel}>Text Message</div>
                  </a>

                  <a
                    style={shareOption}
                    href={safeUrl(sharePost.videoUrl || sharePost.imageUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div style={shareIcon}>⬇</div>
                    <div style={shareLabel}>Download</div>
                  </a>
                </div>

                <button type="button" style={sheetClose} onClick={() => setShareOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* SOUND SHEET - PREMIUM DESIGN */}
          {soundOpen && soundPost ? (
            <div style={sheetOverlay} onClick={() => setSoundOpen(false)}>
              <div style={sheet} onClick={(e) => e.stopPropagation()}>
                <div style={sheetTitle}>
                  <div style={soundDiscLarge} />
                  <div style={{ marginLeft: 12 }}>
                    <div style={{ fontSize: 18, fontWeight: 1000 }}>{soundPost.soundTitle || "Original Sound"}</div>
                    <div style={{ opacity: 0.7, fontSize: 14 }}>by {soundPost.soundAuthor || "Kristo"}</div>
                  </div>
                </div>

                <div style={soundActions}>
                  <button type="button" style={soundActionBtn} onClick={() => setPostsErr("Record with sound (coming)")}>
                    <div style={{ fontSize: 24 }}>🎥</div>
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Record Video</div>
                  </button>
                  <button type="button" style={soundActionBtn} onClick={() => setPostsErr("Upload with sound (coming)")}>
                    <div style={{ fontSize: 24 }}>⬆</div>
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Upload Video</div>
                  </button>
                </div>

                <div style={{ marginTop: 20, fontSize: 16, fontWeight: 1000, opacity: 0.9 }}>Videos using this sound</div>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {soundFeed.length ? (
                    soundFeed.slice(0, 5).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        style={soundVideoRow}
                        onClick={() => {
                          const idx = posts.findIndex((x) => x.id === p.id);
                          if (idx >= 0) {
                            setSoundOpen(false);
                            openViewer(idx);
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={soundMiniDisc} />
                          <div>
                            <div style={{ fontWeight: 1000, fontSize: 14 }}>{p.caption || "Video"}</div>
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{fmtCompact(Number(p.viewsCount || 0))} views</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 20 }}>→</div>
                      </button>
                    ))
                  ) : (
                    <div style={{ opacity: 0.7, textAlign: "center", padding: 20 }}>No videos found for this sound</div>
                  )}
                </div>

                <button type="button" style={sheetClose} onClick={() => setSoundOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   PREMIUM VIP STYLES - BETTER THAN FACEBOOK/TIKTOK/YOUTUBE
   ========================= */

const wrap: CSSProperties = { 
  minHeight: "100vh",
  background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
  color: "#ffffff",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
};

const hero: CSSProperties = {
  padding: "24px",
  borderBottom: "1px solid rgba(255,215,0,0.1)",
  backdropFilter: "blur(20px)",
  background: "rgba(15, 15, 15, 0.8)",
  position: "sticky",
  top: 0,
  zIndex: 50
};

const heroRow: CSSProperties = { 
  display: "flex", 
  alignItems: "center", 
  justifyContent: "space-between", 
  gap: 20 
};

const heroLeft: CSSProperties = { 
  display: "flex", 
  alignItems: "center", 
  gap: 16 
};

const heroRight: CSSProperties = { 
  display: "flex", 
  alignItems: "center", 
  gap: 12 
};

const h1: CSSProperties = { 
  fontSize: "28px", 
  fontWeight: 900,
  display: "flex",
  alignItems: "center",
  gap: 8
};

const goldName: CSSProperties = {
  background: "linear-gradient(45deg, #ffd700, #fff8dc)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  fontWeight: 900
};

const verifiedBadge: CSSProperties = {
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  borderRadius: "50%",
  width: "20px",
  height: "20px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "12px",
  color: "#000",
  fontWeight: "bold"
};

const sub: CSSProperties = { 
  opacity: 0.88, 
  marginTop: 8, 
  display: "flex", 
  alignItems: "center", 
  gap: 12, 
  flexWrap: "wrap",
  fontSize: "14px"
};

const dot: CSSProperties = { opacity: 0.45 };

const avatarOuter: CSSProperties = {
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  border: "2px solid #ffd700",
  overflow: "hidden",
  position: "relative"
};

const avatarImg: CSSProperties = { 
  width: "100%", 
  height: "100%", 
  objectFit: "cover" 
};

const avatarFallback: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 1000,
  fontSize: 20,
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  color: "#000"
};

const pillBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: 20,
  border: "1px solid rgba(255,215,0,0.3)",
  background: "rgba(255,215,0,0.1)",
  fontWeight: 700,
  fontSize: 12
};

const panel: CSSProperties = {
  margin: "24px auto",
  padding: "24px",
  maxWidth: "1200px",
  borderRadius: 20,
  border: "1px solid rgba(255,215,0,0.15)",
  background: "rgba(255,255,255,0.03)",
  backdropFilter: "blur(10px)"
};

const alert: CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 14,
  border: "1px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.08)",
  maxWidth: "1200px",
  margin: "14px auto"
};

const btn: CSSProperties = {
  padding: "12px 24px",
  borderRadius: 12,
  border: "1px solid #ffd700",
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  color: "#000",
  fontWeight: "bold",
  cursor: "pointer",
  transition: "all 0.3s"
};

const ghostBtn: CSSProperties = {
  padding: "12px 24px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.05)",
  color: "inherit",
  fontWeight: "bold",
  cursor: "pointer",
  transition: "all 0.3s"
};

const postsTop: CSSProperties = { 
  display: "flex", 
  alignItems: "center", 
  justifyContent: "space-between", 
  marginBottom: 24 
};

const postsTitle: CSSProperties = { 
  fontSize: "24px", 
  fontWeight: 900,
  display: "flex",
  alignItems: "center",
  gap: 12
};

const postsTitleGold: CSSProperties = {
  padding: "6px 16px",
  borderRadius: 20,
  background: "linear-gradient(45deg, rgba(255,215,0,0.2), rgba(255,215,0,0.1))",
  border: "1px solid rgba(255,215,0,0.5)",
  color: "#ffd700",
  fontWeight: 900,
  fontSize: 14
};

const postsHint: CSSProperties = { 
  opacity: 0.7, 
  marginTop: 8,
  fontSize: 14 
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: "20px",
  marginTop: "20px"
};

const postCard: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  transition: "transform 0.3s"
};

const postFrame: CSSProperties = {
  borderRadius: "16px",
  overflow: "hidden",
  position: "relative",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,215,0,0.1)",
  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  transition: "all 0.3s"
};

const postFrameInner: CSSProperties = {
  position: "relative",
  background: "rgba(0,0,0,0.4)"
};

const thumbVideo: CSSProperties = {
  position: "relative",
  paddingBottom: "125%",
  background: "linear-gradient(135deg, rgba(255,215,0,0.1), rgba(0,0,0,0.3))"
};

const playBadge: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  fontSize: "48px",
  color: "#ffd700",
  textShadow: "0 4px 12px rgba(0,0,0,0.8)"
};

const thumbDim: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)"
};

const thumbImg: CSSProperties = { 
  width: "100%", 
  height: "200px", 
  objectFit: "cover", 
  display: "block" 
};

const thumbEmpty: CSSProperties = { 
  height: "200px", 
  display: "flex", 
  alignItems: "center", 
  justifyContent: "center", 
  background: "rgba(255,215,0,0.1)",
  color: "#ffd700",
  fontWeight: "bold" 
};

const postMeta: CSSProperties = { 
  padding: "16px" 
};

const postCaption: CSSProperties = { 
  fontWeight: 700, 
  fontSize: "14px", 
  marginBottom: 12,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  textOverflow: "ellipsis"
};

const postStats: CSSProperties = { 
  display: "flex", 
  alignItems: "center", 
  justifyContent: "space-between" 
};

const viewsPill: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 12,
  background: "rgba(255,255,255,0.1)",
  fontSize: 12,
  fontWeight: 600
};

const vipChip: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 12,
  background: "linear-gradient(45deg, rgba(255,215,0,0.2), rgba(255,215,0,0.1))",
  border: "1px solid rgba(255,215,0,0.3)",
  color: "#ffd700",
  fontSize: 12,
  fontWeight: 700
};

/* Viewer - PREMIUM DESIGN */
const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.95)",
  zIndex: 10000,
  display: "flex",
  flexDirection: "column"
};

const overlayTop: CSSProperties = {
  padding: "20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottom: "1px solid rgba(255,215,0,0.1)"
};

const overlayClose: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer"
};

const overlayTopRight: CSSProperties = { 
  display: "flex", 
  gap: "12px" 
};

const overlayNavBtn: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 12,
  border: "1px solid rgba(255,215,0,0.3)",
  background: "rgba(255,215,0,0.1)",
  color: "#ffd700",
  fontWeight: "bold",
  cursor: "pointer"
};

const viewerWrap: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px"
};

const premiumFrameOuter: CSSProperties = {
  width: "100%",
  maxWidth: "800px",
  borderRadius: "20px",
  overflow: "hidden",
  border: "2px solid rgba(255,215,0,0.3)",
  background: "rgba(0,0,0,0.5)"
};

const premiumFrameMid: CSSProperties = {
  position: "relative",
  paddingBottom: "56.25%", // 16:9 aspect ratio
  background: "#000"
};

const premiumFrameInner: CSSProperties = {
  position: "absolute",
  inset: 0
};

const videoEl: CSSProperties = { 
  width: "100%", 
  height: "100%", 
  objectFit: "cover" 
};

const imageEl: CSSProperties = { 
  width: "100%", 
  height: "100%", 
  objectFit: "contain",
  background: "#000"
};

const viewerEmpty: CSSProperties = { 
  width: "100%", 
  height: "100%", 
  display: "flex", 
  alignItems: "center", 
  justifyContent: "center", 
  background: "rgba(0,0,0,0.5)",
  color: "#ffd700",
  fontSize: "20px",
  fontWeight: "bold" 
};

/* Action Rail - PREMIUM DESIGN */
const actionRail: CSSProperties = {
  position: "absolute",
  right: "20px",
  bottom: "160px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  alignItems: "center"
};

const railBtn: CSSProperties = {
  background: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: "50%",
  width: "60px",
  height: "60px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "white"
};

const railIcon: CSSProperties = {
  fontSize: "24px",
  marginBottom: "4px"
};

const railCount: CSSProperties = {
  fontSize: "12px",
  fontWeight: "600"
};

const soundBtn: CSSProperties = {
  background: "rgba(255,215,0,0.1)",
  border: "1px solid rgba(255,215,0,0.5)",
  borderRadius: "50%",
  width: "60px",
  height: "60px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer"
};

const soundDisc: CSSProperties = {
  width: "24px",
  height: "24px",
  borderRadius: "50%",
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  border: "2px solid #ffd700",
  marginBottom: "4px"
};

/* Follow Bar - PREMIUM DESIGN */
const followBar: CSSProperties = {
  position: "absolute",
  bottom: "20px",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const followRing: CSSProperties = {
  padding: "4px",
  borderRadius: "50%",
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const followRingInner: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "8px"
};

const followAvatar: CSSProperties = {
  width: "80px",
  height: "80px",
  borderRadius: "50%",
  border: "3px solid #000",
  overflow: "hidden"
};

const followAvatarFallback: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  color: "#000",
  fontWeight: "bold",
  fontSize: "24px"
};

const followBtn: CSSProperties = {
  padding: "8px 20px",
  borderRadius: "20px",
  background: "#ffd700",
  color: "#000",
  border: "none",
  fontWeight: "bold",
  cursor: "pointer",
  fontSize: "14px"
};

/* Caption Panel */
const captionPanel: CSSProperties = {
  padding: "20px",
  background: "rgba(0,0,0,0.8)",
  borderTop: "1px solid rgba(255,215,0,0.1)"
};

const captionName: CSSProperties = {
  fontSize: "18px",
  fontWeight: "bold",
  marginBottom: "8px"
};

const captionText: CSSProperties = {
  fontSize: "16px",
  marginBottom: "12px",
  lineHeight: 1.5
};

const captionMetaRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: "14px",
  opacity: 0.8
};

const metaPill: CSSProperties = {
  padding: "4px 12px",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.1)",
  fontSize: "12px"
};

const metaDot: CSSProperties = {
  opacity: 0.5
};

/* Share Sheet - PREMIUM DESIGN */
const sheetOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 20000
};

const sheet: CSSProperties = {
  background: "linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)",
  borderRadius: "20px",
  padding: "30px",
  width: "90%",
  maxWidth: "500px",
  border: "1px solid rgba(255,215,0,0.3)"
};

const sheetTitle: CSSProperties = {
  fontSize: "24px",
  fontWeight: "bold",
  marginBottom: "8px",
  background: "linear-gradient(45deg, #ffd700, #fff8dc)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent"
};

const sheetSub: CSSProperties = {
  opacity: 0.7,
  marginBottom: "24px",
  fontSize: "14px"
};

const sheetGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "20px",
  marginBottom: "30px"
};

const shareOption: CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  padding: "20px 10px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "10px",
  cursor: "pointer",
  textDecoration: "none",
  color: "white",
  transition: "all 0.3s"
};

const shareIcon: CSSProperties = {
  fontSize: "30px"
};

const shareLabel: CSSProperties = {
  fontSize: "12px",
  fontWeight: "600"
};

const sheetClose: CSSProperties = {
  width: "100%",
  padding: "16px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer"
};

/* Sound Sheet - PREMIUM DESIGN */
const soundDiscLarge: CSSProperties = {
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  border: "3px solid #ffd700"
};

const soundActions: CSSProperties = {
  display: "flex",
  gap: "20px",
  margin: "30px 0"
};

const soundActionBtn: CSSProperties = {
  flex: 1,
  background: "rgba(255,215,0,0.1)",
  border: "1px solid rgba(255,215,0,0.3)",
  borderRadius: "12px",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "12px",
  cursor: "pointer",
  color: "#ffd700"
};

const soundVideoRow: CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  padding: "16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  cursor: "pointer",
  color: "white",
  transition: "all 0.3s"
};

const soundMiniDisc: CSSProperties = {
  width: "30px",
  height: "30px",
  borderRadius: "50%",
  background: "linear-gradient(45deg, #ffd700, #ffed4e)",
  border: "2px solid #ffd700"
};
