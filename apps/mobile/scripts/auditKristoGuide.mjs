/**
 * Run: npx tsx scripts/auditKristoGuide.mjs
 */
async function main() {
  const { auditAllGuideTranslations, GUIDE_TRANSLATION_COPY_THRESHOLD } = await import(
    "../src/lib/kristoGuideTranslationAudit.ts"
  );
  const { GUIDE_CONTENT, GUIDE_SELECTABLE_LANGUAGE_CODES } = await import(
    "../src/lib/kristoGuideContent.ts"
  );

  const results = auditAllGuideTranslations(GUIDE_CONTENT);
  for (const r of results) {
    console.log(
      `${r.code}\tselectable=${r.selectable}\tcopy=${(r.maxCopyRatio * 100).toFixed(1)}%\tfrom=${r.copiedFrom ?? "-"}\t${r.reason ?? ""}`
    );
  }

  console.log("\nselectable:", GUIDE_SELECTABLE_LANGUAGE_CODES.join(", "));

  const failures = results.filter(
    (r) => !r.selectable && !GUIDE_CONTENT[r.code].translationFallbackNote
  );
  if (failures.length) {
    console.error(
      `\nFAIL: ${failures.length} language(s) exceed ${GUIDE_TRANSLATION_COPY_THRESHOLD * 100}% threshold`
    );
    process.exit(1);
  }
  console.log("\nOK: all required translations pass audit");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
