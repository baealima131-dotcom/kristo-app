import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Kristo App",
  description: "Privacy Policy for Kristo App — how we collect, use, and protect your information.",
};

const LAST_UPDATED = "June 24, 2026";
const CONTACT_EMAIL = "support@kristoapp.com";

export default function PrivacyPolicyPage() {
  return (
    <main className="vip-auth privacy-page">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <article className="privacy-shell">
        <header className="privacy-header">
          <p className="vip-kicker">Kristo App</p>
          <h1 className="privacy-title">Privacy Policy</h1>
          <p className="privacy-meta">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="privacy-card">
          <p className="privacy-lead">
            This Privacy Policy describes how Kristo App (&quot;Kristo App,&quot; &quot;we,&quot;
            &quot;us,&quot; or &quot;our&quot;) collects, uses, and shares information when you use
            the Kristo App mobile application and related services.
          </p>

          <section className="privacy-section">
            <h2>Information we collect</h2>
            <p>We may collect the following types of information:</p>
            <ul>
              <li>
                <strong>Account information</strong> — such as your name, email address, phone
                number, profile details, and authentication credentials you provide when you create
                or manage an account.
              </li>
              <li>
                <strong>Church and ministry membership information</strong> — including your church
                affiliation, roles, ministry participation, membership status, and related church
                profile data.
              </li>
              <li>
                <strong>Content you create</strong> — posts, messages, comments, announcements,
                media uploads, and other user-generated content you share in the app.
              </li>
              <li>
                <strong>Camera and microphone data</strong> — when you grant permission, we access
                your device camera and microphone to support live streaming, video rooms, and
                related real-time features. We do not access camera or microphone in the background
                without your knowledge.
              </li>
              <li>
                <strong>Subscription and payment status</strong> — we receive subscription and
                purchase status from app stores (Apple App Store, Google Play) and our subscription
                provider (RevenueCat). We do not store full payment card numbers or complete payment
                credentials on our servers.
              </li>
              <li>
                <strong>Device and diagnostic information</strong> — such as device type, operating
                system, app version, crash logs, and performance data used to maintain security,
                prevent abuse, and improve reliability.
              </li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>How we use information</h2>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Provide, operate, and improve Kristo App features and services.</li>
              <li>Authenticate users and manage church, ministry, and community access.</li>
              <li>Enable messaging, media sharing, live streaming, and subscription features.</li>
              <li>Process and verify church Media Premium subscription status.</li>
              <li>Respond to support requests and communicate important service updates.</li>
              <li>Protect the safety and integrity of our platform, including fraud prevention.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>User-generated content and moderation</h2>
            <p>
              Kristo App includes user-generated content such as posts, comments, messages, and
              media. We may review, remove, or restrict content that violates our community
              standards or applicable law. Users can report content or behavior that they believe is
              harmful, abusive, or inappropriate. Reports help us investigate and take action when
              needed.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Sharing of information</h2>
            <p>We may share information:</p>
            <ul>
              <li>
                With your church community and ministry groups according to your role and the
                features you use.
              </li>
              <li>
                With service providers that help us operate the app (for example, hosting,
                analytics, subscription management, and customer support tools).
              </li>
              <li>
                With app store platforms and RevenueCat to manage in-app subscriptions and
                entitlements.
              </li>
              <li>When required by law, legal process, or to protect rights, safety, and security.</li>
            </ul>
            <p>We do not sell your personal information.</p>
          </section>

          <section className="privacy-section">
            <h2>Data retention and deletion</h2>
            <p>
              We retain information for as long as needed to provide the service, comply with legal
              obligations, resolve disputes, and enforce our policies. You may request deletion of
              your account or personal data by contacting us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will process verified
              requests in accordance with applicable law.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Children</h2>
            <p>
              Kristo App is intended for use by churches and their members. If you believe a child
              has provided personal information without appropriate consent, please contact us and
              we will take appropriate steps.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Changes to this policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will post the revised policy
              on this page and update the &quot;Last updated&quot; date above. Continued use of the
              app after changes become effective constitutes acceptance of the updated policy.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Contact us</h2>
            <p>
              If you have questions about this Privacy Policy or our data practices, contact Kristo
              App:
            </p>
            <p>
              <strong>Kristo App</strong>
              <br />
              Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </section>
        </div>

        <footer className="privacy-footer">
          <Link className="vip-link" href="/sign-in">
            ← <span>Back to sign in</span>
          </Link>
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

        .privacy-lead {
          margin: 0 0 24px;
          font-size: 1.05rem;
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.82);
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
          margin: 0;
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

        .privacy-footer {
          margin-top: 28px;
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
