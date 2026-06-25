import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Delete Account | Kristo App",
  description:
    "How to delete your Kristo App account — in-app steps and email support options.",
};

const LAST_UPDATED = "June 25, 2026";
const CONTACT_EMAIL = "support@kristoapp.com";

export default function DeleteAccountPage() {
  return (
    <main className="vip-auth legal-page">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <article className="legal-shell">
        <header className="legal-header">
          <p className="vip-kicker">Kristo App</p>
          <h1 className="legal-title">Delete Account</h1>
          <p className="legal-meta">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="legal-card">
          <p className="legal-lead">
            This page explains how to delete your Kristo App account and what happens to your data.
            Account deletion is permanent and cannot be undone once processing is complete.
          </p>

          <section className="legal-section">
            <h2>Delete your account in the app</h2>
            <p>You can delete your account directly from the Kristo App mobile application:</p>
            <ol className="legal-steps">
              <li>Open the app and go to <strong>Profile / Me</strong>.</li>
              <li>Tap <strong>Settings</strong>.</li>
              <li>Select <strong>Delete Account</strong> and follow the on-screen prompts.</li>
            </ol>
            <p>
              You may be asked to confirm your identity before deletion begins. Once confirmed, your
              account will be scheduled for removal according to our deletion process below.
            </p>
          </section>

          <section className="legal-section">
            <h2>Request deletion by email</h2>
            <p>
              If you cannot access the app or prefer to request deletion by email, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Please include the email
              address or phone number associated with your account so we can verify your request.
            </p>
          </section>

          <section className="legal-section">
            <h2>What data is deleted</h2>
            <p>When your account is deleted, we remove or de-identify data linked to your account, which may include:</p>
            <ul>
              <li>Account profile information</li>
              <li>Authentication and login credentials</li>
              <li>Posts, comments, and messages</li>
              <li>Church and ministry membership data tied to your account</li>
              <li>Uploaded media and other content you created</li>
              <li>App activity and usage records associated with your account</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>Data we may retain</h2>
            <p>
              Some information may be retained after account deletion when required or permitted by
              law, including for:
            </p>
            <ul>
              <li>Legal and regulatory compliance</li>
              <li>Security, abuse prevention, and fraud investigation</li>
              <li>Dispute resolution and enforcement of our terms</li>
              <li>Subscription and payment records managed through app stores or payment providers</li>
              <li>Limited backup retention until those backups are rotated or purged</li>
            </ul>
            <p>
              Retained data is kept only as long as necessary for these purposes and is not used for
              marketing or to restore your account.
            </p>
          </section>

          <section className="legal-section">
            <h2>Processing time</h2>
            <p>
              Deletion requests are usually processed within <strong>30 days</strong> after we verify
              your identity and confirm the request. You may receive a confirmation email when
              deletion is complete.
            </p>
          </section>

          <section className="legal-section">
            <h2>Questions</h2>
            <p>
              For help with account deletion or questions about your data, contact Kristo App at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. You can also review our{" "}
              <Link href="/privacy">Privacy Policy</Link> for more information about how we handle
              personal data.
            </p>
          </section>
        </div>

        <footer className="legal-footer">
          <Link className="vip-link" href="/sign-in">
            ← <span>Back to sign in</span>
          </Link>
        </footer>
      </article>

      <style>{`
        .legal-page {
          align-items: flex-start;
          padding-top: 48px;
          padding-bottom: 64px;
        }

        .legal-shell {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 760px;
          margin: 0 auto;
          padding: 0 20px;
        }

        .legal-header {
          margin-bottom: 24px;
        }

        .legal-title {
          margin: 8px 0 10px;
          font-size: clamp(2rem, 5vw, 2.6rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          color: rgba(255, 255, 255, 0.96);
        }

        .legal-meta {
          margin: 0;
          color: rgba(255, 255, 255, 0.55);
          font-size: 0.95rem;
        }

        .legal-card {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(12px);
          padding: 28px 24px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        }

        .legal-lead {
          margin: 0 0 24px;
          font-size: 1.05rem;
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.82);
        }

        .legal-section {
          margin-bottom: 28px;
        }

        .legal-section:last-child {
          margin-bottom: 0;
        }

        .legal-section h2 {
          margin: 0 0 12px;
          font-size: 1.15rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.94);
        }

        .legal-section p,
        .legal-section li {
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.76);
          font-size: 0.98rem;
        }

        .legal-section p {
          margin: 0 0 12px;
        }

        .legal-section ul,
        .legal-steps {
          margin: 0 0 12px;
          padding-left: 1.2rem;
        }

        .legal-section li + li,
        .legal-steps li + li {
          margin-top: 10px;
        }

        .legal-section a {
          color: rgba(212, 175, 55, 0.95);
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .legal-footer {
          margin-top: 28px;
        }

        @media (min-width: 768px) {
          .legal-card {
            padding: 36px 32px;
          }
        }
      `}</style>
    </main>
  );
}
