import {
  randomUUID,
} from "node:crypto";

import fs from "node:fs/promises";

import path from "node:path";

import type {
  NextRequest,
} from "next/server";

import {
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  resolveSokoSupplyAccess,
} from "@/app/api/_lib/store/sokoSupplyAccess";

import {
  dbListSokoSourcingTasks,
} from "@/app/api/_lib/store/sokoSourcingSmartDb";

import {
  dbGetSokoSupplyImport,
  dbUpsertSokoSupplyImport,
} from "@/app/api/_lib/store/sokoSupplyImportDb";

import {
  localSokoImagesEnabled,
  localSokoImageRoot,
  sokoImageOwner,
  sokoImageUrl,
} from "@/app/api/_lib/sokoProductImages";

import {
  getVideoStorageConfig,
  uploadBufferToStorage,
} from "@/app/api/_lib/media/objectStorage";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const revalidate =
  0;

const MAX_IMAGES =
  20;

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const MAX_TOTAL_BYTES =
  80 * 1024 * 1024;

function reply(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        "Cache-Control":
          "private, no-store",
      },
    }
  );
}

function allowedImageHost(
  hostname: string
) {
  const host =
    hostname
      .trim()
      .toLowerCase();

  return (
    host ===
      "alicdn.com" ||
    host.endsWith(
      ".alicdn.com"
    ) ||
    host ===
      "alibaba.com" ||
    host.endsWith(
      ".alibaba.com"
    ) ||
    host ===
      "alibabausercontent.com" ||
    host.endsWith(
      ".alibabausercontent.com"
    )
  );
}

function parseImageUrl(
  raw: unknown
) {
  let url: URL;

  try {
    url =
      new URL(
        String(
          raw || ""
        ).trim()
      );
  } catch {
    throw new Error(
      "Invalid Alibaba product image URL."
    );
  }

  if (
    url.protocol !==
      "https:" ||
    !allowedImageHost(
      url.hostname
    )
  ) {
    throw new Error(
      "Only approved Alibaba product images can be imported."
    );
  }

  return url;
}

function imageFormat(
  bytes: Buffer
) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return {
      extension:
        "jpg",
      mime:
        "image/jpeg",
    };
  }

  if (
    bytes.length >= 8 &&
    bytes
      .subarray(
        0,
        8
      )
      .equals(
        Buffer.from([
          137,
          80,
          78,
          71,
          13,
          10,
          26,
          10,
        ])
      )
  ) {
    return {
      extension:
        "png",
      mime:
        "image/png",
    };
  }

  if (
    bytes.length >= 12 &&
    bytes.toString(
      "ascii",
      0,
      4
    ) === "RIFF" &&
    bytes.toString(
      "ascii",
      8,
      12
    ) === "WEBP"
  ) {
    return {
      extension:
        "webp",
      mime:
        "image/webp",
    };
  }

  return null;
}

async function readLimitedImage(
  response: Response
) {
  if (!response.body) {
    throw new Error(
      "Alibaba image response was empty."
    );
  }

  const contentLength =
    Number(
      response.headers.get(
        "content-length"
      ) || 0
    );

  if (
    Number.isFinite(
      contentLength
    ) &&
    contentLength >
      MAX_IMAGE_BYTES
  ) {
    throw new Error(
      "Alibaba image is too large."
    );
  }

  const reader =
    response.body.getReader();

  const chunks:
    Uint8Array[] = [];

  let total = 0;

  try {
    while (true) {
      const part =
        await reader.read();

      if (
        part.done
      ) {
        break;
      }

      total +=
        part.value.byteLength;

      if (
        total >
        MAX_IMAGE_BYTES
      ) {
        await reader.cancel();

        throw new Error(
          "Alibaba image is too large."
        );
      }

      chunks.push(
        part.value
      );
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks
  );
}

async function fetchAlibabaImage(
  rawUrl: string
) {
  let current =
    parseImageUrl(
      rawUrl
    );

  for (
    let redirects = 0;
    redirects < 5;
    redirects += 1
  ) {
    const response =
      await fetch(
        current.toString(),
        {
          redirect:
            "manual",

          cache:
            "no-store",

          headers: {
            Accept:
              "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5",

            Referer:
              "https://www.alibaba.com/",

            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
          },
        }
      );

    if (
      response.status >=
        300 &&
      response.status <
        400
    ) {
      const location =
        response.headers.get(
          "location"
        );

      if (!location) {
        throw new Error(
          "Alibaba image redirect was invalid."
        );
      }

      current =
        parseImageUrl(
          new URL(
            location,
            current
          ).toString()
        );

      continue;
    }

    if (!response.ok) {
      throw new Error(
        `Alibaba image returned HTTP ${response.status}.`
      );
    }

    const bytes =
      await readLimitedImage(
        response
      );

    const format =
      imageFormat(
        bytes
      );

    if (!format) {
      throw new Error(
        "Alibaba image format is not supported."
      );
    }

    return {
      sourceUrl:
        rawUrl,

      bytes,

      format,
    };
  }

  throw new Error(
    "Too many Alibaba image redirects."
  );
}

async function storeImage(
  sellerUserId: string,
  sourceUrl: string
) {
  const downloaded =
    await fetchAlibabaImage(
      sourceUrl
    );

  const owner =
    sokoImageOwner(
      sellerUserId
    );

  const storageConfigured =
    Boolean(
      getVideoStorageConfig()
    );

  if (
    !storageConfigured &&
    !localSokoImagesEnabled()
  ) {
    throw new Error(
      "SOKO image storage is not configured."
    );
  }

  const key =
    (
      storageConfigured
        ? "uploads"
        : "local"
    ) +
    "/soko-products/" +
    owner +
    "/" +
    randomUUID() +
    "." +
    downloaded.format.extension;

  if (
    key.startsWith(
      "local/"
    )
  ) {
    const filename =
      key
        .split("/")
        .pop();

    if (!filename) {
      throw new Error(
        "Could not create SOKO image filename."
      );
    }

    const directory =
      path.join(
        localSokoImageRoot(),
        owner
      );

    await fs.mkdir(
      directory,
      {
        recursive:
          true,
      }
    );

    await fs.writeFile(
      path.join(
        directory,
        filename
      ),
      downloaded.bytes,
      {
        flag:
          "wx",
      }
    );

    return {
      sourceUrl,

      key,

      url:
        sokoImageUrl(
          key
        ),

      size:
        downloaded.bytes.length,
    };
  }

  const uploaded =
    await uploadBufferToStorage({
      key,

      body:
        downloaded.bytes,

      contentType:
        downloaded.format.mime,
    });

  return {
    sourceUrl,

    key:
      uploaded.key,

    url:
      uploaded.publicUrl,

    size:
      downloaded.bytes.length,
  };
}

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
      NextResponse
  ) {
    return auth;
  }

  try {
    const taskId =
      String(
        req.nextUrl
          .searchParams
          .get(
            "taskId"
          ) || ""
      ).trim();

    if (!taskId) {
      return reply(
        {
          ok: false,
          error:
            "taskId is required.",
        },
        400
      );
    }

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        String(
          req.nextUrl
            .searchParams
            .get(
              "sellerUserId"
            ) || ""
        )
      );

    const imported =
      await dbGetSokoSupplyImport(
        access.sellerUserId,
        taskId
      );

    return reply({
      ok: true,
      sellerUserId:
        access.sellerUserId,
      imported,
    });
  } catch (
    error: any
  ) {
    return reply(
      {
        ok: false,
        error:
          String(
            error?.message ||
            "Could not load imported product."
          ),
      },
      Number(
        error?.status
      ) || 400
    );
  }
}

export async function POST(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
      NextResponse
  ) {
    return auth;
  }

  try {
    const body =
      await req
        .json()
        .catch(
          () => ({})
        );

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        String(
          body?.sellerUserId ||
          ""
        )
      );

    const taskId =
      String(
        body?.taskId ||
        ""
      ).trim();

    if (!taskId) {
      return reply(
        {
          ok: false,
          error:
            "taskId is required.",
        },
        400
      );
    }

    const tasks =
      await dbListSokoSourcingTasks(
        access.sellerUserId
      );

    const task =
      tasks.find(
        (row) =>
          row.id ===
          taskId
      );

    if (!task) {
      return reply(
        {
          ok: false,
          error:
            "Sourcing task not found.",
        },
        404
      );
    }

    const rawImages =
      Array.isArray(
        body?.images
      )
        ? body.images
        : [];

    const mainImage =
      String(
        body?.mainImage ||
        ""
      ).trim();

    const orderedImages = [
      mainImage,
      ...rawImages,
    ]
      .map(
        (value) =>
          String(
            value ||
            ""
          ).trim()
      )
      .filter(Boolean);

    const sourceImages = [
      ...new Set(
        orderedImages
      ),
    ].slice(
      0,
      MAX_IMAGES
    );

    if (
      sourceImages.length <
      1
    ) {
      return reply(
        {
          ok: false,
          error:
            "Choose at least one Alibaba product image.",
        },
        400
      );
    }

    const stored:
      Array<{
        sourceUrl: string;
        key: string;
        url: string;
        size: number;
      }> = [];

    const skipped:
      Array<{
        sourceUrl: string;
        error: string;
      }> = [];

    let totalBytes = 0;

    for (
      const sourceUrl
      of sourceImages
    ) {
      try {
        const image =
          await storeImage(
            access.sellerUserId,
            sourceUrl
          );

        totalBytes +=
          image.size;

        if (
          totalBytes >
          MAX_TOTAL_BYTES
        ) {
          throw new Error(
            "Imported product images exceed the total size limit."
          );
        }

        stored.push(
          image
        );
      } catch (
        error: any
      ) {
        skipped.push({
          sourceUrl,

          error:
            String(
              error?.message ||
              "Could not import this image."
            ),
        });
      }
    }

    if (
      stored.length <
      1
    ) {
      return reply(
        {
          ok: false,
          error:
            "No Alibaba product images could be saved to SOKO.",
          skipped,
        },
        422
      );
    }

    const storedMain =
      stored.find(
        (row) =>
          row.sourceUrl ===
          mainImage
      ) ||
      stored[0];

    const imported =
      await dbUpsertSokoSupplyImport({
        sellerUserId:
          access.sellerUserId,

        taskId,

        actorUserId:
          auth.viewer.userId,

        provider:
          "alibaba",

        providerProductId:
          String(
            body?.productId ||
            ""
          ),

        productUrl:
          String(
            body?.productUrl ||
            ""
          ),

        title:
          String(
            body?.title ||
            task.productName ||
            ""
          ),

        description:
          String(
            body?.description ||
            ""
          ),

        supplierName:
          String(
            body?.supplierName ||
            ""
          ),

        currency:
          String(
            body?.currency ||
            "USD"
          ),

        priceMin:
          Number(
            body?.priceMin ||
            0
          ),

        priceMax:
          Number(
            body?.priceMax ||
            0
          ),

        moq:
          Number(
            body?.moq ||
            0
          ),

        sku:
          String(
            body?.sku ||
            ""
          ),

        imageKeys:
          stored.map(
            (row) =>
              row.key
          ),

        mainImageKey:
          storedMain.key,

        sourceImageUrls:
          sourceImages,

        specifications:
          Array.isArray(
            body?.specifications
          )
            ? body.specifications
            : [],

        variants:
          Array.isArray(
            body?.variants
          )
            ? body.variants
            : [],
      });

    return reply(
      {
        ok: true,

        imported,

        savedImages:
          stored.length,

        skippedImages:
          skipped.length,

        skipped,
      },
      201
    );
  } catch (
    error: any
  ) {
    return reply(
      {
        ok: false,

        error:
          String(
            error?.message ||
            "Could not save Alibaba product to SOKO."
          ),
      },
      Number(
        error?.status
      ) || 400
    );
  }
}
