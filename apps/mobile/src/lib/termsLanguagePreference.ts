import AsyncStorage from "@react-native-async-storage/async-storage";
import { TERMS_LOCALES, type TermsLocale } from "@/src/content/terms/types";

const TERMS_LANGUAGE_KEY = "kristo_terms_language_v1";

function isTermsLocale(value: string): value is TermsLocale {
  return (TERMS_LOCALES as readonly string[]).includes(value);
}

export async function getTermsLanguagePreference(): Promise<TermsLocale | null> {
  try {
    const raw = await AsyncStorage.getItem(TERMS_LANGUAGE_KEY);
    const locale = String(raw || "").trim();
    if (!locale || !isTermsLocale(locale)) return null;
    return locale;
  } catch {
    return null;
  }
}

export async function saveTermsLanguagePreference(locale: TermsLocale): Promise<void> {
  try {
    await AsyncStorage.setItem(TERMS_LANGUAGE_KEY, locale);
  } catch {}
}
