import {
  buildKristoRequestHeaders,
  getKristoAuth,
} from "@/src/lib/kristoHeaders";

const API_BASE = String(
  process.env.EXPO_PUBLIC_API_BASE ||
    "https://kristo-app.vercel.app"
)
  .trim()
  .replace(/\/+$/, "");

export type SokoWorkStage =
  | "supply"
  | "setup"
  | "costing"
  | "payments"
  | "review";

export type SokoWorkforceRecord = {
  id: string;
  sellerUserId: string;
  sellerKristoId: string;
  sellerDisplayName: string;
  sellerAvatarUrl?: string;
  storeName: string;
  storeCategory?: string;
  storeLocation?: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  inviteeDisplayName: string;
  churchId: string;
  stage: SokoWorkStage;
  status: "pending" | "accepted" | "declined" | "removed";
  createdAt: string;
  respondedAt: string | null;
  updatedAt: string;
};

export type SokoWorkforceMeResponse = {
  ok: true;
  pendingInvitations: SokoWorkforceRecord[];
  assignments: SokoWorkforceRecord[];
};

type WorkforceCacheSlot = {
  userId: string;
  result: SokoWorkforceMeResponse;
};

let sessionCache: WorkforceCacheSlot | null = null;
let inflightUserId = "";
let inflightPromise: Promise<SokoWorkforceMeResponse> | null = null;

function cleanUserId(value: unknown) {
  return String(value || "").trim();
}

function logWorkforce(
  event: string,
  extra?: Record<string, unknown>
) {
  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return;
  }

  console.log(event, extra || {});
}

function hasAssignments(
  result: SokoWorkforceMeResponse | null | undefined
) {
  return Boolean(result?.assignments?.length);
}

export function hasAcceptedLevel01SupplyAssignment(
  workforce: SokoWorkforceMeResponse | null | undefined,
  userId: string
) {
  const uid = cleanUserId(userId);

  if (!uid || !workforce) {
    return false;
  }

  return (workforce.assignments || []).some(
    (row) =>
      row.status === "accepted" &&
      row.stage === "supply" &&
      cleanUserId(row.inviteeUserId) === uid
  );
}

export function peekSokoWorkforceMeForUser(
  userId: string
): SokoWorkforceMeResponse | null {
  const uid = cleanUserId(userId);

  if (
    !uid ||
    !sessionCache ||
    sessionCache.userId !== uid
  ) {
    return null;
  }

  return sessionCache.result;
}

export function clearSokoWorkforceMeCache(userId?: string) {
  const uid = cleanUserId(userId);

  if (
    uid &&
    sessionCache &&
    sessionCache.userId !== uid
  ) {
    return;
  }

  if (sessionCache) {
    logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_CACHE", {
      event: "clear",
      userId: sessionCache.userId,
    });
  }

  sessionCache = null;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned an invalid response (${response.status}).`);
  }
}

function normalizeWorkforceMe(
  data: any
): SokoWorkforceMeResponse {
  return {
    ok: true,
    pendingInvitations: Array.isArray(data?.pendingInvitations)
      ? data.pendingInvitations
      : [],
    assignments: Array.isArray(data?.assignments)
      ? data.assignments
      : [],
  };
}

export async function fetchSokoWorkforceMe(options?: {
  userId?: string;
  source?: string;
}): Promise<SokoWorkforceMeResponse> {
  const requestedUserId =
    cleanUserId(options?.userId) ||
    cleanUserId(getKristoAuth().userId);

  const source =
    String(options?.source || "fetch").trim() ||
    "fetch";

  if (!requestedUserId) {
    throw new Error("Sign in with your Kristo account first.");
  }

  if (
    inflightPromise &&
    inflightUserId === requestedUserId
  ) {
    logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_CACHE", {
      event: "dedupe",
      userId: requestedUserId,
      source,
    });
    return inflightPromise;
  }

  const job = (async () => {
    const path = "/api/soko/workforce/me";
    const startedAt = Date.now();

    logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_REQUEST_START", {
      userId: requestedUserId,
      source,
    });

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: buildKristoRequestHeaders(
          path,
          undefined,
          undefined,
          "sokoWorkforceApi"
        ),
      });
      const data = await readJson(response);
      const ms = Date.now() - startedAt;
      const currentUserId = cleanUserId(getKristoAuth().userId);

      if (!response.ok || data?.ok === false) {
        logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_RESPONSE", {
          userId: requestedUserId,
          source,
          ms,
          status: response.status,
          ok: false,
        });
        throw new Error(
          String(data?.error || "Could not load your SOKO work access.")
        );
      }

      const result = normalizeWorkforceMe(data);

      logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_RESPONSE", {
        userId: requestedUserId,
        source,
        ms,
        status: response.status,
        ok: true,
        pending: result.pendingInvitations.length,
        assignments: result.assignments.length,
      });

      if (currentUserId !== requestedUserId) {
        logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_CACHE", {
          event: "discard-user-mismatch",
          requestedUserId,
          currentUserId,
          source,
        });
        return result;
      }

      if (!hasAssignments(result)) {
        if (sessionCache?.userId === requestedUserId) {
          sessionCache = null;
          logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_CACHE", {
            event: "clear-empty",
            userId: requestedUserId,
            source,
          });
        }
      } else {
        sessionCache = {
          userId: requestedUserId,
          result,
        };
        logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_CACHE", {
          event: "store",
          userId: requestedUserId,
          source,
          assignments: result.assignments.length,
        });
      }

      return result;
    } finally {
      if (inflightUserId === requestedUserId) {
        inflightUserId = "";
        inflightPromise = null;
      }
    }
  })();

  inflightUserId = requestedUserId;
  inflightPromise = job;
  return job;
}

export function prefetchSokoWorkforceMeForCurrentUser(source: string) {
  const userId = cleanUserId(getKristoAuth().userId);

  if (!userId) {
    return;
  }

  logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_PREFETCH_START", {
    userId,
    source,
  });

  const cached = peekSokoWorkforceMeForUser(userId);

  if (cached) {
    logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_CACHE", {
      event: "hit",
      userId,
      source,
      assignments: cached.assignments.length,
    });
  }

  void fetchSokoWorkforceMe({
    userId,
    source,
  }).catch((error: any) => {
    logWorkforce("KRISTO_MORE_SOKO_WORKFORCE_PREFETCH_FAILED", {
      userId,
      source,
      error: String(error?.message || error),
    });
  });
}

export async function respondSokoWorkforceInvitation(input: {
  invitationId: string;
  action: "accept" | "decline";
}) {
  const path = "/api/soko/workforce/respond";
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: buildKristoRequestHeaders(
      path,
      undefined,
      { "content-type": "application/json" },
      "sokoWorkforceApi"
    ),
    body: JSON.stringify(input),
  });
  const data = await readJson(response);

  if (!response.ok || data?.ok === false || !data?.invitation) {
    throw new Error(String(data?.error || "Could not respond to the SOKO work invitation."));
  }

  return data.invitation as SokoWorkforceRecord;
}
