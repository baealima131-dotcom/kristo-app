import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import {
  dbListAcceptedSokoWorkforceAssignmentsForUser,
  dbListPendingSokoWorkforceInvitationsForUser,
  type SokoWorkforceRecord,
} from "@/app/api/_lib/store/sokoWorkforceDb";

import {
  dbGetMySokoSellerApplication,
} from "@/app/api/_lib/store/sokoSellerAccessDb";

import { getProfile } from "@/app/api/auth/_lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type EnrichedSokoWorkforceRecord =
  SokoWorkforceRecord & {
    sellerAvatarUrl?: string;
    storeCategory?: string;
    storeLocation?: string;
  };

async function enrichRows(
  rows: SokoWorkforceRecord[]
): Promise<EnrichedSokoWorkforceRecord[]> {
  const sellerIds = Array.from(
    new Set(
      rows
        .map((row) =>
          String(row.sellerUserId || "").trim()
        )
        .filter(Boolean)
    )
  );

  const pairs = await Promise.all(
    sellerIds.map(async (sellerUserId) => {
      let application: any = null;
      let profile: any = null;

      try {
        application =
          await dbGetMySokoSellerApplication(
            sellerUserId
          );
      } catch {}

      try {
        profile =
          await getProfile(sellerUserId);
      } catch {}

      return [
        sellerUserId,
        {
          application,
          profile,
        },
      ] as const;
    })
  );

  const sellerMap = new Map(pairs);

  return rows.map((row) => {
    const seller =
      sellerMap.get(row.sellerUserId);

    const application =
      seller?.application;

    const profile =
      seller?.profile;

    return {
      ...row,

      storeName:
        String(
          application?.businessName ||
            row.storeName ||
            row.sellerDisplayName ||
            "SOKO Store"
        ).trim(),

      storeCategory:
        String(
          application?.category || ""
        ).trim(),

      storeLocation:
        String(
          application?.location || ""
        ).trim(),

      sellerDisplayName:
        String(
          profile?.fullName ||
            row.sellerDisplayName ||
            "SOKO Seller"
        ).trim(),

      sellerAvatarUrl:
        String(
          profile?.avatarUrl || ""
        ).trim(),
    };
  });
}

export async function GET(
  req: NextRequest
) {
  const auth = await guardAuth(req);

  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const userId =
      String(
        auth.viewer.userId || ""
      ).trim();

    const [
      pendingRaw,
      assignmentsRaw,
    ] = await Promise.all([
      dbListPendingSokoWorkforceInvitationsForUser(
        userId
      ),
      dbListAcceptedSokoWorkforceAssignmentsForUser(
        userId
      ),
    ]);

    const [
      pendingInvitations,
      assignments,
    ] = await Promise.all([
      enrichRows(pendingRaw),
      enrichRows(assignmentsRaw),
    ]);

    return NextResponse.json(
      {
        ok: true,
        pendingInvitations,
        assignments,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(
          error?.message ||
            "Could not load SOKO work access"
        ),
      },
      {
        status: 500,
      }
    );
  }
}
