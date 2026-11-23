import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Kristo App | Christian video and church community",
  description:
    "Discover faith-based videos, church media, and Christian communities with Kristo App.",
};

const APPLE_APP_URL = "https://apps.apple.com/us/app/kristo-app/id6799130865";
const GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.princefariji.kristoapp.free";

export default function HomePage() {
  return (
    <main className="home-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Kristo App home">
          <Image src="/kristo-app-icon.png" alt="" className="brand-icon" width={1024} height={1024} priority />
          <span>Kristo App</span>
        </Link>
        <nav className="header-nav" aria-label="Main navigation">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
          <Link className="sign-in-link" href="/sign-in">Sign in</Link>
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Faith. Community. Media.</p>
          <h1 id="hero-title">A place to discover and share Christian media.</h1>
          <p className="hero-description">
            Kristo App brings faith-based videos, church media, and Christian communities
            together in one place. Discover content, watch, and stay connected with churches and
            ministries.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/sign-in">Open Kristo App</Link>
            <a className="store-link" href={APPLE_APP_URL} target="_blank" rel="noreferrer">
              App Store
            </a>
            <a className="store-link" href={GOOGLE_PLAY_URL} target="_blank" rel="noreferrer">
              Google Play
            </a>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="icon-frame">
            <Image src="/kristo-app-icon.png" alt="" className="hero-icon" width={1024} height={1024} priority />
          </div>
          <div className="art-glow" />
        </div>
      </section>

      <section className="features" aria-label="About Kristo App">
        <article className="feature-card">
          <span className="feature-number">01</span>
          <h2>Discover faith-based videos</h2>
          <p>Explore Christian video content and media shared by the Kristo App community.</p>
        </article>
        <article className="feature-card">
          <span className="feature-number">02</span>
          <h2>Find church communities</h2>
          <p>View church profiles, ministries, and media to stay connected with local communities.</p>
        </article>
        <article className="feature-card">
          <span className="feature-number">03</span>
          <h2>Share and connect</h2>
          <p>Share posts and media, take part in community conversations, and keep in touch.</p>
        </article>
      </section>

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} Kristo App</span>
        <nav aria-label="Legal and support links">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
          <Link href="/support">Support</Link>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </footer>

      <style>{`
        .home-page { min-height: 100vh; padding: 0 6vw; overflow: hidden; color: #f8f8fb; background: radial-gradient(ellipse at 74% 18%, rgba(105, 75, 164, .2), transparent 35%), #080b12; }
        .site-header { min-height: 86px; max-width: 1240px; margin: auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid rgba(255,255,255,.09); }
        .brand { display: inline-flex; align-items: center; gap: 11px; color: #fff; text-decoration: none; font-size: 1.12rem; font-weight: 800; letter-spacing: -.02em; }
        .brand-icon { width: 38px; height: 38px; object-fit: cover; border-radius: 11px; }
        .header-nav, .site-footer nav { display: flex; align-items: center; gap: clamp(14px, 2.5vw, 30px); }
        .header-nav a, .site-footer a { color: #c8ccd7; text-decoration: none; font-size: .92rem; }
        .header-nav a:hover, .site-footer a:hover { color: #f5d47a; }
        .header-nav .sign-in-link { padding: 10px 16px; border: 1px solid rgba(245,212,122,.48); border-radius: 999px; color: #f5d47a; }
        .hero { max-width: 1240px; min-height: 510px; margin: auto; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, .8fr); align-items: center; gap: 5vw; padding: 64px 0 70px; }
        .hero-copy { max-width: 700px; }
        .eyebrow { margin: 0 0 18px; color: #f5d47a; font-size: .78rem; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; }
        .hero h1 { max-width: 760px; margin: 0; font-size: clamp(2.7rem, 6vw, 5.4rem); line-height: .99; letter-spacing: -.055em; }
        .hero-description { max-width: 620px; margin: 24px 0 0; color: #b9bfcd; font-size: clamp(1rem, 1.5vw, 1.15rem); line-height: 1.75; }
        .hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 22px; margin-top: 30px; }
        .primary-button { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 22px; border-radius: 999px; background: #f3d579; color: #17130a; font-weight: 800; text-decoration: none; }
        .store-link { color: #e7e9ef; text-decoration-color: rgba(245,212,122,.65); text-underline-offset: 5px; }
        .hero-art { position: relative; display: grid; place-items: center; min-height: 390px; }
        .icon-frame { z-index: 1; width: min(82%, 330px); aspect-ratio: 1; padding: 12px; border-radius: 30%; background: linear-gradient(145deg, rgba(255,255,255,.15), rgba(255,255,255,.025)); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 35px 100px rgba(0,0,0,.55); transform: rotate(3deg); }
        .hero-icon { width: 100%; height: 100%; object-fit: cover; border-radius: 24%; }
        .art-glow { position: absolute; width: 90%; aspect-ratio: 1; border-radius: 50%; background: #7253b6; filter: blur(95px); opacity: .27; }
        .features { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; padding: 0 0 66px; }
        .feature-card { padding: 24px 25px 28px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: rgba(255,255,255,.035); }
        .feature-number { color: #f5d47a; font-size: .78rem; font-weight: 800; letter-spacing: .14em; }
        .feature-card h2 { margin: 15px 0 9px; font-size: 1.12rem; }
        .feature-card p { margin: 0; color: #b9bfcd; font-size: .94rem; line-height: 1.65; }
        .site-footer { max-width: 1240px; min-height: 76px; margin: auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px solid rgba(255,255,255,.09); color: #858d9c; font-size: .85rem; }
        @media (max-width: 760px) { .home-page { padding: 0 20px; } .site-header { min-height: 74px; } .header-nav { gap: 14px; } .header-nav a { font-size: .8rem; } .hero { grid-template-columns: 1fr; gap: 10px; padding: 56px 0 46px; } .hero-art { grid-row: 1; min-height: 230px; } .icon-frame { width: min(48vw, 210px); border-radius: 27%; } .hero h1 { font-size: clamp(2.55rem, 12vw, 4rem); } .features { grid-template-columns: 1fr; padding-bottom: 42px; } .site-footer { align-items: flex-start; flex-direction: column; justify-content: center; padding: 22px 0; } .site-footer nav { flex-wrap: wrap; gap: 12px 20px; } }
        @media (max-width: 440px) { .brand { font-size: 1rem; } .brand-icon { width: 32px; height: 32px; } .header-nav { gap: 10px; } .header-nav a { font-size: .75rem; } .header-nav .sign-in-link { padding: 8px 11px; } }
      `}</style>
    </main>
  );
}
