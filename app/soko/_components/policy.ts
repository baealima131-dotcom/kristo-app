import { sokoPolicyDocuments, type SokoPolicyDocumentId } from "@/app/api/_lib/sokoLegalPolicy";

export function getSokoPolicy(id: SokoPolicyDocumentId) {
  const document = sokoPolicyDocuments().find((item) => item.id === id);
  if (!document) throw new Error(`Missing SOKO policy document: ${id}`);
  return document;
}

