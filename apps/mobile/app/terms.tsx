import React, { useEffect, useMemo, useRef, useState } from "react";
import { Href, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DEFAULT_TERMS_LOCALE,
  getTermsSummary,
  getTermsTranslation,
  TERMS_LANGUAGE_OPTIONS,
  type TermsLocale,
} from "@/src/content/terms";
import {
  saveTermsConsentAccepted,
  TERMS_VERSION,
} from "@/src/lib/termsConsent";
import {
  getTermsLanguagePreference,
  saveTermsLanguagePreference,
} from "@/src/lib/termsLanguagePreference";
import { KRISTO_SUPPORT_URL } from "@/src/lib/kristoLinks";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const CONTACT_SECTION_ID = 23;

export default function TermsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // KRISTO_TERMS_ANDROID_SAFEAREA_REVIEW_V1: protect consent controls from 3-button nav.
  const androidBottomInset = Platform.OS === "android" ? Math.max(insets.bottom, 24) : 0;
  const scrollRef = useRef<ScrollView>(null);
  const [locale, setLocale] = useState<TermsLocale>(DEFAULT_TERMS_LOCALE);
  const [localeReady, setLocaleReady] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [fullTermsOpen, setFullTermsOpen] = useState(false);
  const [summaryViewportH, setSummaryViewportH] = useState(0);
  const [summaryContentH, setSummaryContentH] = useState(0);

  const copy = useMemo(() => getTermsTranslation(locale), [locale]);
  const summary = useMemo(() => getTermsSummary(locale), [locale]);
  const isRtl = Boolean(copy.isRtl);

  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = await getTermsLanguagePreference();
      if (!active) return;
      if (saved) setLocale(saved);
      setLocaleReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const canContinue = useMemo(
    () => scrolledToEnd && accepted && !saving,
    [scrolledToEnd, accepted, saving]
  );

  const resetAgreementState = () => {
    setScrolledToEnd(false);
    setAccepted(false);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  const onSelectLanguage = (nextLocale: TermsLocale) => {
    if (nextLocale === locale) {
      setLanguagePickerOpen(false);
      return;
    }
    setLocale(nextLocale);
    void saveTermsLanguagePreference(nextLocale);
    resetAgreementState();
    setLanguagePickerOpen(false);
  };

  // The summary usually fits on screen: then there is nothing to scroll and agreement is enabled.
  useEffect(() => {
    if (scrolledToEnd || !summaryViewportH || !summaryContentH) return;
    if (summaryContentH <= summaryViewportH + 24) setScrolledToEnd(true);
  }, [scrolledToEnd, summaryViewportH, summaryContentH]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (scrolledToEnd) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const padding = 24;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - padding) {
      setScrolledToEnd(true);
    }
  };

  const onContinue = async () => {
    if (!canContinue) return;
    setSaving(true);
    await saveTermsConsentAccepted(TERMS_VERSION);
    router.replace("/(auth)/login" as Href);
  };

  const rtlText = isRtl ? s.rtlText : null;
  const rtlSectionTitle = isRtl ? s.rtlSectionTitle : null;
  const rtlBody = isRtl ? s.rtlBody : null;

  return (
    <View style={[s.wrap, androidBottomInset > 0 ? { paddingBottom: 28 + androidBottomInset } : null]}>
      <Text style={[s.title, rtlText]}>{copy.title}</Text>
      <View style={[s.metaRow, isRtl ? s.metaRowRtl : null]}>
        <Text style={[s.metaLine, rtlText]} numberOfLines={2}>
          {copy.effectiveLabel}: {copy.effectiveDate}
          <Text style={s.metaDot}> • </Text>
          {copy.updatedLabel}: {copy.effectiveDate}
        </Text>
        <Pressable
          style={s.langBtn}
          onPress={() => setLanguagePickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={copy.languageModalTitle}
          disabled={!localeReady}
        >
          <Text style={s.langBtnText} numberOfLines={1}>
            {copy.languageName}
          </Text>
          <Ionicons name="chevron-down" size={12} color="rgba(217,179,95,0.95)" />
        </Pressable>
      </View>

      <Modal
        visible={languagePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguagePickerOpen(false)}
      >
        <View style={s.langModalWrap}>
          <Pressable style={s.langModalBackdrop} onPress={() => setLanguagePickerOpen(false)} />
          <View style={s.langModalCard}>
            <Text style={s.langModalTitle}>{copy.languageModalTitle}</Text>
            <ScrollView
              style={s.langList}
              contentContainerStyle={s.langListContent}
              showsVerticalScrollIndicator
              bounces={false}
            >
              {TERMS_LANGUAGE_OPTIONS.map((option) => {
                const active = locale === option.locale;
                return (
                  <Pressable
                    key={option.locale}
                    onPress={() => onSelectLanguage(option.locale)}
                    style={[s.langOption, active ? s.langOptionActive : null]}
                  >
                    <Text
                      style={[s.langOptionText, active ? s.langOptionTextActive : null]}
                      numberOfLines={2}
                    >
                      {option.languageName}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={16} color={GOLD} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Short summary before acceptance; the full terms (and Support) open from "Read full terms". */}
      <ScrollView
        ref={scrollRef}
        key={locale}
        style={s.bodyWrap}
        contentContainerStyle={s.summaryContent}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={(e) => setSummaryViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setSummaryContentH(h)}
      >
        <Text style={[s.summaryIntro, rtlBody]}>{summary.intro}</Text>
        {summary.points.map((point, index) => (
          <View key={`${locale}-point-${index}`} style={[s.summaryPoint, isRtl ? s.summaryPointRtl : null]}>
            <View style={s.summaryDot} />
            <View style={{ flex: 1 }}>
              <Text style={[s.summaryPointTitle, rtlSectionTitle]}>{point.title}</Text>
              <Text style={[s.summaryPointText, rtlBody]}>{point.text}</Text>
            </View>
          </View>
        ))}
        <Pressable
          style={[s.readFullBtn, isRtl ? s.supportBtnRtl : null]}
          onPress={() => setFullTermsOpen(true)}
          accessibilityRole="button"
        >
          <Ionicons name="document-text-outline" size={15} color={GOLD} />
          <Text style={s.readFullBtnText}>{summary.readFullTermsLabel}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={fullTermsOpen}
        animationType="slide"
        onRequestClose={() => setFullTermsOpen(false)}
      >
        <View
          style={[
            s.fullWrap,
            { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, androidBottomInset) + 12 },
          ]}
        >
          <View style={[s.fullHeader, isRtl ? s.metaRowRtl : null]}>
            <Text style={[s.fullTitle, rtlText]} numberOfLines={2}>
              {copy.title}
            </Text>
            <Pressable
              style={s.fullCloseBtn}
              onPress={() => setFullTermsOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={summary.closeLabel}
            >
              <Ionicons name="close" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <ScrollView
            style={s.bodyWrap}
            contentContainerStyle={[s.bodyContent, s.fullBodyContent, isRtl ? s.bodyContentRtl : null]}
          >
            {copy.sections.map((section) => (
              <View key={`${locale}-${section.id}`} style={s.section}>
                <Text style={[s.sectionTitle, rtlSectionTitle]}>{section.title}</Text>
                {section.paragraphs.map((paragraph, index) => (
                  <Text key={`${locale}-${section.id}-${index}`} style={[s.body, rtlBody]}>
                    {paragraph}
                  </Text>
                ))}
                {section.id === CONTACT_SECTION_ID ? (
                  <Pressable
                    style={[s.supportBtn, isRtl ? s.supportBtnRtl : null]}
                    onPress={() => {
                      void Linking.openURL(KRISTO_SUPPORT_URL);
                    }}
                  >
                    <Text style={s.supportBtnText}>{copy.contactSupportLabel}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <Pressable style={s.fullCloseWide} onPress={() => setFullTermsOpen(false)}>
            <Text style={s.fullCloseWideText}>{summary.closeLabel}</Text>
          </Pressable>
        </View>
      </Modal>

      <View style={s.footerControls}>
        <Pressable
          style={[s.checkRow, !scrolledToEnd && { opacity: 0.55 }, isRtl ? s.checkRowRtl : null]}
          onPress={() => {
            if (!scrolledToEnd) return;
            setAccepted((v) => !v);
          }}
        >
          <View style={[s.checkbox, accepted ? s.checkboxOn : null]}>
            {accepted ? <Ionicons name="checkmark" size={14} color="#0B0F17" /> : null}
          </View>
          <Text style={[s.checkText, rtlText]}>{copy.agreementLabel}</Text>
        </Pressable>

        {!scrolledToEnd ? (
          <Text style={[s.note, rtlText]}>{copy.scrollHint}</Text>
        ) : null}

        <Pressable
          style={[s.continueBtn, !canContinue && s.continueBtnDisabled]}
          disabled={!canContinue}
          onPress={onContinue}
        >
          {saving ? (
            <ActivityIndicator color="#0B0F17" />
          ) : (
            <Text style={s.continueText}>{copy.continueLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 28 },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", marginBottom: 10 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 2,
  },
  metaRowRtl: { flexDirection: "row-reverse" },
  metaLine: {
    flex: 1,
    flexShrink: 1,
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
  metaDot: { color: "rgba(255,255,255,0.38)", fontWeight: "800" },
  langBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.38)",
    backgroundColor: "rgba(217,179,95,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
    maxWidth: "42%",
  },
  langBtnText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "800",
    flexShrink: 1,
  },
  langModalWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  langModalBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  langModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
    backgroundColor: "#0B0F17",
    padding: 12,
    maxHeight: "72%",
  },
  langModalTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 8,
  },
  langList: { flexGrow: 0 },
  langListContent: { paddingBottom: 4 },
  langOption: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  langOptionActive: {
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  langOptionText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  langOptionTextActive: { color: GOLD, fontWeight: "900" },
  bodyWrap: {
    flex: 1,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  bodyContent: { padding: 14, paddingBottom: 180 },
  bodyContentRtl: { direction: "rtl" },
  summaryContent: { padding: 16, paddingBottom: 24 },
  summaryIntro: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    marginBottom: 14,
  },
  summaryPoint: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 13 },
  // RTL without `direction` (it would flip textAlign): reverse the row explicitly.
  summaryPointRtl: { flexDirection: "row-reverse" },
  summaryDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7, backgroundColor: GOLD },
  summaryPointTitle: { color: GOLD, fontSize: 14, lineHeight: 20, fontWeight: "900", marginBottom: 2 },
  summaryPointText: { color: "rgba(255,255,255,0.88)", fontSize: 13.5, lineHeight: 20, fontWeight: "600" },
  readFullBtn: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.5)",
    backgroundColor: "rgba(217,179,95,0.1)",
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  readFullBtnText: { color: GOLD, fontWeight: "900", fontSize: 13 },
  fullWrap: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  fullHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  fullTitle: { flex: 1, color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  fullCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  fullBodyContent: { paddingBottom: 32 },
  fullCloseWide: {
    marginTop: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.1)",
  },
  fullCloseWideText: { color: GOLD, fontSize: 15, fontWeight: "900" },
  section: { marginBottom: 16 },
  sectionTitle: {
    color: GOLD,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    marginBottom: 8,
  },
  body: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    marginBottom: 8,
  },
  rtlText: {
    writingDirection: "rtl",
    textAlign: "right",
  },
  rtlSectionTitle: {
    writingDirection: "rtl",
    textAlign: "right",
  },
  rtlBody: {
    writingDirection: "rtl",
    textAlign: "right",
  },
  supportBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.5)",
    backgroundColor: "rgba(147,197,253,0.14)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  supportBtnRtl: { alignSelf: "flex-end" },
  supportBtnText: { color: "rgba(191,219,254,0.98)", fontWeight: "900", fontSize: 13 },
  footerControls: {
    paddingTop: 10,
    paddingBottom: 2,
    backgroundColor: BG,
  },
  checkRow: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  checkRowRtl: { flexDirection: "row-reverse" },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: GOLD, borderColor: GOLD },
  checkText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  note: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 8, fontWeight: "700" },
  continueBtn: {
    marginTop: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    backgroundColor: "rgba(217,179,95,0.92)",
  },
  continueBtnDisabled: { opacity: 0.4 },
  continueText: { color: "#0B0F17", fontSize: 15, fontWeight: "900" },
});
