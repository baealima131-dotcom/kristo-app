import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { getFeedItemById, listFeedItems, upsertFeedItem } from "@/app/api/_lib/store/feedDb";
import {
  fetchFacebookOEmbedVideo,
  parseFacebookVideoUrl,
  type ParsedFacebookVideoLink,
} from "@/lib/facebookVideoLink";
import { fetchFacebookGraphVideoStats } from "@/lib/facebookGraphVideoStats";
import {
  createPresignedPosterUpload,
  getVideoStorageConfig,
  MAX_POSTER_UPLOAD_BYTES,
} from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "youtube" | "tiktok" | "facebook";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseVideoUrl(
  raw: unknown
): { provider: Provider; url: URL; videoId: string; facebook?: ParsedFacebookVideoLink } | null {
  const facebook = parseFacebookVideoUrl(raw);
  if (facebook) {
    // The id is confirmed (and share links resolved) by Facebook's oEmbed response.
    return { provider: "facebook", url: new URL(facebook.url), videoId: facebook.videoId || "", facebook };
  }
  const value = String(raw || "").trim();
  if (!value || value.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    let videoId = "";
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
    else {
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      videoId = match?.[1] || "";
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return { provider: "youtube", url: new URL(`https://www.youtube.com/watch?v=${videoId}`), videoId };
  }

  if (host === "tiktok.com" || host === "m.tiktok.com") {
    const match = url.pathname.match(/^\/@[A-Za-z0-9._-]+\/video\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return { provider: "tiktok", url: new URL(`https://www.tiktok.com${url.pathname}`), videoId: match[1] };
  }
  return null;
}

function safeCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

async function fetchJson(url: URL, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Public YouTube video details from YouTube's official oEmbed endpoint (no API key needed).
 * Gives title, channel and thumbnail; date and counts need the YouTube Data API key.
 */
async function youtubeOEmbedMetadata(videoId: string) {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.search = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    format: "json",
  }).toString();
  const { response, body } = await fetchJson(endpoint);
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Video hii ya YouTube haiwezi kuwekwa nje ya YouTube (embedding imezimwa au ni private)."), { status: 422 });
  }
  if (response.status === 404 || response.status === 400) {
    throw Object.assign(new Error("No public YouTube video was found at that link."), { status: 404 });
  }
  if (!response.ok || !body || typeof body !== "object") {
    throw Object.assign(new Error("YouTube metadata could not be loaded right now."), { status: 502 });
  }
  const authorUrl = typeof body.author_url === "string" && /^https:\/\/(www\.)?youtube\.com\//i.test(body.author_url)
    ? body.author_url
    : null;
  return {
    provider: "youtube" as const,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: String(body.title || ""),
    creatorName: String(body.author_name || ""),
    creatorId: authorUrl,
    creatorProfileUrl: authorUrl,
    detectedLanguageCode: "",
    creatorAvatarUrl: null,
    thumbnailUrl: typeof body.thumbnail_url === "string" ? body.thumbnail_url : null,
    publishedAt: null,
    stats: { views: null, likes: null, comments: null },
    unavailableFields: ["publishedAt", "creatorAvatarUrl", "views", "likes", "comments"],
  };
}

async function youtubeMetadata(videoId: string) {
  const key = String(process.env.YOUTUBE_DATA_API_KEY || "").trim();
  // Without the Data API key, fall back to oEmbed so links still work (no date or counts).
  if (!key) return youtubeOEmbedMetadata(videoId);

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.search = new URLSearchParams({
    part: "snippet,statistics",
    id: videoId,
    key,
  }).toString();

  const { response, body } = await fetchJson(endpoint);
  if (!response.ok) {
    if (response.status === 403) {
      throw Object.assign(new Error("YouTube API imekataa ombi. Hakiki API key, API restrictions au quota."), { status: 503 });
    }
    throw Object.assign(new Error("YouTube metadata could not be loaded right now."), { status: 502 });
  }

  const item = Array.isArray(body?.items) ? body.items[0] : null;
  if (!item) throw Object.assign(new Error("No public YouTube video was found at that link."), { status: 404 });

  const snippet = item.snippet || {};
  const statistics = item.statistics || {};
  const stats = {
    views: safeCount(statistics.viewCount),
    likes: safeCount(statistics.likeCount),
    comments: safeCount(statistics.commentCount),
  };
  // YouTube answered but left a count out: the owner hid likes or turned comments off.
  const hiddenFields = (["likes", "comments"] as const).filter((field) => stats[field] === null);
  const channelId = String(snippet.channelId || "");
  let creatorAvatarUrl: string | null = null;

  if (channelId) {
    const channelsUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelsUrl.search = new URLSearchParams({
      part: "snippet",
      id: channelId,
      key,
    }).toString();
    try {
      const channelResult = await fetchJson(channelsUrl, 6000);
      const channel = channelResult.body?.items?.[0];
      creatorAvatarUrl =
        channel?.snippet?.thumbnails?.high?.url ||
        channel?.snippet?.thumbnails?.medium?.url ||
        channel?.snippet?.thumbnails?.default?.url ||
        null;
    } catch {
      // Video metadata remains useful when the optional channel image is unavailable.
    }
  }

  return {
    provider: "youtube" as const,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: String(snippet.title || ""),
    creatorName: String(snippet.channelTitle || ""),
    creatorId: channelId || null,
    creatorProfileUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : null,
    detectedLanguageCode: String(snippet.defaultAudioLanguage || snippet.defaultLanguage || "").slice(0, 16),
    creatorAvatarUrl,
    thumbnailUrl:
      item?.snippet?.thumbnails?.maxres?.url ||
      item?.snippet?.thumbnails?.standard?.url ||
      item?.snippet?.thumbnails?.high?.url ||
      item?.snippet?.thumbnails?.medium?.url ||
      item?.snippet?.thumbnails?.default?.url ||
      null,
    publishedAt: snippet.publishedAt ? String(snippet.publishedAt) : null,
    stats,
    unavailableFields: [
      ...(creatorAvatarUrl ? [] : ["creatorAvatarUrl"]),
      ...(snippet.publishedAt ? [] : ["publishedAt"]),
      ...(stats.views === null ? ["views"] : []),
      ...hiddenFields,
    ],
    hiddenFields,
  };
}

async function tiktokMetadata(url: URL, videoId: string) {
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", url.toString());
  const { response, body } = await fetchJson(endpoint);
  if (!response.ok || !body || typeof body !== "object") {
    throw Object.assign(new Error("TikTok could not provide details for this public video link."), { status: 422 });
  }

  return {
    provider: "tiktok" as const,
    videoId,
    url: url.toString(),
    title: String(body.title || ""),
    creatorName: String(body.author_name || ""),
    creatorId: typeof body.author_url === "string" ? body.author_url : null,
    creatorProfileUrl: typeof body.author_url === "string" ? body.author_url : null,
    detectedLanguageCode: "",
    creatorAvatarUrl: null,
    thumbnailUrl: typeof body.thumbnail_url === "string" ? body.thumbnail_url : null,
    publishedAt: null,
    stats: { views: null, likes: null, comments: null },
    unavailableFields: ["publishedAt", "views", "likes", "comments"],
  };
}

async function facebookMetadata(input: ParsedFacebookVideoLink, originalUrl: string) {
  const confirmed = await fetchFacebookOEmbedVideo(input, {
    accessToken: process.env.FACEBOOK_OEMBED_ACCESS_TOKEN,
  }).catch(() => null);
  if (!confirmed || !confirmed.videoId) {
    throw Object.assign(
      new Error("Facebook haikuthibitisha video hii kuwa ya umma. Video za private au zilizofutwa haziwezi kuongezwa."),
      { status: 422 }
    );
  }
  // Counts come only from Meta's Graph API, and only when the app's access allows it; a
  // missing value stays null (shown as unavailable) and never blocks the video.
  const graph = await fetchFacebookGraphVideoStats(confirmed.videoId, { timeoutMs: 5000 }).catch(() => null);
  const stats = { views: null, likes: graph?.likes ?? null, comments: graph?.comments ?? null };
  const publishedAt = graph?.publishedAt || confirmed.publishedAt;
  const unavailableFields = ["thumbnailUrl", "creatorAvatarUrl", "views"];
  if (stats.likes === null) unavailableFields.push("likes");
  if (stats.comments === null) unavailableFields.push("comments");
  if (!publishedAt) unavailableFields.push("publishedAt");
  return {
    provider: "facebook" as const,
    videoId: confirmed.videoId,
    url: confirmed.canonicalUrl,
    originalUrl,
    orientation: confirmed.vertical ? ("vertical" as const) : ("landscape" as const),
    title: confirmed.title,
    creatorName: confirmed.creatorName,
    creatorId: confirmed.creatorProfileUrl,
    creatorProfileUrl: confirmed.creatorProfileUrl,
    detectedLanguageCode: "",
    creatorAvatarUrl: null,
    // Facebook's oEmbed returns no thumbnail and no counts: never invent them.
    thumbnailUrl: null,
    publishedAt,
    stats,
    unavailableFields,
  };
}

const FACEBOOK_ITEM_PREFIX = "system-admin-video-facebook-";
const MAX_MANUAL_COUNT = 1_000_000_000_000;

/**
 * A count a System Admin read on Facebook. Empty means "not entered" (null). Accepts digits with
 * optional spaces, commas or dots used as thousands separators; anything else is invalid.
 */
function parseManualCount(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= MAX_MANUAL_COUNT ? { ok: true, value } : { ok: false };
  }
  const text = String(value).trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d{1,3}([ ,.]?\d{3})*$|^\d+$/.test(text)) return { ok: false };
  const count = Number(text.replace(/[ ,.]/g, ""));
  return Number.isSafeInteger(count) && count <= MAX_MANUAL_COUNT ? { ok: true, value: count } : { ok: false };
}

/** Facebook counts entered by a System Admin, stamped with when they were checked. */
function readManualStatsInput(input: unknown, userId: string):
  | { ok: true; stats: { likes: number | null; comments: number | null; checkedAt: string; updatedBy: string } | null }
  | { ok: false } {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const likes = parseManualCount(source.likes);
  const comments = parseManualCount(source.comments);
  if (!likes.ok || !comments.ok) return { ok: false };
  if (likes.value === null && comments.value === null) return { ok: true, stats: null };
  return {
    ok: true,
    stats: { likes: likes.value, comments: comments.value, checkedAt: new Date().toISOString(), updatedBy: userId },
  };
}

function manualStatsForList(item: any) {
  const raw = item?.facebookManualStats;
  if (!raw || typeof raw !== "object") return null;
  const count = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  const likes = count(raw.likes);
  const comments = count(raw.comments);
  if (likes === null && comments === null) return null;
  return { likes, comments, checkedAt: String(raw.checkedAt || "") };
}

/** Covers for Facebook links live in the existing poster storage, in their own folder. */
const FACEBOOK_COVER_FOLDER = "system-admin-video-covers";
const FACEBOOK_COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Only a cover uploaded to Kristo's own storage (this folder) may be saved on a post. */
function trustedFacebookCoverUrl(value: unknown): string | null {
  const url = String(value || "").trim();
  if (!url || url.length > 2048) return null;
  const base = String(getVideoStorageConfig()?.publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) return null;
  const prefix = `${base}/church-video-posters/${FACEBOOK_COVER_FOLDER}/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(rest) ? url : null;
}

const MANUAL_COUNT_ERROR = "Hesabu za Facebook ziwe namba kamili (mf. 1250 au 1,250), au ziachwe tupu.";

export async function GET(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  const limit = await rateLimit(req, {
    name: "system-admin-video-links-list",
    limit: 60,
    windowMs: 60 * 60 * 1000,
    key: `system-admin-video-links-list:${auth.viewer.userId}`,
  });
  if (!limit.allowed) return json({ ok: false, error: "Jaribu tena baada ya muda mfupi." }, 429);

  const items = (await listFeedItems())
    .filter((item: any) => String(item?.source || "") === "system-admin-video-link" && !item?.deleted)
    .sort((a: any, b: any) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")))
    .slice(0, 300)
    .map((item: any) => ({
      id: String(item?.id || ""),
      hidden: item?.hiddenBySystemAdmin === true,
      provider: String(item?.videoDisplayType || item?.provider || "youtube"),
      url: String(item?.videoUrl || item?.url || ""),
      originalUrl: String(item?.originalUrl || item?.videoUrl || item?.url || ""),
      orientation: String(item?.videoOrientation || ""),
      title: String(item?.title || ""),
      creatorId: String(item?.creatorId || ""),
      creatorName: String(item?.creatorName || item?.actorLabel || ""),
      creatorProfileUrl: String(item?.creatorProfileUrl || ""),
      creatorAvatarUrl: String(item?.creatorAvatarUrl || item?.actorAvatarUri || ""),
      thumbnailUrl: String(item?.thumbnailUrl || item?.thumbnailUri || item?.posterUri || ""),
      publishedAt: String(item?.publishedAt || ""),
      createdAt: String(item?.createdAt || ""),
      countryCode: String(item?.countryCode || ""),
      countryName: String(item?.countryName || ""),
      languageCode: String(item?.languageCode || ""),
      languageName: String(item?.languageName || ""),
      stats: item?.platformStats && typeof item.platformStats === "object" ? item.platformStats : {},
      manualStats: manualStatsForList(item),
      coverUrl: String(item?.facebookCoverUrl || ""),
    }));

  return json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  const limit = await rateLimit(req, {
    name: "system-admin-video-metadata",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    key: `system-admin-video-metadata:${auth.viewer.userId}`,
  });
  if (!limit.allowed) {
    return json({ ok: false, error: "Too many lookups. Try again later." }, 429);
  }

  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return json({ ok: false, error: "Request is too large." }, 413);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const action = String(body?.action || "").trim().toLowerCase();
  if (action === "facebook-cover-upload-url") {
    // Signed upload for an optional Facebook Reel cover (System Admin only, images only).
    const contentType = String(body?.contentType || "").trim().toLowerCase();
    const fileSize = Number(body?.fileSize || 0);
    if (!FACEBOOK_COVER_TYPES.has(contentType)) {
      return json({ ok: false, error: "Cover iwe picha ya JPG, PNG au WebP." }, 400);
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_POSTER_UPLOAD_BYTES) {
      return json({ ok: false, error: `Cover isizidi MB ${Math.floor(MAX_POSTER_UPLOAD_BYTES / (1024 * 1024))}.` }, 400);
    }
    try {
      const signed = await createPresignedPosterUpload({
        churchId: FACEBOOK_COVER_FOLDER,
        userId: String(auth.viewer.userId || "system-admin"),
        fileName: String(body?.fileName || "facebook-cover.jpg").slice(0, 120),
        contentType,
        fileSize,
      });
      return json({ ok: true, uploadUrl: signed.uploadUrl, publicUrl: signed.publicUrl, contentType: signed.contentType });
    } catch {
      return json({ ok: false, error: "Upload ya cover haikuweza kuanza." }, 500);
    }
  }

  if (action === "facebook-cover") {
    // Set or clear the cover of a saved Facebook link.
    const id = String(body?.id || "").trim();
    if (!id.startsWith(FACEBOOK_ITEM_PREFIX) || !/^\d{5,25}$/.test(id.slice(FACEBOOK_ITEM_PREFIX.length))) {
      return json({ ok: false, error: "Cover hii inaweza kuwekwa kwa video za Facebook pekee." }, 400);
    }
    const clear = body?.coverUrl === null || body?.coverUrl === "";
    const coverUrl = clear ? null : trustedFacebookCoverUrl(body?.coverUrl);
    if (!clear && !coverUrl) return json({ ok: false, error: "Cover haikutambuliwa." }, 400);
    const existing = await getFeedItemById(id);
    if (!existing || String((existing as any)?.source || "") !== "system-admin-video-link" || (existing as any)?.deleted) {
      return json({ ok: false, error: "Video haikupatikana." }, 404);
    }
    await upsertFeedItem({ ...existing, facebookCoverUrl: coverUrl } as any);
    return json({ ok: true, coverUrl });
  }

  if (action === "facebook-manual-stats") {
    // Edit (or clear) the Facebook counts an admin entered. Facebook links only.
    const id = String(body?.id || "").trim();
    if (!id.startsWith(FACEBOOK_ITEM_PREFIX) || !/^\d{5,25}$/.test(id.slice(FACEBOOK_ITEM_PREFIX.length))) {
      return json({ ok: false, error: "Hesabu hizi zinaweza kuwekwa kwa video za Facebook pekee." }, 400);
    }
    const manual = readManualStatsInput(body?.manualStats, String(auth.viewer.userId || "system-admin"));
    if (!manual.ok) return json({ ok: false, error: MANUAL_COUNT_ERROR }, 400);
    const existing = await getFeedItemById(id);
    if (!existing || String((existing as any)?.source || "") !== "system-admin-video-link" || (existing as any)?.deleted) {
      return json({ ok: false, error: "Video haikupatikana." }, 404);
    }
    await upsertFeedItem({ ...existing, facebookManualStats: manual.stats } as any);
    return json({ ok: true, manualStats: manualStatsForList({ facebookManualStats: manual.stats }) });
  }
  if (action === "hide" || action === "delete") {
    const id = String(body?.id || "").trim();
    const youtubePrefix = "system-admin-video-youtube-";
    const tiktokPrefix = "system-admin-video-tiktok-";
    const facebookPrefix = "system-admin-video-facebook-";
    const youtubeId = id.startsWith(youtubePrefix) ? id.slice(youtubePrefix.length) : "";
    const tiktokId = id.startsWith(tiktokPrefix) ? id.slice(tiktokPrefix.length) : "";
    const facebookId = id.startsWith(facebookPrefix) ? id.slice(facebookPrefix.length) : "";
    const validId = /^[A-Za-z0-9_-]{11}$/.test(youtubeId) ||
      (tiktokId.length >= 8 && tiktokId.length <= 24 && Array.from(tiktokId).every((char) => char >= "0" && char <= "9")) ||
      /^\d{5,25}$/.test(facebookId);
    if (!validId) return json({ ok: false, error: "Video haikutambuliwa." }, 400);
    const existing = (await listFeedItems()).find(
      (item: any) => String(item?.id || "") === id && String(item?.source || "") === "system-admin-video-link"
    );
    if (!existing) return json({ ok: false, error: "Video haikupatikana." }, 404);

    const now = new Date().toISOString();
    if (action === "delete") {
      await upsertFeedItem({
        ...existing,
        deleted: true,
        deletedAt: now,
        deletedBy: String(auth.viewer.userId || "system-admin"),
      } as any);
      return json({ ok: true, deleted: true });
    }

    const hidden = body?.hidden === true;
    await upsertFeedItem({
      ...existing,
      hiddenBySystemAdmin: hidden,
      hiddenBySystemAdminAt: hidden ? now : null,
      hiddenBySystemAdminBy: hidden ? String(auth.viewer.userId || "system-admin") : null,
    } as any);
    return json({ ok: true, hidden });
  }

  const parsed = parseVideoUrl(body?.url);
  if (!parsed) {
    return json({ ok: false, error: "Paste a valid public YouTube, TikTok or Facebook video link." }, 400);
  }

  try {
    const metadata: any =
      parsed.provider === "youtube"
        ? await youtubeMetadata(parsed.videoId)
        : parsed.provider === "facebook" && parsed.facebook
          ? await facebookMetadata(parsed.facebook, String(body?.url || "").trim())
          : await tiktokMetadata(parsed.url, parsed.videoId);
    if (body?.action === "publish") {
      const countryCode = String(body?.countryCode || "").trim().toUpperCase();
      const countryName = String(body?.countryName || "").trim().slice(0, 80);
      const languageCode = String(body?.languageCode || "").trim().toLowerCase().slice(0, 12);
      const languageName = String(body?.languageName || "").trim().slice(0, 80);
      if (!/^[A-Z]{2}$/.test(countryCode) || !countryName) {
        return json({ ok: false, error: "Chagua nchi kabla ya kuongeza video." }, 400);
      }
      if (!/^[a-z]{2,3}$/.test(languageCode) || !languageName) {
        return json({ ok: false, error: "Chagua lugha kabla ya kuongeza video." }, 400);
      }

      // Facebook only: optional counts the admin saw on Facebook. Publishing the same video again
      // without new counts keeps the ones entered before.
      const itemId = "system-admin-video-" + parsed.provider + "-" + String(metadata.videoId || parsed.videoId);
      let facebookManualStats: unknown = undefined;
      let facebookCoverUrl: string | null | undefined = undefined;
      if (parsed.provider === "facebook") {
        if (body?.facebookCoverUrl) {
          facebookCoverUrl = trustedFacebookCoverUrl(body.facebookCoverUrl);
          if (!facebookCoverUrl) return json({ ok: false, error: "Cover haikutambuliwa." }, 400);
        }
        const manual = readManualStatsInput(body?.manualStats, String(auth.viewer.userId || "system-admin"));
        if (!manual.ok) return json({ ok: false, error: MANUAL_COUNT_ERROR }, 400);
        const previous = manual.stats && facebookCoverUrl ? null : await getFeedItemById(itemId).catch(() => null);
        facebookManualStats = manual.stats ?? (previous as any)?.facebookManualStats ?? null;
        // Re-publishing without a new cover keeps the one saved before.
        facebookCoverUrl = facebookCoverUrl ?? (previous as any)?.facebookCoverUrl ?? null;
      }

      const now = new Date().toISOString();
      const feedItem = await upsertFeedItem({
        // Facebook share links carry no id until oEmbed confirms the video.
        id: itemId,
        ...(parsed.provider === "facebook"
          ? { originalUrl: metadata.originalUrl, videoOrientation: metadata.orientation, facebookManualStats, facebookCoverUrl }
          : {}),
        churchId: "system-admin-global",
        type: "video",
        source: "system-admin-video-link",
        visibility: "public",
        mediaType: "video",
        videoDisplayType: parsed.provider,
        videoUrl: metadata.url,
        url: metadata.url,
        title: metadata.title || "Video",
        text: metadata.creatorName || "",
        creatorName: metadata.creatorName,
        creatorId: metadata.creatorId,
        creatorProfileUrl: metadata.creatorProfileUrl,
        creatorAvatarUrl: metadata.creatorAvatarUrl,
        thumbnailUrl: metadata.thumbnailUrl,
        thumbnailUri: metadata.thumbnailUrl,
        posterUri: metadata.thumbnailUrl,
        actorLabel: metadata.creatorName || "Mwenye video",
        actorAvatarUri: metadata.creatorAvatarUrl || undefined,
        avatarUri: metadata.creatorAvatarUrl || undefined,
        churchName: metadata.creatorName || "Video ya Kristo App",
        countryCode,
        countryName,
        languageCode,
        languageName,
        publishedAt: metadata.publishedAt || undefined,
        platformStats: metadata.stats,
        platformStatsUpdatedAt: now,
        platformUnavailableFields: metadata.unavailableFields || [],
        // Counts the platform withholds on purpose (YouTube: likes hidden, comments turned off).
        platformHiddenFields: metadata.hiddenFields || [],
        createdAt: now,
        createdBy: String(auth.viewer.userId || "system-admin"),
      } as any);
      return json({ ok: true, metadata, published: true, feedItemId: feedItem.id });
    }

    return json({ ok: true, metadata });
  } catch (error: any) {
    const status = Number(error?.status) || 502;
    return json(
      {
        ok: false,
        error: String(error?.message || "Video details could not be loaded."),
      },
      status >= 400 && status <= 599 ? status : 502
    );
  }
}
