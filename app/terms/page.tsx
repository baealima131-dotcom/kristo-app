import type { Metadata } from "next";
import Link from "next/link";
import { en } from "../../apps/mobile/src/content/terms/en";

export const metadata: Metadata = {
  title: "Terms of Use | Kristo App",
  description:
    "Terms of Use and Community Guidelines for Kristo App, including church, media, and SOKO features.",
};

const LAST_UPDATED = "November 22, 2026";

export default function TermsOfUsePage() {
  return (
    <main className="legal-page">
      <article className="legal-shell">
        <header className="legal-header">
          <Link className="legal-brand" href="/">Kristo App</Link>
          <h1>{en.title}</h1>
          <p className="legal-meta">Last updated: {LAST_UPDATED}</p>
          <p className="legal-meta">Terms effective: {en.effectiveDate}</p>
        </header>

        <div className="legal-card">
          {en.sections.map((section) => (
            <section key={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.id}-${index}`}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>

        <footer className="legal-footer">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/support">Support</Link>
        </footer>
      </article>

      <style>{`
        .legal-page { min-height: 100vh; padding: 48px 20px 64px; background: #080b12; color: #f7f8fc; }
        .legal-shell { position: relative; width: 100%; max-width: 800px; margin: 0 auto; }
        .legal-header { margin: 0 0 24px; }
        .legal-brand, .legal-footer a { color: #f1cf70; text-decoration: none; }
        .legal-header h1 { margin: 12px 0 8px; font-size: clamp(2rem, 5vw, 2.7rem); line-height: 1.1; letter-spacing: -.03em; }
        .legal-meta { margin: 0 0 4px; color: #aeb5c4; }
        .legal-card { padding: 28px; border: 1px solid #283041; border-radius: 20px; background: #111722; line-height: 1.72; color: #d7dce6; }
        .legal-card section { margin-top: 26px; }
        .legal-card section:first-child { margin-top: 0; }
        .legal-card h2 { margin: 0 0 8px; color: #fff; font-size: 1.08rem; }
        .legal-card p { margin: 0 0 12px; }
        .legal-card p:last-child { margin-bottom: 0; }
        .legal-footer { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 24px; }
        @media (max-width: 560px) { .legal-page { padding: 32px 16px 48px; } .legal-card { padding: 22px 18px; } }
      `}</style>
    </main>
  );
}
