import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./SokoLegalPage.module.css";

export const SOKO_SUPPORT_EMAIL = "farijiprince73@gmail.com";

export function SokoLegalPage({
  eyebrow = "SOKO legal",
  title,
  lead,
  version,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead: string;
  version?: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <nav className={styles.nav} aria-label="SOKO legal navigation">
          <Link className={styles.brand} href="/soko/legal">SOKO</Link>
          <Link className={styles.navLink} href="/soko/support">Support</Link>
        </nav>
        <header>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.lead}>{lead}</p>
          {version ? <p className={styles.meta}>Current version: {version}</p> : null}
        </header>
        {children}
        <footer className={styles.footer}>
          SOKO is part of the Kristo ecosystem. These public pages can be read without signing in.
        </footer>
      </article>
    </main>
  );
}

export function PolicyDocument({ body }: { body: string }) {
  return (
    <div className={styles.document}>
      {body.split(/\n\n+/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <div className={styles.actions}>
        <Link className={styles.buttonSecondary} href="/soko/legal">All policies</Link>
        <Link className={styles.button} href="/soko/support">
          <span className={styles.buttonLabel}>Contact support</span>
        </Link>
      </div>
    </div>
  );
}

export { styles as sokoLegalStyles };
