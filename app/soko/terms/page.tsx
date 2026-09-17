import type { Metadata } from "next";
import { getSokoPolicy } from "../_components/policy";
import { PolicyDocument, SokoLegalPage } from "../_components/SokoLegalPage";
export const metadata: Metadata = { title: "Terms of Use | SOKO" };
export default function Page() { const doc = getSokoPolicy("terms"); return <SokoLegalPage title={doc.title} lead={doc.summary} version={doc.version}><PolicyDocument body={doc.body} /></SokoLegalPage>; }

