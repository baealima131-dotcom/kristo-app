import AsyncStorage from "@react-native-async-storage/async-storage";

const LEGACY_REQUIRE_AUTH_PREFIX = "kristo_messages_require_device_auth_v1_";

/**
 * One-shot cleanup for removed Message Lock local prefs.
 * Orphaned SecureStore unlock timestamps are ignored (no migration).
 */
export async function clearLegacyMessageLockPrefs(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const legacy = keys.filter((key) =>
      key.startsWith(LEGACY_REQUIRE_AUTH_PREFIX)
    );
    if (legacy.length > 0) {
      await AsyncStorage.multiRemove(legacy);
    }
  } catch {
    // Non-fatal — Messages must open regardless.
  }
}
