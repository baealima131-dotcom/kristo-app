import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GUIDE_CONTENT,
  GUIDE_LANGUAGES,
  GUIDE_LAST_UPDATED,
  GUIDE_SCREEN_TITLE,
  type GuideLanguageCode,
} from "@/src/lib/kristoGuideContent";

const TEAL = "#2DD4BF";
const TEAL_SOFT = "rgba(45,212,191,0.18)";
const BG = "#061418";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.08)";

export default function KristoGuideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<GuideLanguageCode>("en");

  const content = useMemo(() => GUIDE_CONTENT[language], [language]);
  const rtl = Boolean(content.rtl);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["rgba(45,212,191,0.12)", "rgba(6,20,24,0.98)", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={styles.title}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {GUIDE_SCREEN_TITLE}
          </Text>
          <Text style={[styles.subtitle, rtl ? styles.rtlText : null]}>{content.pageSubtitle}</Text>
        </View>
      </View>

      <View style={styles.languageBlock}>
        <Text style={[styles.languageLabel, rtl ? styles.rtlText : null]}>
          {content.languageLabel}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.languageRow}
        >
          {GUIDE_LANGUAGES.map((item) => {
            const active = item.code === language;
            return (
              <Pressable
                key={item.code}
                onPress={() => setLanguage(item.code)}
                style={[styles.languageChip, active ? styles.languageChipActive : null]}
              >
                <Text style={[styles.languageChipText, active ? styles.languageChipTextActive : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="book-outline" size={22} color={TEAL} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, rtl ? styles.rtlText : null]}>
              {content.pageTitle}
            </Text>
            <Text style={[styles.heroMeta, rtl ? styles.rtlText : null]}>
              {content.updatedLabel}: {GUIDE_LAST_UPDATED}
            </Text>
          </View>
        </View>

        {content.translationFallbackNote ? (
          <View style={styles.fallbackBanner}>
            <Ionicons name="information-circle-outline" size={18} color={TEAL} />
            <Text style={styles.fallbackBannerText}>{content.translationFallbackNote}</Text>
          </View>
        ) : null}

        {content.sections.map((section) => (
          <View key={section.id} style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, rtl ? styles.rtlText : null]}>
              {section.title}
            </Text>
            {section.bullets.map((bullet) => (
              <View key={bullet} style={[styles.bulletRow, rtl ? styles.bulletRowRtl : null]}>
                <View style={styles.bulletDot} />
                <Text style={[styles.bulletText, rtl ? styles.rtlText : null]}>{bullet}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.faqCard}>
          <Text style={[styles.faqTitle, rtl ? styles.rtlText : null]}>{content.faqTitle}</Text>
          {content.faq.map((item) => (
            <View key={item.question} style={styles.faqItem}>
              <Text style={[styles.faqQuestion, rtl ? styles.rtlText : null]}>{item.question}</Text>
              <Text style={[styles.faqAnswer, rtl ? styles.rtlText : null]}>{item.answer}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    padding: 4,
    marginTop: 2,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  languageBlock: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  languageLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  languageRow: {
    gap: 8,
    paddingRight: 8,
  },
  languageChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  languageChipActive: {
    backgroundColor: TEAL_SOFT,
    borderColor: "rgba(45,212,191,0.45)",
  },
  languageChipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "700",
  },
  languageChipTextActive: {
    color: TEAL,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  heroCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderRadius: 18,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL_SOFT,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  heroMeta: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginTop: 4,
  },
  fallbackBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(45,212,191,0.1)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  fallbackBannerText: {
    flex: 1,
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  sectionCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  sectionTitle: {
    color: TEAL,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bulletRowRtl: {
    flexDirection: "row-reverse",
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 7,
    backgroundColor: TEAL,
  },
  bulletText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 14,
    lineHeight: 21,
  },
  faqCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 14,
    marginTop: 2,
  },
  faqTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  faqItem: {
    gap: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  faqQuestion: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  faqAnswer: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 21,
  },
  rtlText: {
    writingDirection: "rtl",
    textAlign: "right",
  },
});
