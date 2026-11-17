import { ar } from "./ar";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ha } from "./ha";
import { hi } from "./hi";
import { pt } from "./pt";
import { sw } from "./sw";
import { yo } from "./yo";
import { zhCN } from "./zh-CN";
import { TERMS_SUMMARIES, TERMS_SUMMARY_POINT_COUNT, type TermsSummary } from "./summary";
import {
  TERMS_LOCALES,
  type TermsLocale,
  type TermsTranslation,
  validateTermsTranslation,
} from "./types";

export { TERMS_LOCALES, TERMS_SECTION_COUNT, validateTermsTranslation } from "./types";
export type { TermsLocale, TermsSection, TermsTranslation } from "./types";
export type { TermsSummary, TermsSummaryPoint } from "./summary";

const TERMS_BY_LOCALE: Record<TermsLocale, TermsTranslation> = {
  en,
  fr,
  es,
  pt,
  sw,
  ha,
  yo,
  ar,
  hi,
  "zh-CN": zhCN,
};

for (const locale of TERMS_LOCALES) {
  validateTermsTranslation(TERMS_BY_LOCALE[locale]);
  const summary = TERMS_SUMMARIES[locale];
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (
    !summary ||
    !filled(summary.intro) ||
    !filled(summary.readFullTermsLabel) ||
    !filled(summary.closeLabel) ||
    summary.points.length !== TERMS_SUMMARY_POINT_COUNT ||
    summary.points.some((point) => !filled(point.title) || !filled(point.text))
  ) {
    throw new Error(`[${locale}] Incomplete terms summary`);
  }
}

export const TERMS_LANGUAGE_OPTIONS = TERMS_LOCALES.map((locale) => ({
  locale,
  languageName: TERMS_BY_LOCALE[locale].languageName,
}));

export function getTermsTranslation(locale: TermsLocale): TermsTranslation {
  return TERMS_BY_LOCALE[locale];
}

/** Short pre-acceptance summary; the full terms stay in getTermsTranslation(). */
export function getTermsSummary(locale: TermsLocale): TermsSummary {
  return TERMS_SUMMARIES[locale];
}

export const DEFAULT_TERMS_LOCALE: TermsLocale = "en";
