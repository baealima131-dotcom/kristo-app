export type SokoSupplyProvider =
  | "alibaba";

export type SokoSupplyProduct = {
  provider: SokoSupplyProvider;

  providerProductId: string;

  title: string;

  productUrl: string;
  checkoutUrl: string;

  imageUrl: string;

  supplierName: string;
  supplierCountry: string;

  currency: string;

  minUnitPrice: number;
  maxUnitPrice: number;

  moq: number;

  availableQuantity:
    | number
    | null;

  leadTime: string;

  verifiedSupplier: boolean;

  readyToShip: boolean;

  orderSupported: boolean;

  raw?: Record<
    string,
    unknown
  >;
};

export type SokoSupplySearchResult = {
  provider: SokoSupplyProvider;

  configured: boolean;

  mode:
    | "api"
    | "external_search";

  products:
    SokoSupplyProduct[];

  externalSearchUrl: string;

  message?: string;

  directOrderConfigured:
    boolean;
};

export type SokoSupplyOrderInput = {
  provider:
    SokoSupplyProvider;

  requestId: string;

  providerProductId: string;

  productName: string;

  productUrl: string;
  checkoutUrl: string;

  quantity: number;

  unitPrice: number;

  currency: string;

  supplierName: string;
};

export type SokoSupplyOrderResult = {
  ordered: boolean;

  mode:
    | "api"
    | "external_checkout";

  providerOrderId?: string;

  checkoutUrl?: string;

  message?: string;
};

function clean(
  value: unknown
) {
  return String(
    value ?? ""
  ).trim();
}

function numberValue(
  value: unknown
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function boolValue(
  value: unknown
) {
  if (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  ) {
    return true;
  }

  return false;
}

function alibabaExternalSearchUrl(
  query: string
) {
  return (
    "https://www.alibaba.com/trade/search" +
    `?SearchText=${encodeURIComponent(
      query
    )}`
  );
}

function normalizeAlibabaProduct(
  raw: any
): SokoSupplyProduct {
  const minPrice =
    numberValue(
      raw?.minUnitPrice ??
      raw?.min_price ??
      raw?.minPrice ??
      raw?.price?.min ??
      raw?.price
    );

  const maxPrice =
    numberValue(
      raw?.maxUnitPrice ??
      raw?.max_price ??
      raw?.maxPrice ??
      raw?.price?.max ??
      minPrice
    );

  const productUrl =
    clean(
      raw?.productUrl ??
      raw?.product_url ??
      raw?.url ??
      raw?.detailUrl
    );

  return {
    provider:
      "alibaba",

    providerProductId:
      clean(
        raw?.providerProductId ??
        raw?.productId ??
        raw?.product_id ??
        raw?.id
      ),

    title:
      clean(
        raw?.title ??
        raw?.productName ??
        raw?.name
      ),

    productUrl,

    checkoutUrl:
      clean(
        raw?.checkoutUrl ??
        raw?.checkout_url ??
        productUrl
      ),

    imageUrl:
      clean(
        raw?.imageUrl ??
        raw?.image_url ??
        raw?.image ??
        raw?.mainImage?.url
      ),

    supplierName:
      clean(
        raw?.supplierName ??
        raw?.supplier_name ??
        raw?.supplier?.name
      ),

    supplierCountry:
      clean(
        raw?.supplierCountry ??
        raw?.supplier_country ??
        raw?.country ??
        raw?.supplier?.country
      ),

    currency:
      clean(
        raw?.currency ??
        raw?.price?.currency ??
        "USD"
      ) || "USD",

    minUnitPrice:
      minPrice,

    maxUnitPrice:
      maxPrice ||
      minPrice,

    moq:
      numberValue(
        raw?.moq ??
        raw?.minimumOrderQuantity ??
        raw?.minimum_order_quantity
      ),

    availableQuantity:
      raw?.availableQuantity ==
        null
        ? null
        : numberValue(
            raw?.availableQuantity
          ),

    leadTime:
      clean(
        raw?.leadTime ??
        raw?.lead_time ??
        raw?.shippingLeadTime
      ),

    verifiedSupplier:
      boolValue(
        raw?.verifiedSupplier ??
        raw?.verified_supplier ??
        raw?.supplier?.verified
      ),

    readyToShip:
      boolValue(
        raw?.readyToShip ??
        raw?.ready_to_ship
      ),

    orderSupported:
      boolValue(
        raw?.orderSupported ??
        raw?.order_supported
      ),

    raw:
      typeof raw === "object"
        ? raw
        : undefined,
  };
}

export async function
searchSokoSupplyProvider(input: {
  provider:
    SokoSupplyProvider;

  query: string;

  category?: string;

  quantity?: number;

  targetUnitCost?: number;
}): Promise<
  SokoSupplySearchResult
> {
  if (
    input.provider !==
    "alibaba"
  ) {
    throw new Error(
      "Unsupported supply provider."
    );
  }

  const query =
    clean(input.query);

  if (!query) {
    throw new Error(
      "Product search query is required."
    );
  }

  const endpoint =
    clean(
      process.env
        .ALIBABA_SUPPLY_SEARCH_ENDPOINT
    );

  const apiToken =
    clean(
      process.env
        .ALIBABA_SUPPLY_API_TOKEN
    );

  const orderEndpoint =
    clean(
      process.env
        .ALIBABA_SUPPLY_ORDER_ENDPOINT
    );

  const externalSearchUrl =
    alibabaExternalSearchUrl(
      query
    );

  if (!endpoint) {
    return {
      provider:
        "alibaba",

      configured:
        false,

      mode:
        "external_search",

      products: [],

      externalSearchUrl,

      directOrderConfigured:
        Boolean(
          orderEndpoint
        ),

      message:
        "Alibaba live API is not connected yet. Configure the approved Alibaba supply API connector to show live products inside SOKO.",
    };
  }

  const headers:
    Record<
      string,
      string
    > = {
    "content-type":
      "application/json",
  };

  if (apiToken) {
    headers.authorization =
      `Bearer ${apiToken}`;
  }

  const response =
    await fetch(
      endpoint,
      {
        method: "POST",

        headers,

        cache: "no-store",

        body:
          JSON.stringify({
            query,

            category:
              clean(
                input.category
              ),

            quantity:
              numberValue(
                input.quantity
              ),

            targetUnitCost:
              numberValue(
                input.targetUnitCost
              ),

            limit: 24,
          }),
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Alibaba supply search failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  const data: any =
    await response.json();

  const rows =
    Array.isArray(
      data?.products
    )
      ? data.products
      : Array.isArray(
          data?.items
        )
        ? data.items
        : Array.isArray(
            data?.result?.products
          )
          ? data.result
              .products
          : [];

  const products =
    rows
      .map(
        normalizeAlibabaProduct
      )
      .filter(
        (
          product:
            SokoSupplyProduct
        ) =>
          product.title ||
          product.productUrl
      )
      .slice(
        0,
        24
      );

  return {
    provider:
      "alibaba",

    configured:
      true,

    mode:
      "api",

    products,

    externalSearchUrl,

    directOrderConfigured:
      Boolean(
        orderEndpoint
      ),
  };
}

export async function
placeSokoSupplyOrder(
  input:
    SokoSupplyOrderInput
): Promise<
  SokoSupplyOrderResult
> {
  if (
    input.provider !==
    "alibaba"
  ) {
    throw new Error(
      "Unsupported order provider."
    );
  }

  const endpoint =
    clean(
      process.env
        .ALIBABA_SUPPLY_ORDER_ENDPOINT
    );

  const apiToken =
    clean(
      process.env
        .ALIBABA_SUPPLY_API_TOKEN
    );

  const checkoutUrl =
    clean(
      input.checkoutUrl ||
      input.productUrl
    );

  if (!endpoint) {
    return {
      ordered:
        false,

      mode:
        "external_checkout",

      checkoutUrl,

      message:
        "Direct Alibaba ordering API is not connected yet. Complete the approved order on Alibaba.",
    };
  }

  const headers:
    Record<
      string,
      string
    > = {
    "content-type":
      "application/json",
  };

  if (apiToken) {
    headers.authorization =
      `Bearer ${apiToken}`;
  }

  const response =
    await fetch(
      endpoint,
      {
        method: "POST",

        headers,

        cache: "no-store",

        body:
          JSON.stringify({
            requestId:
              input.requestId,

            providerProductId:
              input.providerProductId,

            productName:
              input.productName,

            productUrl:
              input.productUrl,

            quantity:
              input.quantity,

            unitPrice:
              input.unitPrice,

            currency:
              input.currency,

            supplierName:
              input.supplierName,
          }),
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Alibaba order failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  const data: any =
    await response.json();

  const providerOrderId =
    clean(
      data?.orderId ??
      data?.order_id ??
      data?.result?.orderId
    );

  if (!providerOrderId) {
    throw new Error(
      "Alibaba order API returned no order ID."
    );
  }

  return {
    ordered:
      true,

    mode:
      "api",

    providerOrderId,
  };
}
