import type { Metadata } from "next";
import OpenInKristoApp from "./OpenInKristoApp";
import { loadSharePostPreview } from "@/lib/sharePostPreview";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const preview = await loadSharePostPreview(id);

  const images = preview.imageUrl
    ? [
        {
          url: preview.imageUrl,
          width: 1200,
          height: 630,
          alt: preview.title,
        },
      ]
    : undefined;

  return {
    title: preview.title,
    description: preview.description,
    openGraph: {
      title: preview.title,
      description: preview.description,
      url: preview.shareUrl,
      siteName: "Kristo App",
      type: "website",
      images,
    },
    twitter: {
      card: preview.imageUrl ? "summary_large_image" : "summary",
      title: preview.title,
      description: preview.description,
      images: preview.imageUrl ? [preview.imageUrl] : undefined,
    },
    alternates: {
      canonical: preview.shareUrl,
    },
  };
}

export default async function PostSharePage({ params }: PageProps) {
  const { id } = await params;
  const preview = await loadSharePostPreview(id);

  return (
    <main className="share-post-page">
      <div className="share-post-card">
        {preview.imageUrl ? (
          <div className="share-post-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.imageUrl} alt={preview.title} className="share-post-poster" />
          </div>
        ) : null}

        <div className="share-post-body">
          <p className="share-post-kicker">Kristo App</p>
          <h1 className="share-post-title">{preview.title}</h1>

          {preview.churchName ? (
            <p className="share-post-church">{preview.churchName}</p>
          ) : null}

          {preview.authorName ? (
            <p className="share-post-author">{preview.authorName}</p>
          ) : null}

          <p className="share-post-description">{preview.description}</p>

          <OpenInKristoApp deepLinkUrl={preview.deepLinkUrl} shareUrl={preview.shareUrl} />

          {!preview.found ? (
            <p className="share-post-note">
              This link may only be available inside the Kristo App. Tap the button above to open
              Kristo.
            </p>
          ) : null}
        </div>
      </div>

      <style>{`
        .share-post-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          background:
            radial-gradient(900px 500px at 20% 0%, rgba(120, 90, 255, 0.18), transparent 60%),
            radial-gradient(700px 420px at 80% 20%, rgba(255, 190, 80, 0.10), transparent 55%),
            #0b0f1a;
        }

        .share-post-card {
          width: min(100%, 520px);
          border-radius: 24px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        }

        .share-post-media {
          aspect-ratio: 16 / 9;
          background: #111827;
        }

        .share-post-poster {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .share-post-body {
          padding: 20px 20px 24px;
        }

        .share-post-kicker {
          margin: 0 0 8px;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.55);
        }

        .share-post-title {
          margin: 0 0 10px;
          font-size: 24px;
          line-height: 1.2;
          color: #fff;
        }

        .share-post-church,
        .share-post-author {
          margin: 0 0 6px;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.72);
        }

        .share-post-description {
          margin: 12px 0 20px;
          font-size: 15px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.82);
        }

        .share-post-open-btn {
          appearance: none;
          border: 0;
          border-radius: 999px;
          padding: 14px 22px;
          width: 100%;
          font-size: 16px;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          background: linear-gradient(135deg, #7c5cff 0%, #5b8dff 100%);
          box-shadow: 0 10px 30px rgba(92, 120, 255, 0.35);
        }

        .share-post-open-btn:active {
          transform: translateY(1px);
        }

        .share-post-note {
          margin: 14px 0 0;
          font-size: 13px;
          line-height: 1.45;
          color: rgba(255, 255, 255, 0.55);
        }
      `}</style>
    </main>
  );
}
