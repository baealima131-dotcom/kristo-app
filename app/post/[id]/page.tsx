import type { Metadata } from "next";
import Link from "next/link";

import {
  PUBLIC_SHARE_WEB_BASE,
  resolvePublicSharedPost,
} from "@/app/api/_lib/publicFeedPostShare";

const APP_STORE_SEARCH_URL = "https://apps.apple.com/us/search?term=Kristo%20App";
const PLAY_STORE_SEARCH_URL =
  "https://play.google.com/store/search?q=Kristo%20App&c=apps";

type PageProps = {
  params: Promise<{ id: string }>;
};

function decodeRoutePostId(raw: string) {
  try {
    return decodeURIComponent(String(raw || "").trim());
  } catch {
    return String(raw || "").trim();
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: rawId } = await params;
  const post = await resolvePublicSharedPost(rawId);

  if (!post) {
    return {
      title: "Post unavailable | Kristo App",
      description: "This Kristo post is no longer available.",
      robots: { index: false, follow: false },
    };
  }

  const description = post.body.slice(0, 180) || `Shared from ${post.churchName} on Kristo App.`;

  return {
    title: `${post.title} | Kristo App`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: post.shareUrl,
      siteName: "Kristo App",
      type: post.videoUrl ? "video.other" : "article",
      ...(post.posterUrl ? { images: [{ url: post.posterUrl, alt: post.title }] } : {}),
    },
    twitter: {
      card: post.posterUrl ? "summary_large_image" : "summary",
      title: post.title,
      description,
      ...(post.posterUrl ? { images: [post.posterUrl] } : {}),
    },
    alternates: {
      canonical: post.shareUrl,
    },
  };
}

export default async function SharedPostPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const routePostId = decodeRoutePostId(rawId);
  const post = await resolvePublicSharedPost(routePostId);

  if (!post) {
    return (
      <main className="vip-auth privacy-page share-post-page">
        <div className="vip-ambient" aria-hidden="true" />
        <div className="vip-grain" aria-hidden="true" />

        <article className="privacy-shell">
          <header className="privacy-header">
            <p className="vip-kicker">Kristo App</p>
            <h1 className="privacy-title">Post unavailable</h1>
            <p className="privacy-meta">This post may have been removed or is not publicly shareable.</p>
          </header>

          <div className="privacy-card">
            <p className="privacy-lead">
              The link you opened does not point to a public Kristo post anymore. If you have the app installed,
              open Kristo App and browse your Home Feed instead.
            </p>
            <div className="share-post-actions">
              <a className="share-post-btn share-post-btn-primary" href={APP_STORE_SEARCH_URL}>
                Get Kristo App
              </a>
              <Link className="share-post-btn share-post-btn-secondary" href="/privacy">
                Privacy Policy
              </Link>
            </div>
          </div>
        </article>

        <SharePostPageStyles />
      </main>
    );
  }

  const openInAppUrl = `${PUBLIC_SHARE_WEB_BASE}/post/${encodeURIComponent(post.id)}`;
  const previewText = post.body || post.title;

  return (
    <main className="vip-auth privacy-page">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <article className="privacy-shell">
        <header className="privacy-header">
          <p className="vip-kicker">{post.churchName}</p>
          <h1 className="privacy-title">{post.title}</h1>
          <p className="privacy-meta">
            {post.authorName}
            {post.createdAt ? ` · ${new Date(post.createdAt).toLocaleDateString()}` : ""}
          </p>
        </header>

        <div className="privacy-card">
          {post.posterUrl ? (
            <div className="share-post-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.posterUrl} alt={post.title} className="share-post-poster" />
            </div>
          ) : null}

          {previewText ? <p className="privacy-lead">{previewText}</p> : null}

          <p className="share-post-note">
            Open this link in Kristo App to watch, comment, and engage with your church community.
          </p>

          <div className="share-post-actions">
            <a className="share-post-btn share-post-btn-primary" href={openInAppUrl}>
              Open in Kristo App
            </a>
            <a className="share-post-btn share-post-btn-secondary" href={APP_STORE_SEARCH_URL}>
              Download on App Store
            </a>
            <a className="share-post-btn share-post-btn-secondary" href={PLAY_STORE_SEARCH_URL}>
              Get it on Google Play
            </a>
          </div>

          <p className="share-post-footnote">
            Shared link:{" "}
            <a href={post.shareUrl} className="share-post-link">
              {post.shareUrl}
            </a>
          </p>
        </div>
      </article>

      <SharePostPageStyles />
    </main>
  );
}

const SHARE_POST_PAGE_STYLES = `
.privacy-page.share-post-page {
  align-items: flex-start;
  padding-top: 48px;
  padding-bottom: 48px;
}
.share-post-page .privacy-shell {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}
.share-post-page .privacy-header {
  margin-bottom: 18px;
}
.share-post-page .privacy-title {
  margin: 8px 0 0;
  font-size: clamp(1.75rem, 4vw, 2.35rem);
  line-height: 1.15;
  color: rgba(255, 255, 255, 0.96);
}
.share-post-page .privacy-meta {
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.95rem;
}
.share-post-page .privacy-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  padding: 28px 24px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}
.share-post-page .privacy-lead {
  margin: 0 0 18px;
  font-size: 1.05rem;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.82);
  white-space: pre-wrap;
}
.share-post-media {
  margin-bottom: 18px;
}
.share-post-poster {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.35);
}
.share-post-note {
  margin: 0 0 20px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.98rem;
}
.share-post-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.share-post-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 14px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.share-post-btn:hover {
  transform: translateY(-1px);
}
.share-post-btn-primary {
  color: #111;
  background: linear-gradient(180deg, #f4d06f 0%, #d9b35f 100%);
}
.share-post-btn-secondary {
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
}
.share-post-footnote {
  margin: 18px 0 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.48);
  word-break: break-all;
}
.share-post-link {
  color: rgba(212, 175, 55, 0.95);
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (min-width: 640px) {
  .share-post-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .share-post-btn {
    flex: 1 1 180px;
  }
}
`;

function SharePostPageStyles() {
  return <style dangerouslySetInnerHTML={{ __html: SHARE_POST_PAGE_STYLES }} />;
}
