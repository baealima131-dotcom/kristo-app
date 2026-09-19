import {
  buildKristoRequestHeaders,
} from "@/src/lib/kristoHeaders";

const API_BASE = String(
  process.env.EXPO_PUBLIC_API_BASE ||
    "https://kristo-app.vercel.app"
)
  .trim()
  .replace(/\/+$/, "");

export type SokoSourcingPriority =
  | "low"
  | "normal"
  | "high"
  | "urgent";

export type SokoPurchaseMode =
  | "to_be_purchased"
  | "already_purchased";

export type SokoPurchaseStatus =
  | "not_purchased"
  | "recommendation_submitted"
  | "approved"
  | "purchased";


export type SokoSourcingTask = {
  id: string;

  sellerUserId: string;

  productName: string;
  category: string;

  targetQuantity: number;
  targetUnitCost: number;

  priority:
    SokoSourcingPriority;

  neededBy:
    string | null;

  taskNotes: string;

  purchaseMode:
    SokoPurchaseMode;

  purchaseStatus:
    SokoPurchaseStatus;

  purchaseSupplierName: string;

  actualUnitCost: number;

  totalPaid: number;

  purchaseDate:
    string | null;

  purchaseOrderReference: string;

  purchaseTrackingNumber: string;

  ownerPurchaseApprovedAt:
    string | null;

  workerPurchaseVerifiedAt:
    string | null;

  workerPurchaseVerifiedByUserId:
    string;

  selectedSupplierId:
    string | null;

  supplierName: string;
  supplierContact: string;
  supplierCode: string;

  quantity: number;
  unitCost: number;

  sourcingNotes: string;

  currentStage:
    | "supply"
    | "setup"
    | "costing"
    | "payments"
    | "review";

  supplyStatus:
    | "working"
    | "sent"
    | "returned";

  createdAt: string;
  updatedAt: string;
};

export type SokoSupplier = {
  id: string;

  sellerUserId: string;

  name: string;
  category: string;

  websiteUrl: string;

  searchUrlTemplate:
    string;

  availabilityUrlTemplate:
    string;

  country: string;
  contact: string;

  moq: number;

  leadTime: string;

  verified: boolean;
  active: boolean;

  createdAt: string;
  updatedAt: string;
};

async function readJson(
  response: Response
) {
  const text =
    await response.text();

  if (!text) return {};

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      `Invalid server response (${response.status})`
    );
  }
}

export async function
fetchSokoSourcingTasks(
  sellerUserId: string
) {
  const path =
    `/api/soko/work/tasks?sellerUserId=${encodeURIComponent(
      sellerUserId
    )}`;

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoSourcingSmartApi"
          ),
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not load sourcing tasks."
      )
    );
  }

  return {
    categories:
      Array.isArray(
        data?.categories
      )
        ? data.categories as
            string[]
        : [],

    tasks:
      Array.isArray(
        data?.tasks
      )
        ? data.tasks as
            SokoSourcingTask[]
        : [],
  };
}

export async function
fetchSokoSuppliers(
  input: {
    sellerUserId: string;
    category?: string;
  }
) {
  const query =
    new URLSearchParams();

  query.set(
    "sellerUserId",
    input.sellerUserId
  );

  if (
    input.category
  ) {
    query.set(
      "category",
      input.category
    );
  }

  const path =
    `/api/soko/work/suppliers?${query.toString()}`;

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoSourcingSmartApi"
          ),
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not load supplier list."
      )
    );
  }

  return {
    suppliers:
      Array.isArray(
        data?.suppliers
      )
        ? data.suppliers as
            SokoSupplier[]
        : [],
  };
}

export async function
createSokoSupplier(
  input: {
    sellerUserId: string;

    name: string;
    category: string;

    websiteUrl?: string;

    searchUrlTemplate?: string;

    availabilityUrlTemplate?: string;

    country?: string;
    contact?: string;

    moq?: number;

    leadTime?: string;
  }
) {
  const path =
    "/api/soko/work/suppliers";

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method: "POST",

        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            {
              "content-type":
                "application/json",
            },
            "sokoSourcingSmartApi"
          ),

        body:
          JSON.stringify(
            input
          ),
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false ||
    !data?.supplier
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not add supplier."
      )
    );
  }

  return data.supplier as
    SokoSupplier;
}

export function
buildSupplierSearchUrl(
  supplier:
    SokoSupplier,
  productName: string
) {
  const query =
    encodeURIComponent(
      productName.trim()
    );

  const template =
    String(
      supplier.searchUrlTemplate ||
        ""
    ).trim();

  if (template) {
    return template.replace(
      /\{query\}/gi,
      query
    );
  }

  const website =
    String(
      supplier.websiteUrl ||
        ""
    ).trim();

  return website;
}

export type AlibabaProductPreview = {
  found: boolean;
  productUrl: string;
  productId: string;
  sku: string;
  title: string;
  description: string;
  supplierName: string;
  currency: string;
  priceMin: number;
  priceMax: number;
  moq: number;
  imageUrl: string;
  images: string[];
  specifications: Array<{
    name: string;
    value: string;
  }>;
  variants: Array<{
    name: string;
    values: string[];
  }>;
  source: string;
};

export function
isHttpsAlibabaUrl(
  raw: string
) {
  try {
    const url =
      new URL(
        String(raw || "").trim()
      );

    const host =
      url.hostname
        .trim()
        .toLowerCase();

    return (
      url.protocol ===
        "https:" &&
      (
        host ===
          "alibaba.com" ||
        host.endsWith(
          ".alibaba.com"
        )
      )
    );
  } catch {
    return false;
  }
}

export function
buildAlibabaExternalSearchUrl(
  input: {
    productName: string;
    category?: string;
    quantity?: number;
  }
) {
  const parts = [
    String(
      input.productName || ""
    ).trim(),
    String(
      input.category || ""
    ).trim(),
  ].filter(Boolean);

  const quantity =
    Number(
      input.quantity
    );

  if (
    Number.isFinite(quantity) &&
    quantity > 0
  ) {
    parts.push(
      String(quantity)
    );
  }

  const query =
    parts.join(" ").trim();

  return (
    "https://www.alibaba.com/trade/search" +
    `?SearchText=${encodeURIComponent(
      query
    )}`
  );
}

export async function
fetchAlibabaProductPreview(
  productUrl: string
): Promise<AlibabaProductPreview> {
  const url =
    String(productUrl || "").trim();

  if (!isHttpsAlibabaUrl(url)) {
    throw new Error(
      "Paste an HTTPS Alibaba product link."
    );
  }

  const query =
    new URLSearchParams();

  query.set("url", url);

  const path =
    `/api/soko/supply/product-preview?${query.toString()}`;

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoSourcingSmartApi"
          ),
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not preview this Alibaba product link."
      )
    );
  }

  const images =
    Array.isArray(
      data?.images
    )
      ? data.images
          .map(
            (value: unknown) =>
              String(
                value || ""
              ).trim()
          )
          .filter(Boolean)
      : [];

  const imageUrl =
    String(
      data?.imageUrl ||
        data?.mainImage ||
        images[0] ||
        ""
    ).trim();

  return {
    found:
      Boolean(
        data?.found
      ),

    productUrl:
      String(
        data?.productUrl ||
          url
      ).trim(),

    productId:
      String(
        data?.productId ||
          ""
      ).trim(),

    sku:
      String(
        data?.sku ||
          ""
      ).trim(),

    title:
      String(
        data?.title ||
          ""
      ).trim(),

    description:
      String(
        data?.description ||
          ""
      ).trim(),

    supplierName:
      String(
        data?.supplierName ||
          ""
      ).trim(),

    currency:
      String(
        data?.currency ||
          ""
      ).trim(),

    priceMin:
      Number(
        data?.priceMin
      ) || 0,

    priceMax:
      Number(
        data?.priceMax
      ) || 0,

    moq:
      Number(
        data?.moq
      ) || 0,

    imageUrl,

    images,

    specifications:
      Array.isArray(
        data?.specifications
      )
        ? data.specifications
            .map(
              (row: {
                name?: unknown;
                value?: unknown;
              }) => ({
                name:
                  String(
                    row?.name ||
                      ""
                  ).trim(),
                value:
                  String(
                    row?.value ||
                      ""
                  ).trim(),
              })
            )
            .filter(
              (row: {
                name: string;
                value: string;
              }) =>
                Boolean(
                  row.name &&
                  row.value
                )
            )
        : [],

    variants:
      Array.isArray(
        data?.variants
      )
        ? data.variants
            .map(
              (row: {
                name?: unknown;
                values?: unknown;
              }) => ({
                name:
                  String(
                    row?.name ||
                      ""
                  ).trim(),
                values:
                  Array.isArray(
                    row?.values
                  )
                    ? row.values
                        .map(
                          (
                            value: unknown
                          ) =>
                            String(
                              value ||
                                ""
                            ).trim()
                        )
                        .filter(
                          Boolean
                        )
                    : [],
              })
            )
            .filter(
              (row: {
                name: string;
                values: string[];
              }) =>
                Boolean(
                  row.name
                )
            )
        : [],

    source:
      String(
        data?.source ||
          ""
      ).trim(),
  };
}
