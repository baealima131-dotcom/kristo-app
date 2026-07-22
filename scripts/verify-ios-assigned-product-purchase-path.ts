/**
 * Verify iOS assigned-product purchase resolution never falls back to premium_monthly.
 * Mirrors findPackageByProductId / resolveMonthlyPackage / packageMatchesAssignedProductId.
 * Run: node --experimental-strip-types scripts/verify-ios-assigned-product-purchase-path.ts
 */
import assert from "node:assert/strict";

type FakePkg = { product: { identifier: string }; packageType?: string; identifier?: string };
type FakeOfferings = {
  current: {
    availablePackages: FakePkg[];
    monthly: FakePkg | null;
    annual?: FakePkg | null;
  } | null;
  all: Record<string, { availablePackages: FakePkg[] }>;
};

function findPackageByProductId(
  offerings: FakeOfferings | null | undefined,
  productId: string | null | undefined
): FakePkg | null {
  const target = String(productId || "").trim();
  if (!target || !offerings) return null;
  const search = (offering: { availablePackages?: FakePkg[] } | null | undefined) => {
    if (!offering?.availablePackages?.length) return null;
    return offering.availablePackages.find((pkg) => pkg.product.identifier === target) || null;
  };
  const fromCurrent = search(offerings.current);
  if (fromCurrent) return fromCurrent;
  for (const offering of Object.values(offerings.all || {})) {
    const match = search(offering);
    if (match) return match;
  }
  return null;
}

function packageMatchesAssignedProductId(
  pkg: FakePkg | null | undefined,
  assignedProductId: string | null | undefined
): boolean {
  const assigned = String(assignedProductId || "").trim();
  const resolved = String(pkg?.product?.identifier || "").trim();
  return Boolean(assigned && resolved && assigned === resolved);
}

function resolveMonthlyPackage(
  offerings: FakeOfferings,
  preferredProductId?: string | null
): FakePkg | null {
  const preferred = String(preferredProductId || "").trim();
  if (preferred) {
    const byAssigned = findPackageByProductId(offerings, preferred);
    if (byAssigned && byAssigned.product.identifier === preferred) return byAssigned;
    return null;
  }
  const current = offerings.current;
  if (!current) return null;
  if (current.monthly) return current.monthly;
  return (
    current.availablePackages.find((pkg) =>
      /church_premium_monthly_g[2-5]|premium_monthly|month|monthly/i.test(pkg.product.identifier)
    ) || null
  );
}

function resolvePurchasePath(
  assignedProductId: string,
  offerings: FakeOfferings,
  storeProductIds: string[]
): {
  assignedProductId: string;
  resolvedPackageProductId: string | null;
  resolvedStoreProductId: string | null;
  path: "package" | "store_product" | "unavailable";
} {
  const assigned = String(assignedProductId || "").trim();
  const pkg = findPackageByProductId(offerings, assigned);
  if (packageMatchesAssignedProductId(pkg, assigned)) {
    return {
      assignedProductId: assigned,
      resolvedPackageProductId: assigned,
      resolvedStoreProductId: null,
      path: "package",
    };
  }
  if (storeProductIds.includes(assigned)) {
    return {
      assignedProductId: assigned,
      resolvedPackageProductId: null,
      resolvedStoreProductId: assigned,
      path: "store_product",
    };
  }
  return {
    assignedProductId: assigned,
    resolvedPackageProductId: null,
    resolvedStoreProductId: null,
    path: "unavailable",
  };
}

const G2 = "church_premium_monthly_g2";
const LEGACY = "premium_monthly";

function offeringsFor(ids: string[]): FakeOfferings {
  const packages = ids.map((id) => ({ product: { identifier: id }, packageType: "MONTHLY" }));
  return {
    current: {
      availablePackages: packages,
      monthly: packages.find((p) => p.product.identifier === LEGACY) || packages[0] || null,
    },
    all: {},
  };
}

const legacyOnly = offeringsFor([LEGACY, "premium_yearly"]);

// Live BOYKID case: assigned G2, offerings only have premium_monthly.
assert.equal(resolveMonthlyPackage(legacyOnly, G2), null);
assert.equal(packageMatchesAssignedProductId(resolveMonthlyPackage(legacyOnly, null), G2), false);
assert.equal(resolvePurchasePath(G2, legacyOnly, [G2]).path, "store_product");
assert.equal(resolvePurchasePath(G2, legacyOnly, [G2]).resolvedStoreProductId, G2);
assert.equal(resolvePurchasePath(G2, legacyOnly, []).path, "unavailable");

// Never purchase premium_monthly for assigned G2.
const pathWithOnlyLegacyStore = resolvePurchasePath(G2, legacyOnly, [LEGACY]);
assert.equal(pathWithOnlyLegacyStore.path, "unavailable");
assert.notEqual(pathWithOnlyLegacyStore.resolvedStoreProductId, LEGACY);

// Exact package when G2 present in offerings.
const withG2 = offeringsFor([G2, LEGACY]);
assert.equal(resolveMonthlyPackage(withG2, G2)?.product.identifier, G2);
assert.equal(resolvePurchasePath(G2, withG2, []).path, "package");

// Trial must not inherit premium_monthly intro for G2 assignment.
const legacyPkg = findPackageByProductId(legacyOnly, LEGACY);
assert.equal(packageMatchesAssignedProductId(legacyPkg, G2), false);

console.log("OK ios assigned product purchase path", {
  g2NoOfferingUsesStoreProduct: true,
  g2MissingEverywhereFailsClosed: true,
  g2NeverPurchasesPremiumMonthly: true,
  exactPackageWhenPresent: true,
  trialDoesNotInheritLegacyIntro: true,
});
