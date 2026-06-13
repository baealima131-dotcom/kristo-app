"use client";

type Props = {
  deepLinkUrl: string;
  shareUrl: string;
};

export default function OpenInKristoApp({ deepLinkUrl, shareUrl }: Props) {
  const handleOpen = () => {
    if (typeof window === "undefined") return;

    const target = String(deepLinkUrl || shareUrl || "").trim();
    if (!target) return;

    window.location.href = target;
  };

  return (
    <button type="button" onClick={handleOpen} className="share-post-open-btn">
      Open in Kristo App
    </button>
  );
}
