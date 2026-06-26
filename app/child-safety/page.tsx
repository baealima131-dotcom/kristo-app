import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Child Safety Standards | Kristo App",
  description:
    "Kristo App Child Safety Standards — our commitment to preventing child sexual abuse and exploitation (CSAE).",
};

const LAST_UPDATED = "June 25, 2026";
const CONTACT_EMAIL = "support@kristoapp.com";

export default function ChildSafetyStandardsPage() {
  return (
    <main className="vip-auth privacy-page">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <article className="privacy-shell">
        <header className="privacy-header">
          <p className="vip-kicker">Kristo App</p>
          <h1 className="privacy-title">Child Safety Standards</h1>
          <p className="privacy-meta">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="privacy-card">
          <p className="privacy-lead">
            Kristo App is committed to protecting children and preventing child sexual abuse and
            exploitation (CSAE) on our platform. These Child Safety Standards apply to all users of
            the Kristo App mobile application and related services.
          </p>

          <p className="privacy-contact-block">
            <strong>Child safety contact:</strong>{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <br />
            <span className="privacy-contact-note">
              For Google Play CSAE notices and child safety inquiries.
            </span>
          </p>

          <section className="privacy-section">
            <h2>Our commitment</h2>
            <p>
              Kristo App <strong>prohibits all forms of child sexual abuse and exploitation (CSAE)</strong>,
              including:
            </p>
            <ul>
              <li>Child sexual abuse material (CSAM)</li>
              <li>Grooming, solicitation, or sexualization of minors</li>
              <li>Sharing, requesting, or distributing content that exploits or endangers children</li>
              <li>
                Using Kristo App to facilitate contact with minors for abusive or exploitative purposes
              </li>
              <li>
                Impersonation or misrepresentation involving minors in a sexual or exploitative context
              </li>
            </ul>
            <p>
              We have zero tolerance for CSAE. Violations result in immediate content removal, account
              suspension or permanent ban, and reporting to appropriate authorities where required by law.
            </p>
          </section>

          <section className="privacy-section">
            <h2>User reporting</h2>
            <p>Kristo App provides in-app mechanisms for users to report harmful content and behavior:</p>
            <ul>
              <li>
                <strong>Feed posts and media</strong> — report from the post menu; reports are reviewed
                by church pastors and trusted media hosts in Media Studio → Reports
              </li>
              <li>
                <strong>Messages and users</strong> — report users from message thread menus
              </li>
              <li>
                <strong>Kristo Guide</strong> — in-app rules and safety guidance under More → Kristo
                Guide
              </li>
            </ul>
            <p>
              Users may also report CSAE concerns by email to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Include relevant details (content
              type, user or post identifier, church context if applicable) so we can investigate
              promptly.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Moderation and enforcement</h2>
            <p>When we receive reports or otherwise obtain knowledge of potential CSAE or CSAM:</p>
            <ol className="privacy-steps">
              <li>We prioritize review of high-risk reports, including sexual content involving minors</li>
              <li>We remove violating content and restrict access where appropriate</li>
              <li>We suspend or permanently terminate accounts involved in CSAE or CSAM</li>
              <li>
                We preserve evidence as needed for investigation, legal compliance, and cooperation with
                law enforcement
              </li>
              <li>
                We do not allow re-registration by users banned for CSAE violations where technically
                feasible
              </li>
            </ol>
            <p>
              Church pastors and designated trusted hosts may review media reports within their church
              context. Kristo App retains authority to enforce these standards globally, including
              actions beyond individual church moderation.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Child sexual abuse material (CSAM)</h2>
            <p>Kristo App does not permit CSAM on its platform. Upon obtaining actual knowledge of CSAM:</p>
            <ul>
              <li>We remove the material promptly</li>
              <li>We disable the responsible account(s)</li>
              <li>
                We report confirmed CSAM to the{" "}
                <strong>National Center for Missing &amp; Exploited Children (NCMEC)</strong> via
                CyberTipline, or to the <strong>relevant regional authority</strong> where applicable,
                in accordance with law
              </li>
              <li>
                We cooperate with law enforcement and authorized child protection organizations in
                investigations
              </li>
            </ul>
          </section>

          <section className="privacy-section">
            <h2>Cooperation with law enforcement</h2>
            <p>
              Kristo App cooperates with law enforcement agencies and authorized organizations
              investigating CSAE and CSAM. We respond to valid legal requests and may disclose account
              and content information as permitted or required by law to protect children and support
              investigations.
            </p>
            <p>
              For law enforcement inquiries regarding Kristo App, contact:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </section>

          <section className="privacy-section">
            <h2>Account suspension and bans</h2>
            <p>Accounts may be suspended or permanently banned for:</p>
            <ul>
              <li>Uploading, sharing, or soliciting CSAM or CSAE-related content</li>
              <li>Grooming or attempting to exploit minors</li>
              <li>Repeated or severe violations of these standards</li>
              <li>Circumventing prior enforcement actions</li>
            </ul>
            <p>
              Suspended users may lose access to church features, messaging, live streaming, and media
              tools until a review is completed or the ban is permanent.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Compliance with child safety laws</h2>
            <p>
              Kristo App complies with applicable child safety laws and regulations, including
              requirements to report confirmed CSAM to NCMEC or equivalent regional bodies. We review and
              update these standards as laws and platform requirements evolve.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Age and children on the platform</h2>
            <p>
              Kristo App is designed for church communities and their members. We do not knowingly
              permit use of the platform for CSAE. If you believe a child is at risk or that child
              safety violations have occurred on Kristo App, contact{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> immediately.
            </p>
            <p>
              See also our <Link href="/privacy">Privacy Policy</Link> and{" "}
              <Link href="/delete-account">Delete Account</Link> pages.
            </p>
          </section>

          <section className="privacy-section">
            <h2>Changes to these standards</h2>
            <p>
              We may update these Child Safety Standards from time to time. The &quot;Last updated&quot;
              date above will reflect the latest revision. Material changes will be posted on this page.
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

        .privacy-contact-block {
          margin: 0 0 28px;
          padding: 16px 18px;
          border-radius: 12px;
          border: 1px solid rgba(212, 175, 55, 0.2);
          background: rgba(212, 175, 55, 0.06);
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.82);
          font-size: 0.98rem;
        }

        .privacy-contact-note {
          color: rgba(255, 255, 255, 0.55);
          font-size: 0.92rem;
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

        .privacy-section ul,
        .privacy-steps {
          margin: 0 0 12px;
          padding-left: 1.2rem;
        }

        .privacy-section li + li,
        .privacy-steps li + li {
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
