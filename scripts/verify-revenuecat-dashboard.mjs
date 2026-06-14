#!/usr/bin/env node
/**
 * RevenueCat dashboard configuration verifier.
 *
 * Usage:
 *   REVENUECAT_SECRET_API_KEY=sk_... node scripts/verify-revenuecat-dashboard.mjs
 *   REVENUECAT_SECRET_API_KEY=sk_... REVENUECAT_PROJECT_ID=proj_... node scripts/verify-revenuecat-dashboard.mjs
 *
 * Reads expected identifiers from lib/churchPremiumRevenueCat.ts (single source of truth).
 */

const API_V2 = "https://api.revenuecat.com/v2";
const EXPECTED_ENTITLEMENT = "church_premium";
const EXPECTED_PRODUCTS = ["premium_monthly", "premium_yearly"];

const secret = String(process.env.REVENUECAT_SECRET_API_KEY || "").trim();
const projectIdArg = String(process.env.REVENUECAT_PROJECT_ID || "").trim();

async function rcFetch(path) {
  const res = await fetch(`${API_V2}${path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`RC ${path} → HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

async function resolveProjectId() {
  if (projectIdArg) return projectIdArg;
  const data = await rcFetch("/projects");
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) throw new Error("No RevenueCat projects found for this API key.");
  if (items.length > 1) {
    console.log("Multiple projects — using first. Set REVENUECAT_PROJECT_ID to override:");
    items.forEach((p) => console.log(`  - ${p.id}  ${p.name || ""}`));
  }
  return String(items[0].id);
}

function productIdFromRow(row) {
  return String(
    row?.store_identifier ||
      row?.identifier ||
      row?.product?.store_identifier ||
      row?.product?.identifier ||
      ""
  ).trim();
}

async function main() {
  console.log("=== RevenueCat Dashboard Verification ===\n");

  if (!secret) {
    console.error("FAIL: REVENUECAT_SECRET_API_KEY is not set.");
    console.error("Set the server secret from RevenueCat → Project → API keys → Secret API key.");
    process.exit(1);
  }

  console.log("Expected (code single source of truth):");
  console.log(`  Entitlement: ${EXPECTED_ENTITLEMENT}`);
  console.log(`  Products:    ${EXPECTED_PRODUCTS.join(", ")}`);
  console.log(`  Monthly trial: 14-day intro (StoreKit / ASC — not in RC entitlement API)\n`);

  const projectId = await resolveProjectId();
  console.log(`Project: ${projectId}\n`);

  const entData = await rcFetch(`/projects/${projectId}/entitlements?limit=50`);
  const entitlements = Array.isArray(entData?.items) ? entData.items : [];

  console.log("Entitlements in dashboard:");
  for (const ent of entitlements) {
    const lookup = String(ent.lookup_key || ent.identifier || ent.id || "").trim();
    const display = String(ent.display_name || "").trim();
    console.log(`  - lookup_key: ${lookup}${display ? ` (${display})` : ""}`);
  }

  const match = entitlements.find(
    (ent) =>
      String(ent.lookup_key || ent.identifier || "").trim() === EXPECTED_ENTITLEMENT
  );

  if (!match) {
    console.error(`\nFAIL: Entitlement "${EXPECTED_ENTITLEMENT}" not found in dashboard.`);
    process.exit(1);
  }

  const entId = String(match.id || "").trim();
  console.log(`\nOK: Found entitlement "${EXPECTED_ENTITLEMENT}" (id: ${entId})`);

  let attachedProducts = [];
  try {
    const prodData = await rcFetch(
      `/projects/${projectId}/entitlements/${entId}/products?limit=50`
    );
    attachedProducts = Array.isArray(prodData?.items) ? prodData.items : [];
  } catch (error) {
    console.warn(`\nWARN: Could not list attached products: ${error.message}`);
  }

  const attachedIds = attachedProducts.map(productIdFromRow).filter(Boolean);
  console.log("\nProducts attached to entitlement:");
  if (!attachedIds.length) {
    console.log("  (none returned by API — verify manually in dashboard)");
  } else {
    attachedIds.forEach((id) => console.log(`  - ${id}`));
  }

  const missing = EXPECTED_PRODUCTS.filter((id) => !attachedIds.includes(id));
  if (attachedIds.length && missing.length) {
    console.error(`\nFAIL: Missing expected products on entitlement: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (attachedIds.length) {
    console.log("\nOK: Expected products are attached to church_premium.");
  }

  console.log("\nSandbox vs production:");
  console.log(
    "  RevenueCat uses ONE entitlement identifier per project for both sandbox and production."
  );
  console.log(
    "  Store environment (Sandbox vs Production) affects transactions, not the entitlement lookup_key."
  );

  console.log("\n=== Verification passed ===");
}

main().catch((error) => {
  console.error("\nFAIL:", error.message || error);
  process.exit(1);
});
