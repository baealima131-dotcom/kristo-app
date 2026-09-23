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
  requireSokoSellerOwner,
  resolveSokoSupplyAccess,
} from "@/app/api/_lib/store/sokoSupplyAccess";

import {
  dbListAcceptedSokoWorkforceAssignmentsForUser,
} from "@/app/api/_lib/store/sokoWorkforceDb";

import {
  dbCreateSokoWorkPlan,
  dbDeleteSokoWorkPlan,
  dbGetSokoWorkPlanById,
  dbListSokoWorkPlans,
  dbUpdateSokoWorkPlan,
  dbUpdateSokoWorkPlanStatusForWorker,
  isSokoWorkPlanPriority,
  isSokoWorkPlanStatus,
} from "@/app/api/_lib/store/sokoWorkPlansDb";

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

function fail(
  error: any
) {
  return json(
    {
      ok: false,

      error: String(
        error?.message ||
          "Could not manage work plans"
      ),
    },
    {
      status:
        Number(
          error?.status
        ) || 400,
    }
  );
}

async function verifyAcceptedSupplyWorker(
  sellerUserId: string,
  workerUserId: string
) {
  const assignments =
    await dbListAcceptedSokoWorkforceAssignmentsForUser(
      workerUserId
    );

  const assignment =
    assignments.find(
      (row) =>
        row.sellerUserId ===
          sellerUserId &&

        row.stage ===
          "supply" &&

        row.status ===
          "accepted"
    );

  if (!assignment) {
    throw Object.assign(
      new Error(
        "This user is not an active Level 01 worker for this store"
      ),
      { status: 403 }
    );
  }

  return assignment;
}

async function resolveWorkPlanAccess(
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

    const workerUserId =
      clean(
        input.workerUserId,
        180
      );

    if (!workerUserId) {
      return {
        viewerUserId,

        sellerUserId:
          access.sellerUserId,

        workerUserId: "",

        role:
          "seller_owner" as const,
      };
    }

    await verifyAcceptedSupplyWorker(
      access.sellerUserId,
      workerUserId
    );

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
                  "SOKO work plan access denied"
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
    new URL(req.url);

  const resolved =
    await resolveWorkPlanAccess(
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
    const workerUserId =
      resolved.role ===
      "supply_worker"
        ? resolved.workerUserId
        : clean(
            url.searchParams.get(
              "workerUserId"
            ),
            180
          ) ||
          resolved.workerUserId ||
          undefined;

    const plans =
      await dbListSokoWorkPlans({
        sellerUserId:
          resolved.sellerUserId,

        workerUserId,
      });

    return json({
      ok: true,

      sellerUserId:
        resolved.sellerUserId,

      workerUserId:
        workerUserId || null,

      access:
        resolved.role,

      plans,
    });
  } catch (error: any) {
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
      .catch(() => ({}));

  try {
    const access =
      await requireSokoSellerOwner(
        auth.viewer.userId
      );

    const workerUserId =
      clean(
        body?.workerUserId,
        180
      );

    const title =
      clean(
        body?.title,
        240
      );

    if (
      !workerUserId ||
      !title
    ) {
      throw new Error(
        "workerUserId and title are required"
      );
    }

    await verifyAcceptedSupplyWorker(
      access.sellerUserId,
      workerUserId
    );

    const plan =
      await dbCreateSokoWorkPlan({
        sellerUserId:
          access.sellerUserId,

        workerUserId,

        title,

        notes:
          clean(
            body?.notes,
            4000
          ),

        priority:
          isSokoWorkPlanPriority(
            body?.priority
          )
            ? body.priority
            : "normal",

        dueAt:
          clean(
            body?.dueAt,
            80
          ) || undefined,

        taskId:
          clean(
            body?.taskId,
            220
          ) || undefined,

        createdByUserId:
          auth.viewer.userId,
      });

    return json({
      ok: true,
      plan,
    });
  } catch (error: any) {
    return fail(error);
  }
}

export async function PATCH(
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
      .catch(() => ({}));

  const planId =
    clean(
      body?.planId,
      240
    );

  if (!planId) {
    return fail(
      Object.assign(
        new Error(
          "planId is required"
        ),
        { status: 400 }
      )
    );
  }

  try {
    const existing =
      await dbGetSokoWorkPlanById(
        planId
      );

    if (!existing) {
      throw Object.assign(
        new Error(
          "Work plan not found"
        ),
        { status: 404 }
      );
    }

    const access =
      await resolveSokoSupplyAccess(
        auth.viewer.userId,
        existing.sellerUserId
      );

    if (
      access.access ===
      "supply_worker"
    ) {
      if (
        existing.workerUserId !==
        auth.viewer.userId
      ) {
        throw Object.assign(
          new Error(
            "You do not have access to this work plan"
          ),
          { status: 403 }
        );
      }

      const nextStatus =
        body?.status;

      if (
        !isSokoWorkPlanStatus(
          nextStatus
        )
      ) {
        throw new Error(
          "status is required for worker updates"
        );
      }

      const plan =
        await dbUpdateSokoWorkPlanStatusForWorker(
          {
            planId:
              existing.id,

            sellerUserId:
              existing.sellerUserId,

            workerUserId:
              existing.workerUserId,

            status:
              nextStatus,
          }
        );

      return json({
        ok: true,
        plan,
      });
    }

    if (
      access.access !==
      "seller_owner"
    ) {
      throw Object.assign(
        new Error(
          "Seller owner access is required"
        ),
        { status: 403 }
      );
    }

    if (
      existing.sellerUserId !==
      access.sellerUserId
    ) {
      throw Object.assign(
        new Error(
          "Work plan belongs to another store"
        ),
        { status: 403 }
      );
    }

    const plan =
      await dbUpdateSokoWorkPlan({
        planId:
          existing.id,

        sellerUserId:
          access.sellerUserId,

        title:
          body?.title !==
          undefined
            ? clean(
                body.title,
                240
              )
            : undefined,

        notes:
          body?.notes !==
          undefined
            ? clean(
                body.notes,
                4000
              )
            : undefined,

        status:
          body?.status !==
          undefined &&
          isSokoWorkPlanStatus(
            body.status
          )
            ? body.status
            : undefined,

        priority:
          body?.priority !==
          undefined &&
          isSokoWorkPlanPriority(
            body.priority
          )
            ? body.priority
            : undefined,

        dueAt:
          body?.dueAt === null
            ? null
            : body?.dueAt !==
                undefined
              ? clean(
                  body.dueAt,
                  80
                ) || null
              : undefined,

        taskId:
          body?.taskId === null
            ? null
            : body?.taskId !==
                undefined
              ? clean(
                  body.taskId,
                  220
                ) || null
              : undefined,
      });

    return json({
      ok: true,
      plan,
    });
  } catch (error: any) {
    return fail(error);
  }
}

export async function DELETE(
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
      .catch(() => ({}));

  const planId =
    clean(
      body?.planId,
      240
    );

  if (!planId) {
    return fail(
      Object.assign(
        new Error(
          "planId is required"
        ),
        { status: 400 }
      )
    );
  }

  try {
    const access =
      await requireSokoSellerOwner(
        auth.viewer.userId
      );

    const removedId =
      await dbDeleteSokoWorkPlan({
        planId,
        sellerUserId:
          access.sellerUserId,
      });

    return json({
      ok: true,
      removedId,
    });
  } catch (error: any) {
    return fail(error);
  }
}
