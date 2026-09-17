import type { Metadata } from "next";
import { getSokoPolicy } from "../_components/policy";
import { PolicyDocument, SokoLegalPage } from "../_components/SokoLegalPage";
export const metadata: Metadata = { title: "Privacy Policy | SOKO" };
export default function Page() { const doc = getSokoPolicy("privacy"); return <SokoLegalPage title={doc.title} lead={doc.summary} version={doc.version}><PolicyDocument body={doc.body} /></SokoLegalPage>; }

