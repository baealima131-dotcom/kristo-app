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
  resolveSokoSetupAccess,
} from "@/app/api/_lib/store/sokoSupplyAccess";

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

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const MAX_REQUEST_BYTES =
  MAX_IMAGE_BYTES +
  256 * 1024;

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
    const requestedSellerUserId =
      String(
        req.nextUrl
          .searchParams
          .get(
            "sellerUserId"
          ) || ""
      ).trim();

    const access =
      await resolveSokoSetupAccess(
        auth.viewer.userId,
        requestedSellerUserId
      );

    if (
      !getVideoStorageConfig() &&
      !localSokoImagesEnabled()
    ) {
      return reply(
        {
          ok: false,

          error:
            "SOKO image storage is not configured on the server.",

          code:
            "SOKO_IMAGE_STORAGE_MISSING",
        },
        503
      );
    }

    const contentType =
      req.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType
        .toLowerCase()
        .startsWith(
          "multipart/form-data;"
        )
    ) {
      return reply(
        {
          ok: false,

          error:
            "Expected multipart/form-data.",
        },
        400
      );
    }

    if (!req.body) {
      return reply(
        {
          ok: false,

          error:
            "Image body is required.",
        },
        400
      );
    }

    const reader =
      req.body.getReader();

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
          MAX_REQUEST_BYTES
        ) {
          await reader.cancel();

          return reply(
            {
              ok: false,

              error:
                "Image upload is too large.",
            },
            413
          );
        }

        chunks.push(
          part.value
        );
      }
    } finally {
      reader.releaseLock();
    }

    const form =
      await new Response(
        Buffer.concat(
          chunks
        ),
        {
          headers: {
            "content-type":
              contentType,
          },
        }
      ).formData();

    const files =
      form.getAll(
        "file"
      );

    if (
      files.length !== 1 ||
      !(
        files[0] instanceof
          File
      )
    ) {
      return reply(
        {
          ok: false,

          error:
            "Send exactly one image in the file field.",
        },
        400
      );
    }

    const file =
      files[0];

    if (
      file.size < 1 ||
      file.size >
        MAX_IMAGE_BYTES
    ) {
      return reply(
        {
          ok: false,

          error:
            "Image must be between 1 byte and 8 MB.",
        },
        413
      );
    }

    const bytes =
      Buffer.from(
        await file.arrayBuffer()
      );

    const format =
      imageFormat(
        bytes
      );

    if (!format) {
      return reply(
        {
          ok: false,

          error:
            "Use a JPEG, PNG or WebP image.",
        },
        415
      );
    }

    /*
     * IMPORTANT:
     * Store the worker's image under the SELLER owner,
     * not under the Level 02 worker.
     *
     * This lets the final SOKO product verify the key
     * with the seller account later.
     */
    const owner =
      sokoImageOwner(
        access.sellerUserId
      );

    const useObjectStorage =
      Boolean(
        getVideoStorageConfig()
      );

    const key =
      (
        useObjectStorage
          ? "uploads"
          : "local"
      ) +
      "/soko-products/" +
      owner +
      "/" +
      randomUUID() +
      "." +
      format.extension;

    let uploaded: {
      key: string;
      publicUrl: string;
    };

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
          "Could not create image filename."
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
        bytes,
        {
          flag:
            "wx",
        }
      );

      uploaded = {
        key,

        publicUrl:
          sokoImageUrl(
            key
          ),
      };
    } else {
      uploaded =
        await uploadBufferToStorage({
          key,

          body:
            bytes,

          contentType:
            format.mime,
        });
    }

    return reply(
      {
        ok: true,

        sellerUserId:
          access.sellerUserId,

        image: {
          key:
            uploaded.key,

          url:
            uploaded.publicUrl,

          mime:
            format.mime,

          size:
            bytes.length,
        },
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
              "Could not upload Level 02 product image."
          ),
      },
      Number(
        error?.status
      ) || 400
    );
  }
}
