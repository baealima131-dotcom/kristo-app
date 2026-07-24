/**
 * Local-only: run inspectIosPremiumPurchaseSlots against the configured DB.
 * Usage:
 *   npx tsx scripts/inspect-ios-premium-slots-local.ts CH7-8ST0D5 u_xxx
 */
import { inspectIosPremiumPurchaseSlots } from "../app/api/_lib/iosPremiumProductAssignment";

async function main() {
  const churchId = String(process.argv[2] || "CH7-8ST0D5").trim();
  const ownerUserId = String(process.argv[3] || "").trim();
  if (!ownerUserId) {
    console.error("Usage: npx tsx scripts/inspect-ios-premium-slots-local.ts <churchId> <ownerUserId>");
    process.exit(2);
  }
  const inspection = await inspectIosPremiumPurchaseSlots({
    churchId,
    ownerUserId,
    devicePurchaseScope: "local-verify-scope",
    purchaseSessionId: null,
    deviceOwnedProductIds: [],
  });
  const out = {
    ok: true,
    action: "inspect",
    platform: inspection.platform,
    churchId: inspection.churchId,
    thisChurchProductIds: inspection.thisChurchProductIds,
    otherChurchProductIds: inspection.otherChurchProductIds,
    mappedByProductId: inspection.mappedByProductId,
    allSlotsOccupied: inspection.allSlotsOccupied,
    slots: inspection.slots.map((slot) => ({
      productId: slot.productId,
      status: slot.status,
      statusLabel: slot.statusLabel,
      mappedChurchId: slot.mappedChurchId,
      assignmentSource: slot.assignmentSource,
      purchasable: slot.purchasable,
      legacy: slot.legacy,
      purchaseEnabled: slot.purchaseEnabled,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
