export const TERMS_SECTION_COUNT = 23;

export const TERMS_LOCALES = [
  "en",
  "fr",
  "es",
  "pt",
  "sw",
  "ha",
  "yo",
  "ar",
  "hi",
  "zh-CN",
] as const;

export type TermsLocale = (typeof TERMS_LOCALES)[number];

export type TermsSection = {
  id: number;
  title: string;
  paragraphs: string[];
};

export type TermsTranslation = {
  locale: TermsLocale;
  languageName: string;
  isRtl?: boolean;
  title: string;
  effectiveLabel: string;
  updatedLabel: string;
  effectiveDate: string;
  agreementLabel: string;
  scrollHint: string;
  continueLabel: string;
  languageModalTitle: string;
  contactSupportLabel: string;
  sections: TermsSection[];
};

export class TermsTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsTranslationError";
  }
}

export function validateTermsTranslation(translation: TermsTranslation): void {
  const locale = translation.locale || "(unknown)";
  const requiredStringFields: Array<keyof TermsTranslation> = [
    "locale",
    "languageName",
    "title",
    "effectiveLabel",
    "updatedLabel",
    "effectiveDate",
    "agreementLabel",
    "scrollHint",
    "continueLabel",
    "languageModalTitle",
    "contactSupportLabel",
  ];

  for (const field of requiredStringFields) {
    const value = translation[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new TermsTranslationError(`[${locale}] Missing or empty field: ${field}`);
    }
  }

  if (!Array.isArray(translation.sections)) {
    throw new TermsTranslationError(`[${locale}] sections must be an array`);
  }

  if (translation.sections.length !== TERMS_SECTION_COUNT) {
    throw new TermsTranslationError(
      `[${locale}] Expected ${TERMS_SECTION_COUNT} sections, got ${translation.sections.length}`
    );
  }

  const seenIds = new Set<number>();
  for (const section of translation.sections) {
    if (!section || typeof section.id !== "number") {
      throw new TermsTranslationError(`[${locale}] Each section must include a numeric id`);
    }
    if (seenIds.has(section.id)) {
      throw new TermsTranslationError(`[${locale}] Duplicate section id: ${section.id}`);
    }
    seenIds.add(section.id);

    if (typeof section.title !== "string" || !section.title.trim()) {
      throw new TermsTranslationError(`[${locale}] Section ${section.id} has an empty title`);
    }

    if (!Array.isArray(section.paragraphs) || section.paragraphs.length === 0) {
      throw new TermsTranslationError(`[${locale}] Section ${section.id} must include paragraphs`);
    }

    for (const paragraph of section.paragraphs) {
      if (typeof paragraph !== "string" || !paragraph.trim()) {
        throw new TermsTranslationError(`[${locale}] Section ${section.id} has an empty paragraph`);
      }
    }
  }

  for (let id = 1; id <= TERMS_SECTION_COUNT; id += 1) {
    if (!seenIds.has(id)) {
      throw new TermsTranslationError(`[${locale}] Missing section id ${id}`);
    }
  }
}

export function defineTermsTranslation(translation: TermsTranslation): TermsTranslation {
  validateTermsTranslation(translation);
  return translation;
}
