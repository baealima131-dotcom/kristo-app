import {
  dbGetSokoSellerAccess,
} from "@/app/api/_lib/store/sokoSellerAccessDb";

import {
  dbListAcceptedSokoWorkforceAssignmentsForUser,
} from "@/app/api/_lib/store/sokoWorkforceDb";

export type SokoSupplyAccess = {
  sellerUserId: string;

  access:
    | "seller_owner"
    | "supply_worker";
};

export async function
resolveSokoSupplyAccess(
  viewerUserId: string,
  requestedSellerUserId?: string
): Promise<SokoSupplyAccess> {
  const viewerId =
    String(
      viewerUserId || ""
    ).trim();

  const requested =
    String(
      requestedSellerUserId || ""
    ).trim();

  if (!viewerId) {
    throw Object.assign(
      new Error(
        "Kristo account is required"
      ),
      { status: 401 }
    );
  }

  const sellerAccess =
    await dbGetSokoSellerAccess({
      userId: viewerId,
    });

  if (
    sellerAccess.approved &&
    (
      !requested ||
      requested === viewerId
    )
  ) {
    return {
      sellerUserId: viewerId,
      access: "seller_owner",
    };
  }

  const assignments =
    await dbListAcceptedSokoWorkforceAssignmentsForUser(
      viewerId
    );

  const supplyAssignments =
    assignments.filter(
      (row) =>
        row.stage ===
          "supply" &&
        row.status ===
          "accepted"
    );

  if (requested) {
    const assignment =
      supplyAssignments.find(
        (row) =>
          row.sellerUserId ===
          requested
      );

    if (assignment) {
      return {
        sellerUserId:
          assignment.sellerUserId,

        access:
          "supply_worker",
      };
    }

    throw Object.assign(
      new Error(
        "You do not have Level 01 access for this store"
      ),
      { status: 403 }
    );
  }

  if (
    supplyAssignments.length === 1
  ) {
    return {
      sellerUserId:
        supplyAssignments[0]
          .sellerUserId,

      access:
        "supply_worker",
    };
  }

  if (
    supplyAssignments.length > 1
  ) {
    throw new Error(
      "Choose which store workspace to open"
    );
  }

  throw Object.assign(
    new Error(
      "Level 01 SOKO access is required"
    ),
    { status: 403 }
  );
}

export async function
requireSokoSellerOwner(
  viewerUserId: string
) {
  const access =
    await resolveSokoSupplyAccess(
      viewerUserId,
      viewerUserId
    );

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

  return access;
}


export type SokoSetupAccess = {
  sellerUserId: string;

  access:
    | "seller_owner"
    | "setup_worker";
};

export async function
resolveSokoSetupAccess(
  viewerUserId: string,
  requestedSellerUserId?: string
): Promise<SokoSetupAccess> {
  const viewerId =
    String(
      viewerUserId || ""
    ).trim();

  const requested =
    String(
      requestedSellerUserId || ""
    ).trim();

  if (!viewerId) {
    throw Object.assign(
      new Error(
        "Kristo account is required"
      ),
      {
        status: 401,
      }
    );
  }

  const sellerAccess =
    await dbGetSokoSellerAccess({
      userId: viewerId,
    });

  if (
    sellerAccess.approved &&
    (
      !requested ||
      requested === viewerId
    )
  ) {
    return {
      sellerUserId:
        viewerId,

      access:
        "seller_owner",
    };
  }

  const assignments =
    await dbListAcceptedSokoWorkforceAssignmentsForUser(
      viewerId
    );

  const setupAssignments =
    assignments.filter(
      (row) =>
        row.stage ===
          "setup" &&
        row.status ===
          "accepted"
    );

  if (requested) {
    const assignment =
      setupAssignments.find(
        (row) =>
          row.sellerUserId ===
            requested
      );

    if (assignment) {
      return {
        sellerUserId:
          assignment.sellerUserId,

        access:
          "setup_worker",
      };
    }

    throw Object.assign(
      new Error(
        "You do not have Level 02 access for this store"
      ),
      {
        status: 403,
      }
    );
  }

  if (
    setupAssignments.length === 1
  ) {
    return {
      sellerUserId:
        setupAssignments[0]
          .sellerUserId,

      access:
        "setup_worker",
    };
  }

  if (
    setupAssignments.length > 1
  ) {
    throw Object.assign(
      new Error(
        "Choose which Level 02 store workspace to open"
      ),
      {
        status: 400,
      }
    );
  }

  throw Object.assign(
    new Error(
      "Level 02 SOKO access is required"
    ),
    {
      status: 403,
    }
  );
}
