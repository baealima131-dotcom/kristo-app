/**
 * Deterministic SOKO Home Feed card geometry.
 * Used by both the visible card and YouTube getItemLayout so height is known
 * before the product image loads.
 */

export const SOKO_FEED_CARD_H_INSET = 10;
export const SOKO_FEED_IMAGE_ASPECT = 0.54;
export const SOKO_FEED_IMAGE_MAX_HEIGHT = 300;
export const SOKO_FEED_IDENTITY_HEIGHT = 98;
export const SOKO_FEED_PAYMENTS_HEIGHT = 57;
export const SOKO_FEED_ACTIONS_HEIGHT = 62;
export const SOKO_FEED_CARD_MARGIN_TOP = -14;
export const SOKO_FEED_CARD_MARGIN_BOTTOM = 8;
/** Card borderWidth 2 on top + bottom. Counted once in the row length. */
export const SOKO_FEED_CARD_BORDER_Y = 4;

export function isSokoHomeFeedRow(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as { type?: unknown; _homeFeedKind?: unknown };
  return row.type === "soko" || row._homeFeedKind === "soko-product";
}

export function sokoHomeFeedCardWidth(windowWidth: number): number {
  return Math.max(280, Math.round(Number(windowWidth) || 0) - SOKO_FEED_CARD_H_INSET);
}

export function sokoHomeFeedImageHeight(windowWidth: number): number {
  return Math.min(
    SOKO_FEED_IMAGE_MAX_HEIGHT,
    Math.round(sokoHomeFeedCardWidth(windowWidth) * SOKO_FEED_IMAGE_ASPECT)
  );
}

export function sokoHomeFeedHasPayments(product?: any): boolean {
  if (!product) return true;
  const methods = Array.isArray(product?.paymentOptions?.methods)
    ? product.paymentOptions.methods
    : [];
  return methods.length > 0 || product?.paymentOptions?.stripeCardAvailable === true;
}

export function sokoHomeFeedBodyHeight(windowWidth: number, product?: any): number {
  const imageHeight = sokoHomeFeedImageHeight(windowWidth);
  const payments = sokoHomeFeedHasPayments(product) ? SOKO_FEED_PAYMENTS_HEIGHT : 0;
  return (
    imageHeight +
    SOKO_FEED_IDENTITY_HEIGHT +
    payments +
    SOKO_FEED_ACTIONS_HEIGHT +
    SOKO_FEED_CARD_BORDER_Y
  );
}

/** Occupied FlatList row length. Wrapper margins are the only vertical spacing. */
export function estimateSokoHomeFeedCardHeight(windowWidth: number, product?: any): number {
  return (
    sokoHomeFeedBodyHeight(windowWidth, product) +
    SOKO_FEED_CARD_MARGIN_TOP +
    SOKO_FEED_CARD_MARGIN_BOTTOM
  );
}

export function sokoHomeFeedProductKey(product: any): string {
  return String(product?.sokoProductId || product?.id || "")
    .replace(/^soko:/, "")
    .trim();
}

export function distributeSokoProducts(rows: any[], products: any[]): any[] {
  if (!products.length) return rows;
  if (!rows.length) {
    return products.map((product) => ({
      ...product,
      id: "soko:" + product.id,
      sokoProductId: product.id,
      type: "soko",
      _homeFeedKind: "soko-product",
    }));
  }
  const output: any[] = [];
  let productIndex = 0;
  for (let index = 0; index < rows.length; index += 1) {
    output.push(rows[index]);
    if ((index === 1 || (index > 1 && (index - 1) % 5 === 0)) && productIndex < products.length) {
      const product = products[productIndex++];
      output.push({
        ...product,
        id: "soko:" + product.id,
        sokoProductId: product.id,
        type: "soko",
        _homeFeedKind: "soko-product",
      });
    }
  }
  return output;
}

export function sokoProductVisualDigest(product: any): string {
  const methods = Array.isArray(product?.paymentOptions?.methods)
    ? product.paymentOptions.methods.join(",")
    : "";
  return [
    sokoHomeFeedProductKey(product),
    String(product?.title || ""),
    String(product?.price ?? ""),
    String(product?.currency || ""),
    String(product?.image || ""),
    String(product?.soldOut ? "1" : "0"),
    String(product?.stockAvailable ?? ""),
    String(product?.location || ""),
    String(product?.condition || ""),
    methods,
    product?.paymentOptions?.stripeCardAvailable === true ? "1" : "0",
  ].join("|");
}

export function sokoProductListVisualDigest(products: any[]): string {
  return (products || []).map((product) => sokoProductVisualDigest(product)).join("\n");
}

export function areSokoProductListsVisuallyEqual(prev: any[], next: any[]): boolean {
  if (prev === next) return true;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) {
    return false;
  }
  return sokoProductListVisualDigest(prev) === sokoProductListVisualDigest(next);
}

export function sokoHomeFeedCardPropsEqual(
  prev: { product: any; height?: number; layoutWidth?: number },
  next: { product: any; height?: number; layoutWidth?: number }
): boolean {
  return (
    prev.height === next.height &&
    prev.layoutWidth === next.layoutWidth &&
    sokoProductVisualDigest(prev.product) === sokoProductVisualDigest(next.product)
  );
}

const galleryPageByProduct = new Map<string, number>();
const galleryOffsetByProduct = new Map<string, number>();

export function readSokoCarouselPage(productKey: string): number {
  return galleryPageByProduct.get(productKey) || 0;
}

export function writeSokoCarouselPage(productKey: string, page: number, reason: string): number {
  const next = Math.max(0, Math.floor(Number(page) || 0));
  const previous = galleryPageByProduct.get(productKey) || 0;
  if (previous === next) return previous;
  galleryPageByProduct.set(productKey, next);
  console.log("SOKO_CAROUSEL_INDEX_CHANGE", {
    productKey,
    from: previous,
    to: next,
    reason,
  });
  return next;
}

export function readSokoCarouselOffset(productKey: string): number {
  return galleryOffsetByProduct.get(productKey) || 0;
}

export function writeSokoCarouselOffset(productKey: string, offset: number): void {
  galleryOffsetByProduct.set(productKey, Math.max(0, Number(offset) || 0));
}

export function clearSokoCarouselMemoryForTests(): void {
  galleryPageByProduct.clear();
  galleryOffsetByProduct.clear();
}

export function sokoDistributedRowsUnchanged(prev: any[], next: any[]): boolean {
  if (prev === next) return true;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i += 1) {
    const prevRow = prev[i];
    const nextRow = next[i];
    const prevId = String(prevRow?.id || "").trim();
    const nextId = String(nextRow?.id || "").trim();
    if (prevId !== nextId) return false;
    if (isSokoHomeFeedRow(prevRow) || isSokoHomeFeedRow(nextRow)) {
      if (sokoProductVisualDigest(prevRow) !== sokoProductVisualDigest(nextRow)) return false;
    }
  }
  return true;
}

export function mixedHomeFeedOccupiedHeight(
  rows: any[],
  windowWidth: number,
  videoRowHeight: number
): number {
  let total = 0;
  for (const row of rows || []) {
    total += isSokoHomeFeedRow(row)
      ? estimateSokoHomeFeedCardHeight(windowWidth, row)
      : videoRowHeight;
  }
  return total;
}

export function sokoHomeBackgroundEventShouldMoveCard(args: {
  prevProduct: any;
  nextProduct: any;
  prevHeight?: number;
  nextHeight?: number;
  prevLayoutWidth?: number;
  nextLayoutWidth?: number;
  prevDistributedRows: any[];
  nextDistributedRows: any[];
  prevCarouselPage: number;
  nextCarouselPage: number;
}): { rerender: boolean; resize: boolean; reposition: boolean } {
  const width = Number(args.prevLayoutWidth || args.nextLayoutWidth || 390);
  return {
    rerender: !sokoHomeFeedCardPropsEqual(
      {
        product: args.prevProduct,
        height: args.prevHeight,
        layoutWidth: args.prevLayoutWidth,
      },
      {
        product: args.nextProduct,
        height: args.nextHeight,
        layoutWidth: args.nextLayoutWidth,
      }
    ),
    resize:
      estimateSokoHomeFeedCardHeight(width, args.prevProduct) !==
      estimateSokoHomeFeedCardHeight(Number(args.nextLayoutWidth || width), args.nextProduct),
    reposition:
      !sokoDistributedRowsUnchanged(args.prevDistributedRows, args.nextDistributedRows) ||
      args.prevCarouselPage !== args.nextCarouselPage,
  };
}
