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
import {
  TERMS_LOCALES,
  type TermsLocale,
  type TermsTranslation,
  validateTermsTranslation,
} from "./types";

export { TERMS_LOCALES, TERMS_SECTION_COUNT, validateTermsTranslation } from "./types";
export type { TermsLocale, TermsSection, TermsTranslation } from "./types";

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
}

export const TERMS_LANGUAGE_OPTIONS = TERMS_LOCALES.map((locale) => ({
  locale,
  languageName: TERMS_BY_LOCALE[locale].languageName,
}));

export function getTermsTranslation(locale: TermsLocale): TermsTranslation {
  return TERMS_BY_LOCALE[locale];
}

export const DEFAULT_TERMS_LOCALE: TermsLocale = "en";
