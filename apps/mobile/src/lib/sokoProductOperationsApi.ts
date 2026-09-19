import {
  buildKristoRequestHeaders,
} from "@/src/lib/kristoHeaders";

const API_BASE = String(
  process.env.EXPO_PUBLIC_API_BASE ||
    "https://kristo-app.vercel.app"
)
  .trim()
  .replace(/\/+$/, "");

export type SokoSupplyStatus =
  | "working"
  | "sent"
  | "returned";

export type SokoProductOperation = {
  id: string;

  sellerUserId: string;

  supplierName: string;
  supplierContact: string;

  productName: string;
  supplierCode: string;

  quantity: number;
  unitCost: number;

  notes: string;

  currentStage:
    | "supply"
    | "setup"
    | "costing"
    | "payments"
    | "review";

  supplyStatus:
    SokoSupplyStatus;

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
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid server response (${response.status})`
    );
  }
}

export async function
fetchSokoSupplyOperations(
  sellerUserId: string
) {
  const query =
    sellerUserId
      ? `?sellerUserId=${encodeURIComponent(
          sellerUserId
        )}`
      : "";

  const path =
    `/api/soko/work/operations${query}`;

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoProductOperationsApi"
          ),
      }
    );

  const data =
    await readJson(response);

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not load SOKO work queue."
      )
    );
  }

  return {
    sellerUserId:
      String(
        data?.sellerUserId || ""
      ),

    operations:
      Array.isArray(
        data?.operations
      )
        ? data.operations as
            SokoProductOperation[]
        : [],
  };
}

export async function
saveSokoSupplyOperation(
  input: {
    sellerUserId: string;

    operationId?: string;

    supplierName: string;
    supplierContact?: string;

    productName: string;
    supplierCode?: string;

    quantity?: number;
    unitCost?: number;

    notes?: string;

    mode:
      | "working"
      | "recommendation"
      | "verify_purchase"
      | "sent";
  }
) {
  const path =
    "/api/soko/work/operations";

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
            "sokoProductOperationsApi"
          ),

        body:
          JSON.stringify(input),
      }
    );

  const data =
    await readJson(response);

  if (
    !response.ok ||
    data?.ok === false ||
    !data?.operation
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not save SOKO work."
      )
    );
  }

  return data.operation as
    SokoProductOperation;
}

export async function
deleteSokoSupplyOperation(
  input: {
    sellerUserId: string;
    operationId: string;
  }
) {
  const path =
    "/api/soko/work/operations";

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method: "DELETE",

        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            {
              "content-type":
                "application/json",
            },
            "sokoProductOperationsApi"
          ),

        body:
          JSON.stringify(input),
      }
    );

  const data =
    await readJson(response);

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not delete SOKO draft."
      )
    );
  }

  return data.operation as
    SokoProductOperation;
}


/* ==================================================
 * LEVEL 02 · PRODUCT SETUP
 * Kristo App worker client
 * ================================================== */

export type SokoSetupImportedProduct = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  supplierName: string;
  sku: string;
  currency: string;
  priceMin: number;
  priceMax: number;
  moq: number;

  imageKeys: string[];
  mainImageKey: string;

  images: string[];
  mainImage: string;

  specifications: Array<{
    name: string;
    value: string;
  }>;

  variants: Array<{
    name: string;
    values: string[];
  }>;
};

export type SokoSetupOperation =
  SokoProductOperation & {
    setupStatus:
      | ""
      | "working"
      | "sent"
      | "returned";

    listingTitle: string;
    model: string;
    sku: string;
    colors: string;
    sizes: string;
    description: string;
    setupNotes: string;

    addedImageKeys: string[];
    photoKeys: string[];
    mainImageKey: string;

    addedImages: string[];
    finalImages: string[];
    mainImage: string;

    imported:
      | SokoSetupImportedProduct
      | null;
  };

export type SokoSetupUploadedImage = {
  key: string;
  url: string;
  mime: string;
  size: number;
};

function absoluteSokoImageUrl(
  value: unknown
) {
  const raw =
    String(
      value || ""
    ).trim();

  if (!raw) {
    return "";
  }

  return raw.startsWith("/")
    ? API_BASE + raw
    : raw;
}

function normalizeSetupImport(
  raw: any
): SokoSetupImportedProduct | null {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  return {
    id:
      String(
        raw?.id || ""
      ),

    taskId:
      String(
        raw?.taskId || ""
      ),

    title:
      String(
        raw?.title || ""
      ),

    description:
      String(
        raw?.description || ""
      ),

    supplierName:
      String(
        raw?.supplierName || ""
      ),

    sku:
      String(
        raw?.sku || ""
      ),

    currency:
      String(
        raw?.currency ||
          "USD"
      ),

    priceMin:
      Number(
        raw?.priceMin || 0
      ),

    priceMax:
      Number(
        raw?.priceMax || 0
      ),

    moq:
      Number(
        raw?.moq || 0
      ),

    imageKeys:
      Array.isArray(
        raw?.imageKeys
      )
        ? raw.imageKeys
            .map(
              (
                value: unknown
              ) =>
                String(
                  value || ""
                ).trim()
            )
            .filter(Boolean)
        : [],

    mainImageKey:
      String(
        raw?.mainImageKey ||
          ""
      ),

    images:
      Array.isArray(
        raw?.images
      )
        ? raw.images
            .map(
              (
                value: unknown
              ) =>
                absoluteSokoImageUrl(
                  value
                )
            )
            .filter(Boolean)
        : [],

    mainImage:
      absoluteSokoImageUrl(
        raw?.mainImage
      ),

    specifications:
      Array.isArray(
        raw?.specifications
      )
        ? raw.specifications
        : [],

    variants:
      Array.isArray(
        raw?.variants
      )
        ? raw.variants
        : [],
  };
}

function normalizeSetupOperation(
  raw: any
): SokoSetupOperation {
  return {
    id:
      String(
        raw?.id || ""
      ),

    sellerUserId:
      String(
        raw?.sellerUserId ||
          ""
      ),

    supplierName:
      String(
        raw?.supplierName ||
          ""
      ),

    supplierContact:
      String(
        raw?.supplierContact ||
          ""
      ),

    productName:
      String(
        raw?.productName ||
          ""
      ),

    supplierCode:
      String(
        raw?.supplierCode ||
          ""
      ),

    quantity:
      Number(
        raw?.quantity || 0
      ),

    unitCost:
      Number(
        raw?.unitCost || 0
      ),

    notes:
      String(
        raw?.notes || ""
      ),

    currentStage:
      raw?.currentStage,

    supplyStatus:
      raw?.supplyStatus,

    createdAt:
      String(
        raw?.createdAt || ""
      ),

    updatedAt:
      String(
        raw?.updatedAt || ""
      ),

    setupStatus:
      String(
        raw?.setupStatus || ""
      ) as
        | ""
        | "working"
        | "sent"
        | "returned",

    listingTitle:
      String(
        raw?.listingTitle || ""
      ),

    model:
      String(
        raw?.model || ""
      ),

    sku:
      String(
        raw?.sku || ""
      ),

    colors:
      String(
        raw?.colors || ""
      ),

    sizes:
      String(
        raw?.sizes || ""
      ),

    description:
      String(
        raw?.description || ""
      ),

    setupNotes:
      String(
        raw?.setupNotes || ""
      ),

    addedImageKeys:
      Array.isArray(
        raw?.addedImageKeys
      )
        ? raw.addedImageKeys
            .map(
              (
                value: unknown
              ) =>
                String(
                  value || ""
                ).trim()
            )
            .filter(Boolean)
        : [],

    photoKeys:
      Array.isArray(
        raw?.photoKeys
      )
        ? raw.photoKeys
            .map(
              (
                value: unknown
              ) =>
                String(
                  value || ""
                ).trim()
            )
            .filter(Boolean)
        : [],

    mainImageKey:
      String(
        raw?.mainImageKey || ""
      ),

    addedImages:
      Array.isArray(
        raw?.addedImages
      )
        ? raw.addedImages
            .map(
              (
                value: unknown
              ) =>
                absoluteSokoImageUrl(
                  value
                )
            )
            .filter(Boolean)
        : [],

    finalImages:
      Array.isArray(
        raw?.finalImages
      )
        ? raw.finalImages
            .map(
              (
                value: unknown
              ) =>
                absoluteSokoImageUrl(
                  value
                )
            )
            .filter(Boolean)
        : [],

    mainImage:
      absoluteSokoImageUrl(
        raw?.mainImage
      ),

    imported:
      normalizeSetupImport(
        raw?.imported
      ),
  };
}

export async function
fetchSokoSetupOperations(
  sellerUserId: string
) {
  const query =
    sellerUserId
      ? `?sellerUserId=${encodeURIComponent(
          sellerUserId
        )}`
      : "";

  const path =
    `/api/soko/work/setup${query}`;

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoProductOperationsApi.setup"
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
          "Could not load Level 02 workspace."
      )
    );
  }

  return {
    sellerUserId:
      String(
        data?.sellerUserId || ""
      ),

    access:
      String(
        data?.access || ""
      ),

    items:
      Array.isArray(
        data?.items
      )
        ? data.items.map(
            normalizeSetupOperation
          )
        : [],
  };
}

export async function
saveSokoSetupOperation(
  input: {
    sellerUserId: string;

    operationId: string;

    listingTitle: string;
    model?: string;
    sku?: string;
    colors?: string;
    sizes?: string;
    description: string;
    setupNotes?: string;

    addedImageKeys?: string[];

    photoKeys: string[];

    mainImageKey?: string;

    mode:
      | "working"
      | "sent";
  }
) {
  const path =
    "/api/soko/work/setup";

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method:
          "POST",

        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            {
              "content-type":
                "application/json",
            },
            "sokoProductOperationsApi.setup"
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
    !data?.operation
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not save Level 02 work."
      )
    );
  }

  return normalizeSetupOperation({
    ...data.operation,

    imported:
      data?.imported ||
      null,
  });
}

export async function
uploadSokoSetupImage(
  input: {
    sellerUserId: string;
    uri: string;
  }
): Promise<
  SokoSetupUploadedImage
> {
  const uri =
    String(
      input.uri || ""
    ).trim();

  if (
    !/^(file|content):/i.test(
      uri
    )
  ) {
    throw new Error(
      "Choose a photo from this device."
    );
  }

  const query =
    `?sellerUserId=${encodeURIComponent(
      input.sellerUserId
    )}`;

  const path =
    `/api/soko/work/setup/product-images${query}`;

  const form =
    new FormData();

  form.append(
    "file",
    {
      uri,

      name:
        "level02-product.jpg",

      type:
        "image/jpeg",
    } as unknown as Blob
  );

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method:
          "POST",

        headers:
          buildKristoRequestHeaders(
            path,
            undefined,
            undefined,
            "sokoProductOperationsApi.setupImage"
          ),

        body:
          form,
      }
    );

  const data =
    await readJson(
      response
    );

  if (
    !response.ok ||
    data?.ok === false ||
    !data?.image?.key
  ) {
    throw new Error(
      String(
        data?.error ||
          "Could not upload Level 02 photo."
      )
    );
  }

  return {
    key:
      String(
        data.image.key
      ),

    url:
      absoluteSokoImageUrl(
        data.image.url
      ),

    mime:
      String(
        data.image.mime || ""
      ),

    size:
      Number(
        data.image.size || 0
      ),
  };
}
