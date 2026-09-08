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
  dbListAcceptedSokoWorkforceAssignmentsForUser,
} from "@/app/api/_lib/store/sokoWorkforceDb";

import {
  dbCreateSokoWorkChatMessage,
  dbListSokoWorkChatMessages,
} from "@/app/api/_lib/store/sokoWorkChatDb";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const revalidate =
  0;

function clean(
  value: unknown,
  max = 4000
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function json(
  data: unknown,
  init?: ResponseInit
) {
  return NextResponse.json(
    data,
    {
      ...init,

      headers: {
        "Cache-Control":
          "private, no-store, no-cache, must-revalidate",

        ...(init?.headers || {}),
      },
    }
  );
}

async function resolveConversation(
  req: NextRequest,
  input: {
    sellerUserId: string;
    workerUserId?: string;
  }
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
    NextResponse
  ) {
    return {
      response: auth,
    } as const;
  }

  const viewerUserId =
    clean(
      auth.viewer.userId,
      180
    );

  const sellerUserId =
    clean(
      input.sellerUserId,
      180
    );

  if (!sellerUserId) {
    return {
      response:
        json(
          {
            ok: false,

            error:
              "sellerUserId is required",
          },
          {
            status: 400,
          }
        ),
    } as const;
  }

  try {
    const access =
      await resolveSokoSupplyAccess(
        viewerUserId,
        sellerUserId
      );

    /*
     * LEVEL 01 WORKER
     *
     * resolveSokoSupplyAccess already
     * proves this Kristo user has an
     * accepted supply assignment.
     */
    if (
      access.access ===
      "supply_worker"
    ) {
      return {
        viewerUserId,

        sellerUserId:
          access.sellerUserId,

        workerUserId:
          viewerUserId,

        role:
          "supply_worker" as const,
      };
    }

    /*
     * STORE OWNER
     *
     * Owner cannot invent any random
     * workerUserId. We verify that
     * worker has an accepted Level 01
     * assignment for this exact store.
     */
    const workerUserId =
      clean(
        input.workerUserId,
        180
      );

    if (!workerUserId) {
      return {
        response:
          json(
            {
              ok: false,

              error:
                "workerUserId is required for seller owner chat",
            },
            {
              status: 400,
            }
          ),
      } as const;
    }

    const assignments =
      await dbListAcceptedSokoWorkforceAssignmentsForUser(
        workerUserId
      );

    const assignment =
      assignments.find(
        (row) =>
          row.sellerUserId ===
            access.sellerUserId &&

          row.stage ===
            "supply" &&

          row.status ===
            "accepted"
      );

    if (!assignment) {
      return {
        response:
          json(
            {
              ok: false,

              error:
                "This user is not an active Level 01 worker for this store",
            },
            {
              status: 403,
            }
          ),
      } as const;
    }

    return {
      viewerUserId,

      sellerUserId:
        access.sellerUserId,

      workerUserId,

      role:
        "seller_owner" as const,
    };
  } catch (error: any) {
    const status =
      Number(
        error?.status || 403
      );

    return {
      response:
        json(
          {
            ok: false,

            error:
              String(
                error?.message ||
                  "SOKO work chat access denied"
              ),
          },
          {
            status:
              Number.isFinite(
                status
              )
                ? status
                : 403,
          }
        ),
    } as const;
  }
}

export async function GET(
  req: NextRequest
) {
  const url =
    new URL(
      req.url
    );

  const resolved =
    await resolveConversation(
      req,
      {
        sellerUserId:
          clean(
            url.searchParams.get(
              "sellerUserId"
            ),
            180
          ),

        workerUserId:
          clean(
            url.searchParams.get(
              "workerUserId"
            ),
            180
          ),
      }
    );

  if (
    "response" in resolved
  ) {
    return resolved.response;
  }

  try {
    const messages =
      await dbListSokoWorkChatMessages(
        {
          sellerUserId:
            resolved.sellerUserId,

          workerUserId:
            resolved.workerUserId,

          limit:
            Number(
              url.searchParams.get(
                "limit"
              ) || 150
            ),
        }
      );

    return json({
      ok: true,

      conversation: {
        sellerUserId:
          resolved.sellerUserId,

        workerUserId:
          resolved.workerUserId,

        role:
          resolved.role,
      },

      messages:
        messages.map(
          (message) => ({
            ...message,

            mine:
              message.senderUserId ===
              resolved.viewerUserId,
          })
        ),
    });
  } catch (error: any) {
    return json(
      {
        ok: false,

        error:
          String(
            error?.message ||
              "Could not load SOKO work chat"
          ),
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(
  req: NextRequest
) {
  const body =
    await req
      .json()
      .catch(
        () => null
      );

  const text =
    clean(
      body?.text,
      4000
    );

  if (!text) {
    return json(
      {
        ok: false,

        error:
          "Message is required",
      },
      {
        status: 400,
      }
    );
  }

  const resolved =
    await resolveConversation(
      req,
      {
        sellerUserId:
          clean(
            body?.sellerUserId,
            180
          ),

        workerUserId:
          clean(
            body?.workerUserId,
            180
          ),
      }
    );

  if (
    "response" in resolved
  ) {
    return resolved.response;
  }

  try {
    const message =
      await dbCreateSokoWorkChatMessage(
        {
          sellerUserId:
            resolved.sellerUserId,

          workerUserId:
            resolved.workerUserId,

          senderUserId:
            resolved.viewerUserId,

          senderRole:
            resolved.role,

          text,

          taskId:
            clean(
              body?.taskId,
              180
            ),
        }
      );

    return json(
      {
        ok: true,

        message: {
          ...message,

          mine: true,
        },
      },
      {
        status: 201,
      }
    );
  } catch (error: any) {
    return json(
      {
        ok: false,

        error:
          String(
            error?.message ||
              "Could not send SOKO work message"
          ),
      },
      {
        status: 400,
      }
    );
  }
}
