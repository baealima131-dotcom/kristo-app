const PUBLIC_METHODS = new Set(["cash", "cash_app", "mobile_money"]);

function text(value: unknown) {
  return String(value || "").trim();
}

export function sanitizeSokoCatalogPaymentOptions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { methods: [] as string[], stripeCardAvailable: false };
  }
  const source = value as Record<string, unknown>;
  const methods = Array.isArray(source.methods)
    ? source.methods
        .map((method) => String(method || "").trim())
        .filter((method) => PUBLIC_METHODS.has(method))
    : [];
  return {
    methods: [...new Set(methods)],
    stripeCardAvailable: source.stripeCardAvailable === true,
  };
}

export function sanitizeSokoCatalogFulfillmentOptions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const type = text(source.type);
  if (!["pickup", "local_delivery", "parcel", "freight"].includes(type)) return undefined;
  const flatFee = Number(source.flatFee);
  const estimatedDays = Number(source.estimatedDays);
  const vehicleType = text(source.vehicleType);
  return {
    type,
    ...(Number.isFinite(flatFee) && flatFee > 0 ? { flatFee } : {}),
    ...(Number.isFinite(estimatedDays) && estimatedDays > 0 ? { estimatedDays } : {}),
    ...(vehicleType ? { vehicleType } : {}),
  };
}

export function sanitizeSokoCatalogSeller(
  value: unknown,
  options?: { includeInternalIds?: boolean }
) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const seller: Record<string, unknown> = {
    name: text(source.name) || "Kristo Seller",
    verified: source.verified === true,
    shopName: text(source.shopName),
    shopCategory: text(source.shopCategory),
    shopLocation: text(source.shopLocation),
    avatarUrl: text(source.avatarUrl || source.avatarUri),
    church: text(source.churchName || source.church),
    churchName: text(source.churchName || source.church),
    churchAvatarUrl: text(source.churchAvatarUrl),
  };
  if (options?.includeInternalIds) {
    const id = text(source.id);
    const kristoId = text(source.kristoId).toUpperCase();
    if (id) seller.id = id;
    if (kristoId) seller.kristoId = kristoId;
  }
  return seller;
}

export function sanitizeSokoCatalogProduct(
  product: Record<string, any>,
  options?: { includeInternalIds?: boolean }
) {
  const photos = Array.isArray(product?.photos)
    ? product.photos.map((value: unknown) => text(value)).filter(Boolean)
    : [];
  const image = text(product?.image) || photos[0] || "";
  return {
    id: text(product?.id || product?.serverId),
    serverId: text(product?.serverId || product?.id),
    title: text(product?.title),
    description: text(product?.description),
    category: text(product?.category),
    price: Number(product?.price),
    currency: text(product?.currency),
    location: text(product?.location),
    condition: text(product?.condition),
    photos,
    image,
    status: text(product?.status),
    stockTotal: Number(product?.stockTotal),
    stockAvailable: Number(product?.stockAvailable),
    soldOut: product?.soldOut === true,
    createdAt: product?.createdAt,
    paymentOptions: sanitizeSokoCatalogPaymentOptions(product?.paymentOptions),
    fulfillmentOptions: sanitizeSokoCatalogFulfillmentOptions(
      product?.fulfillmentOptions
    ),
    seller: sanitizeSokoCatalogSeller(product?.seller, options),
  };
}
