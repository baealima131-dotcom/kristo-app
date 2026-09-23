/**
 * Verify collectDeviceOwnedPremiumProductIds ignores expired / cross-store history.
 * Run: npx tsx scripts/verify-device-owned-premium-ids.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("module");
const originalLoad = Module._load;
Module._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "react-native") {
    return { Alert: {}, Linking: {}, Platform: { OS: "ios" } };
  }
  if (request === "@react-native-async-storage/async-storage") {
    return { default: { getItem: async () => null, setItem: async () => {} } };
  }
  if (request === "expo-constants") {
    return { default: { expoConfig: { extra: {} } } };
  }
  if (request === "react-native-purchases") {
    return {
      default: {},
      LOG_LEVEL: {},
      INTRO_ELIGIBILITY_STATUS: {},
      PRODUCT_CATEGORY: {},
      PURCHASES_ERROR_CODE: {},
      PACKAGE_TYPE: {},
      STORE_REPLACEMENT_MODE: {},
    };
  }
  return originalLoad.apply(this, arguments as never);
};

async function main() {
  const { collectDeviceOwnedPremiumProductIds } = await import(
    "../src/lib/payments/mobileSubscriptions"
  );

  assert.deepEqual(
    collectDeviceOwnedPremiumProductIds({
      activeSubscriptions: [],
      allPurchasedProductIdentifiers: ["premium_monthly"],
      subscriptionsByProductIdentifier: {
        premium_monthly: {
          isActive: false,
          store: "PLAY_STORE",
          productIdentifier: "premium_monthly",
        },
      },
      entitlements: {
        active: {},
        all: {
          premium: { productIdentifier: "premium_monthly", isActive: false },
        },
      },
    } as never),
    [],
    "expired Play Store premium_monthly must not block iOS"
  );

  assert.deepEqual(
    collectDeviceOwnedPremiumProductIds({
      activeSubscriptions: ["premium_monthly"],
      allPurchasedProductIdentifiers: ["premium_monthly"],
      subscriptionsByProductIdentifier: {
        premium_monthly: {
          isActive: true,
          store: "APP_STORE",
          productIdentifier: "premium_monthly",
        },
      },
      entitlements: {
        active: {
          premium: { productIdentifier: "premium_monthly", isActive: true },
        },
        all: {},
      },
    } as never),
    ["premium_monthly"],
    "active App Store premium_monthly remains owned"
  );

  assert.deepEqual(
    collectDeviceOwnedPremiumProductIds({
      activeSubscriptions: ["premium_monthly"],
      subscriptionsByProductIdentifier: {
        premium_monthly: {
          isActive: true,
          store: "PLAY_STORE",
          productIdentifier: "premium_monthly",
        },
      },
      entitlements: { active: {}, all: {} },
    } as never),
    [],
    "active Play Store on iOS must be ignored for device-owned blocking"
  );

  console.log("verify-device-owned-premium-ids: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
