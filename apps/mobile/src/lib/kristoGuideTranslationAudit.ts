import type { GuideContent, GuideLanguageCode } from "./kristoGuideContent";

/** Max share of strings that may match a fallback language before hiding the chip. */
export const GUIDE_TRANSLATION_COPY_THRESHOLD = 0.2;

/** Languages that must not reuse another locale's body copy (App Review issue). */
const FALLBACK_REFERENCE_LANGUAGES: GuideLanguageCode[] = ["en", "sw"];

/** Languages that must pass the fallback audit in dev/CI builds. */
const STRICT_AUDIT_LANGUAGE_CODES: GuideLanguageCode[] = ["ln", "rw"];

export type GuideTranslationAuditResult = {
  code: GuideLanguageCode;
  selectable: boolean;
  maxCopyRatio: number;
  copiedFrom?: GuideLanguageCode;
  reason?: string;
};

function alignedCopyRatio(target: GuideContent, reference: GuideContent): number {
  let copied = 0;
  let total = 0;

  const metaKeys = [
    "pageTitle",
    "pageSubtitle",
    "languageLabel",
    "updatedLabel",
    "faqTitle",
  ] as const;

  for (const key of metaKeys) {
    total += 1;
    if (target[key] === reference[key]) copied += 1;
  }

  for (const section of target.sections) {
    const refSection = reference.sections.find((s) => s.id === section.id);
    if (!refSection) continue;

    total += 1;
    if (section.title === refSection.title) copied += 1;

    for (let i = 0; i < section.bullets.length; i += 1) {
      total += 1;
      if (refSection.bullets[i] && section.bullets[i] === refSection.bullets[i]) {
        copied += 1;
      }
    }
  }

  for (let i = 0; i < target.faq.length; i += 1) {
    total += 2;
    const refFaq = reference.faq[i];
    if (!refFaq) continue;
    if (target.faq[i].question === refFaq.question) copied += 1;
    if (target.faq[i].answer === refFaq.answer) copied += 1;
  }

  return total === 0 ? 0 : copied / total;
}

function maxFallbackCopyRatio(
  code: GuideLanguageCode,
  content: GuideContent,
  all: Record<GuideLanguageCode, GuideContent>
): { ratio: number; copiedFrom?: GuideLanguageCode } {
  let maxCopyRatio = 0;
  let copiedFrom: GuideLanguageCode | undefined;

  for (const refCode of FALLBACK_REFERENCE_LANGUAGES) {
    if (refCode === code) continue;
    const ratio = alignedCopyRatio(content, all[refCode]);
    if (ratio > maxCopyRatio) {
      maxCopyRatio = ratio;
      copiedFrom = refCode;
    }
  }

  return { ratio: maxCopyRatio, copiedFrom };
}

export function auditGuideLanguageTranslation(
  code: GuideLanguageCode,
  content: GuideContent,
  all: Record<GuideLanguageCode, GuideContent>
): GuideTranslationAuditResult {
  if (code === "en" || code === "sw") {
    return { code, selectable: true, maxCopyRatio: 0 };
  }

  if (content.translationFallbackNote) {
    return {
      code,
      selectable: true,
      maxCopyRatio: 1,
      reason: "Explicit V1 fallback banner",
    };
  }

  const { ratio: maxCopyRatio, copiedFrom } = maxFallbackCopyRatio(code, content, all);
  const selectable = maxCopyRatio <= GUIDE_TRANSLATION_COPY_THRESHOLD;

  return {
    code,
    selectable,
    maxCopyRatio,
    copiedFrom,
    reason: selectable
      ? undefined
      : `More than ${Math.round(GUIDE_TRANSLATION_COPY_THRESHOLD * 100)}% matches fallback ${copiedFrom ?? "language"}`,
  };
}

export function auditAllGuideTranslations(
  all: Record<GuideLanguageCode, GuideContent>
): GuideTranslationAuditResult[] {
  return (Object.keys(all) as GuideLanguageCode[]).map((code) =>
    auditGuideLanguageTranslation(code, all[code], all)
  );
}

export function assertGuideTranslationsComplete(
  all: Record<GuideLanguageCode, GuideContent>
): void {
  const failures = STRICT_AUDIT_LANGUAGE_CODES.flatMap((code) => {
    const content = all[code];
    return FALLBACK_REFERENCE_LANGUAGES.filter((refCode) => refCode !== code).flatMap(
      (refCode) => {
        const ratio = alignedCopyRatio(content, all[refCode]);
        if (ratio <= GUIDE_TRANSLATION_COPY_THRESHOLD) return [];
        return [{ code, refCode, ratio }];
      }
    );
  });

  if (failures.length === 0) return;

  const lines = failures.map(
    (f) => `${f.code}: ${Math.round(f.ratio * 100)}% copied from ${f.refCode}`
  );

  throw new Error(
    `Kristo Guide translation audit failed — language(s) exceed ${Math.round(
      GUIDE_TRANSLATION_COPY_THRESHOLD * 100
    )}% fallback copy threshold:\n${lines.join("\n")}`
  );
}

export function getSelectableGuideLanguageCodes(
  all: Record<GuideLanguageCode, GuideContent>
): GuideLanguageCode[] {
  return auditAllGuideTranslations(all)
    .filter((result) => result.selectable)
    .map((result) => result.code);
}

export { alignedCopyRatio, maxFallbackCopyRatio };
