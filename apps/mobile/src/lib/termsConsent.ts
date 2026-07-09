import AsyncStorage from "@react-native-async-storage/async-storage";

const TERMS_CONSENT_KEY = "kristo_terms_consent_v1";
export const TERMS_VERSION = "2026-07-09-v2";

type TermsConsentRecord = {
  acceptedVersion: string;
  acceptedAt: string;
};

async function readTermsConsentRecord(): Promise<TermsConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(TERMS_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TermsConsentRecord> | null;
    const acceptedVersion = String(parsed?.acceptedVersion || "").trim();
    const acceptedAt = String(parsed?.acceptedAt || "").trim();
    if (!acceptedVersion || !acceptedAt) return null;
    return { acceptedVersion, acceptedAt };
  } catch {
    return null;
  }
}

export async function hasAcceptedTermsConsent(requiredVersion = TERMS_VERSION) {
  try {
    const record = await readTermsConsentRecord();
    if (!record) return false;
    return record.acceptedVersion === requiredVersion;
  } catch {
    return false;
  }
}

export async function saveTermsConsentAccepted(acceptedVersion = TERMS_VERSION) {
  const payload: TermsConsentRecord = {
    acceptedVersion: String(acceptedVersion || "").trim(),
    acceptedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(TERMS_CONSENT_KEY, JSON.stringify(payload));
  } catch {}
}

export async function getTermsConsentRecord() {
  return readTermsConsentRecord();
}
