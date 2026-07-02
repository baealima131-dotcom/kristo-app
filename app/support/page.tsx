import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Kristo App Support",
  description:
    "Get help with Kristo App — contact support, report problems, and find answers to common questions.",
};

const SUPPORT_EMAIL = "farijiprince73@gmail.com";

const FAQ_ITEMS = [
  {
    question: "I can't log in.",
    answer:
      "Verify your email and password, then try again. If the issue continues, contact support.",
  },
  {
    question: "Subscription isn't working.",
    answer:
      "Restore purchases from the Media Premium screen or contact support.",
  },
  {
    question: "How do I join a church?",
    answer: "Create an account, search for a church, then request membership.",
  },
] as const;

export default function SupportPage() {
  return (
    <main className="vip-auth privacy-page">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <article className="privacy-shell">
        <header className="privacy-header">
          <p className="vip-kicker">Kristo App</p>
          <h1 className="privacy-title">Kristo App Support</h1>
          <p className="privacy-subtitle">Need help? We&apos;re here to assist you.</p>
        </header>

        <div className="privacy-card">
          <section className="privacy-section">
            <h2>Contact Support</h2>
            <p>
              Email us and we&apos;ll get back to you as soon as we can.
            </p>
            <p className="privacy-contact-block">
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </section>

          <section className="privacy-section">
            <h2>Report a Problem</h2>
            <p>
              If something isn&apos;t working as expected, email us at{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with a short description of
              the issue and screenshots if you have them. Include your device type (iPhone or
              Android) and the screen where the problem occurred so we can help faster.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Frequently Asked Questions</h2>
            <dl className="support-faq">
              {FAQ_ITEMS.map((item) => (
                <div key={item.question} className="support-faq-item">
                  <dt>{item.question}</dt>
                  <dd>{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="privacy-section">
            <h2>Response Time</h2>
            <p>We normally respond within 24–48 hours.</p>
          </section>
        </div>

        <footer className="support-footer">
          <nav className="support-footer-nav" aria-label="Legal">
            <Link className="vip-link" href="/privacy">
              <span>Privacy Policy</span>
            </Link>
            <Link className="vip-link" href="/terms">
              <span>Terms of Use</span>
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

        .privacy-subtitle {
          margin: 0;
          font-size: 1.05rem;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.72);
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

        .privacy-section p {
          margin: 0 0 12px;
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.76);
          font-size: 0.98rem;
        }

        .privacy-section a {
          color: rgba(212, 175, 55, 0.95);
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .privacy-contact-block {
          margin: 0;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1px solid rgba(255, 220, 140, 0.18);
          background: rgba(0, 0, 0, 0.22);
          font-size: 1rem;
          font-weight: 600;
        }

        .privacy-contact-block a {
          text-decoration: none;
          color: rgba(255, 215, 130, 0.95);
        }

        .privacy-contact-block a:hover {
          text-decoration: underline;
        }

        .support-faq {
          margin: 0;
          padding: 0;
        }

        .support-faq-item {
          margin-bottom: 18px;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .support-faq-item:last-child {
          margin-bottom: 0;
          padding-bottom: 0;
          border-bottom: none;
        }

        .support-faq dt {
          margin: 0 0 6px;
          font-weight: 700;
          color: rgba(255, 215, 130, 0.92);
          font-size: 0.98rem;
        }

        .support-faq dd {
          margin: 0;
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.76);
          font-size: 0.98rem;
        }

        .support-footer {
          margin-top: 28px;
        }

        .support-footer-nav {
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
