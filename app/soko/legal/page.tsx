import type { Metadata } from "next";
import Link from "next/link";

import { sokoPolicyDocuments } from "@/app/api/_lib/sokoLegalPolicy";
import { SokoLegalPage, sokoLegalStyles as styles } from "../_components/SokoLegalPage";

export const metadata: Metadata = { title: "Legal & Safety | SOKO", description: "Public policies, safety information, support, and account-deletion help for SOKO." };

const links = { terms: "/soko/terms", privacy: "/soko/privacy", marketplace_rules: "/soko/marketplace-rules", safety: "/soko/safety" } as const;

export default function SokoLegalHub() {
  return (
    <SokoLegalPage title="Legal & safety" lead="Read the policies that apply when you browse, buy, sell, message, pay, arrange delivery, or report a listing on SOKO.">
      <div className={styles.notice}>SOKO connects buyers with independent sellers. Policy documents shown here are the same versioned documents delivered inside the SOKO app.</div>
      <div className={styles.grid}>
        {sokoPolicyDocuments().map((doc) => <Link className={styles.card} href={links[doc.id]} key={doc.id}><h2>{doc.title}</h2><p>{doc.summary}</p><span>Read version {doc.version} →</span></Link>)}
        <Link className={styles.card} href="/soko/buyer-protection"><h2>Buyer Protection</h2><p>How cancellation, return, dispute, evidence, and external-refund recommendations currently work.</p><span>Learn more →</span></Link>
        <Link className={styles.card} href="/soko/support"><h2>Support</h2><p>Get help with access, listings, orders, payments, safety reports, or technical problems.</p><span>Get support →</span></Link>
        <Link className={styles.card} href="/soko/delete-account"><h2>Account deletion</h2><p>Learn how to request deletion of the Kristo identity used by SOKO.</p><span>View instructions →</span></Link>
      </div>
    </SokoLegalPage>
  );
}

