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
  dbListSokoSetupOperations,
  dbSaveSokoSetupOperation,
} from "@/app/api/_lib/store/sokoProductOperationsDb";

import {
  dbGetSokoSupplyImport,
} from "@/app/api/_lib/store/sokoSupplyImportDb";

import {
  sokoImageUrl,
} from "@/app/api/_lib/sokoProductImages";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const revalidate =
  0;

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
          "private, no-store, no-cache, must-revalidate",
      },
    }
  );
}

function fail(
  error: any
) {
  return reply(
    {
      ok: false,

      error:
        String(
          error?.message ||
            "Level 02 operation failed"
        ),
    },
    Number(
      error?.status
    ) || 400
  );
}

function decorateSetupOperation(
  operation: any
) {
  const addedImageKeys =
    Array.isArray(
      operation?.addedImageKeys
    )
      ? operation.addedImageKeys
      : [];

  const photoKeys =
    Array.isArray(
      operation?.photoKeys
    )
      ? operation.photoKeys
      : [];

  const mainImageKey =
    String(
      operation?.mainImageKey ||
        ""
    );

  return {
    ...operation,

    addedImages:
      addedImageKeys.map(
        (key: string) =>
          sokoImageUrl(key)
      ),

    finalImages:
      photoKeys.map(
        (key: string) =>
          sokoImageUrl(key)
      ),

    mainImage:
      mainImageKey
        ? sokoImageUrl(
            mainImageKey
          )
        : "",
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

    const operations =
      await dbListSokoSetupOperations(
        access.sellerUserId
      );

    const items =
      await Promise.all(
        operations.map(
          async (
            operation
          ) => {
            const imported =
              await dbGetSokoSupplyImport(
                access.sellerUserId,
                operation.id
              ).catch(
                () => null
              );

            return {
              ...decorateSetupOperation(
                operation
              ),

              imported,
            };
          }
        )
      );

    return reply({
      ok: true,

      sellerUserId:
        access.sellerUserId,

      access:
        access.access,

      items,
    });
  } catch (
    error: any
  ) {
    return fail(error);
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

  const body =
    await req
      .json()
      .catch(
        () => ({})
      );

  try {
    const access =
      await resolveSokoSetupAccess(
        auth.viewer.userId,

        String(
          body?.sellerUserId ||
            ""
        )
      );

    const operationId =
      String(
        body?.operationId ||
          ""
      ).trim();

    if (!operationId) {
      return reply(
        {
          ok: false,

          error:
            "Level 02 product ID is required.",
        },
        400
      );
    }

    const imported =
      await dbGetSokoSupplyImport(
        access.sellerUserId,
        operationId
      ).catch(
        () => null
      );

    const importedKeys =
      Array.isArray(
        imported?.imageKeys
      )
        ? imported!.imageKeys
        : [];

    const cleanStringArray = (
      value: unknown,
      limit: number
    ): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }

      const cleaned =
        value
          .map(
            (item: unknown) =>
              String(
                item || ""
              ).trim()
          )
          .filter(
            (item: string) =>
              item.length > 0
          );

      return Array.from(
        new Set<string>(
          cleaned
        )
      ).slice(
        0,
        limit
      );
    };

    const addedImageKeys:
      string[] =
        cleanStringArray(
          body?.addedImageKeys,
          20
        );

    const photoKeys:
      string[] =
        cleanStringArray(
          body?.photoKeys,
          8
        );

    const allowedKeys =
      new Set([
        ...importedKeys,
        ...addedImageKeys,
      ]);

    if (
      photoKeys.some(
        (key) =>
          !allowedKeys.has(
            key
          )
      )
    ) {
      return reply(
        {
          ok: false,

          error:
            "Final photos must come from Imported Photos or My Photos.",
        },
        400
      );
    }

    const requestedMain =
      String(
        body?.mainImageKey ||
          ""
      ).trim();

    if (
      requestedMain &&
      !photoKeys.includes(
        requestedMain
      )
    ) {
      return reply(
        {
          ok: false,

          error:
            "Main photo must be included in the final 1–8 photos.",
        },
        400
      );
    }

    const listingTitle =
      String(
        body?.listingTitle ||
          imported?.title ||
          ""
      );

    const description =
      String(
        body?.description ||
          imported?.description ||
          ""
      );

    const sku =
      String(
        body?.sku ||
          imported?.sku ||
          ""
      );

    const mode =
      body?.mode ===
        "sent"
        ? "sent"
        : "working";

    const operation =
      await dbSaveSokoSetupOperation({
        sellerUserId:
          access.sellerUserId,

        actorUserId:
          auth.viewer.userId,

        operationId,

        listingTitle,

        model:
          String(
            body?.model ||
              ""
          ),

        sku,

        colors:
          String(
            body?.colors ||
              ""
          ),

        sizes:
          String(
            body?.sizes ||
              ""
          ),

        description,

        setupNotes:
          String(
            body?.setupNotes ||
              ""
          ),

        addedImageKeys,

        photoKeys,

        mainImageKey:
          requestedMain,

        mode,
      });

    return reply({
      ok: true,

      operation:
        decorateSetupOperation(
          operation
        ),

      imported,
    });
  } catch (
    error: any
  ) {
    return fail(error);
  }
}
