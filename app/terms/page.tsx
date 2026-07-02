import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use | Kristo App",
  description:
    "Terms of Use for Kristo App — Apple Standard EULA, subscription terms, and related policies.",
};

const APPLE_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const LAST_UPDATED = "June 24, 2026";

export default function TermsOfUsePage() {
  return (
    <main className="vip-auth privacy-page">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <article className="privacy-shell">
        <header className="privacy-header">
          <p className="vip-kicker">Kristo App</p>
          <h1 className="privacy-title">Terms of Use</h1>
          <p className="privacy-meta">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="privacy-card">
          <section className="privacy-section">
            <h2>License agreement</h2>
            <p>
              Kristo App is licensed to you under Apple&apos;s Standard End User License
              Agreement (EULA). By downloading or using Kristo App on an Apple device, you agree
              to the terms of that agreement.
            </p>
            <p>
              <a href={APPLE_EULA_URL} target="_blank" rel="noopener noreferrer">
                Apple Standard EULA
              </a>
            </p>
          </section>

          <section className="privacy-section">
            <h2>Subscriptions</h2>
            <p>
              Kristo App offers optional in-app subscriptions for church Media Premium features.
              Subscription options include:
            </p>
            <ul>
              <li>
                <strong>Kristo Premium Monthly</strong> — $49.99 per month
              </li>
              <li>
                <strong>Kristo Premium Yearly</strong> — $499.99 per year
              </li>
            </ul>
            <p>
              Subscriptions automatically renew unless canceled at least 24 hours before the end of
              the current billing period. Payment is charged to your Apple ID account at
              confirmation of purchase and upon each renewal.
            </p>
            <p>
              You can manage or cancel subscriptions at any time in your device&apos;s{" "}
              <strong>Settings → Apple ID → Subscriptions</strong>.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Related policies</h2>
            <p>
              For information about how we handle your data, see our{" "}
              <Link href="/privacy">Privacy Policy</Link>. For help with the app or your
              subscription, visit <Link href="/support">Kristo App Support</Link>.
            </p>
          </section>
        </div>

        <footer className="terms-footer">
          <nav className="terms-footer-nav" aria-label="Legal and support">
            <Link className="vip-link" href="/privacy">
              <span>Privacy Policy</span>
            </Link>
            <Link className="vip-link" href="/support">
              <span>Support</span>
            </Link>
          </nav>
        </footer>
      </article>

      <style>{`
        .privacy-page {
          align-items: flex-start;
          padding-top: 48px;
          padding-bottom: 64px;
        }

        .privacy-shell {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 760px;
          margin: 0 auto;
          padding: 0 20px;
        }

        .privacy-header {
          margin-bottom: 24px;
        }

        .privacy-title {
          margin: 8px 0 10px;
          font-size: clamp(2rem, 5vw, 2.6rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          color: rgba(255, 255, 255, 0.96);
        }

        .privacy-meta {
          margin: 0;
          color: rgba(255, 255, 255, 0.55);
          font-size: 0.95rem;
        }

        .privacy-card {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(12px);
          padding: 28px 24px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        }

        .privacy-section {
          margin-bottom: 28px;
        }

        .privacy-section:last-child {
          margin-bottom: 0;
        }

        .privacy-section h2 {
          margin: 0 0 12px;
          font-size: 1.15rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.94);
        }

        .privacy-section p,
        .privacy-section li {
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.76);
          font-size: 0.98rem;
        }

        .privacy-section p {
          margin: 0 0 12px;
        }

        .privacy-section ul {
          margin: 0 0 12px;
          padding-left: 1.2rem;
        }

        .privacy-section li + li {
          margin-top: 10px;
        }

        .privacy-section a {
          color: rgba(212, 175, 55, 0.95);
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .terms-footer {
          margin-top: 28px;
        }

        .terms-footer-nav {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        @media (min-width: 768px) {
          .privacy-card {
            padding: 36px 32px;
          }
        }
      `}</style>
    </main>
  );
}
