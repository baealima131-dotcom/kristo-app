import {
  apiGet,
  apiPost,
} from "@/src/lib/kristoApi";
import {
  getKristoHeaders,
} from "@/src/lib/kristoHeaders";

export type SafetySupervisorSummary = {
  userId: string;
  kristoId?: string;
  churchId: string;
  fullName?: string;
  avatarUrl?: string;
  avatarUri?: string;

  counts?: {
    open: number;
    assigned: number;
    inReview: number;
    resolved: number;
    highPriority?: number;
    escalated?: number;
    activeAgents?: number;
    pendingAgents?: number;
    totalAssigned?: number;
  };

  invitationStatus?:
    | "pending"
    | "accepted";
  invitationId?: string | null;
};

export async function inviteSafetySupervisor(
  input: {
    kristoId: string;
    churchId: string;
  }
) {
  const path =
    "/api/safety/supervisors/add";

  const response: any =
    await apiPost(
      path,
      input,
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not invite Safety Supervisor."
      )
    );
  }

  return response as {
    ok: true;
    outcome:
      | "invited"
      | "alreadyPending"
      | "alreadySupervisor";
    supervisor:
      SafetySupervisorSummary;
  };
}

export async function removeSafetySupervisor(
  supervisorUserId: string
): Promise<{
  removed: boolean;
  releasedReportCount: number;
}> {
  const normalizedUserId =
    String(
      supervisorUserId || ""
    ).trim();

  if (!normalizedUserId) {
    throw new Error(
      "Safety Supervisor user ID is required."
    );
  }

  const response: any =
    await apiPost(
      "/api/safety/supervisors/remove",
      {
        supervisorUserId:
          normalizedUserId,
      },
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not remove Safety Supervisor."
      )
    );
  }

  return {
    removed:
      response.removed === true,

    releasedReportCount:
      Number(
        response.releasedReportCount ||
        0
      ),
  };
}


export async function fetchSafetySupervisors() {
  const path =
    "/api/safety/supervisors";

  const response: any =
    await apiGet(path, {
      headers:
        getKristoHeaders() as any,
    });

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load Safety Supervisors."
      )
    );
  }

  return {
    supervisors:
      Array.isArray(
        response.supervisors
      )
        ? response.supervisors
        : [],
    pendingInvitations:
      Array.isArray(
        response.pendingInvitations
      )
        ? response.pendingInvitations
        : [],
    counts: {
      active: Number(
        response?.counts?.active || 0
      ),
      pending: Number(
        response?.counts?.pending || 0
      ),
    },
  };
}


export type SafetyAccessResponse = {
  roles: Array<{
    userId: string;
    churchId: string;
    role:
      | "Safety_Supervisor"
      | "Safety_Agent";
    createdAt?: string;
    updatedAt?: string;
  }>;
  isSafetySupervisor: boolean;
  isSafetyAgent: boolean;
};

export async function fetchSafetyAccess():
  Promise<SafetyAccessResponse> {
  const path = "/api/safety/access";

  const response: any =
    await apiGet(path, {
      headers:
        getKristoHeaders() as any,
    });

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load Safety access."
      )
    );
  }

  return {
    roles: Array.isArray(response.roles)
      ? response.roles
      : [],
    isSafetySupervisor:
      response.isSafetySupervisor === true,
    isSafetyAgent:
      response.isSafetyAgent === true,
  };
}


export type SafetyReportSummary = {
  id: string;
  reportCode: string;
  reporterUserId: string;
  reporterKristoId: string;
  reportedUserId?: string;
  reportedKristoId?: string;
  churchId: string;
  sourceType: string;
  sourceId?: string;
  sourceRoomId?: string;
  sourceMessageId?: string;

  targetType:
    | "account"
    | "post"
    | "comment"
    | "message"
    | "church"
    | "live"
    | "other";

  targetId?: string;
  targetTitle?: string;
  targetSubtitle?: string;
  targetPreview?: string;
  targetOwnerUserId?: string;
  targetOwnerKristoId?: string;
  targetOwnerName?: string;
  targetOwnerAvatarUri?: string;
  targetMediaType?:
    | "video"
    | "image"
    | "audio"
    | "text";
  targetThumbnailUri?: string;

  category: string;
  reason: string;
  description?: string;
  priority:
    | "low"
    | "normal"
    | "high"
    | "critical";
  status:
    | "open"
    | "assigned"
    | "in_review"
    | "resolved"
    | "escalated"
    | "dismissed";
  assignedSupervisorUserId?: string;
  assignedAgentUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type SafetySupervisorDashboardResponse = {
  counts: {
    assigned: number;
    open: number;
    inReview: number;
    resolved: number;
    highPriority: number;
    escalated: number;
    activeAgents: number;
    pendingAgents: number;
  };
  reports: SafetyReportSummary[];
  agents: Array<{
    userId: string;
    kristoId?: string;
    churchId: string;
    status:
      | "active"
      | "pending"
      | "paused";
    open: number;
    inReview: number;
    resolved: number;
    totalAssigned: number;
  }>;
};

export async function fetchSafetySupervisorDashboard():
  Promise<SafetySupervisorDashboardResponse> {
  const path =
    "/api/safety/supervisor/dashboard";

  const response: any =
    await apiGet(path, {
      headers:
        getKristoHeaders() as any,
    });

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load Safety Supervisor dashboard."
      )
    );
  }

  return {
    counts: {
      assigned: Number(
        response?.dashboard?.counts
          ?.assigned || 0
      ),
      open: Number(
        response?.dashboard?.counts
          ?.open || 0
      ),
      inReview: Number(
        response?.dashboard?.counts
          ?.inReview || 0
      ),
      resolved: Number(
        response?.dashboard?.counts
          ?.resolved || 0
      ),
      highPriority: Number(
        response?.dashboard?.counts
          ?.highPriority || 0
      ),
      escalated: Number(
        response?.dashboard?.counts
          ?.escalated || 0
      ),
      activeAgents: Number(
        response?.dashboard?.counts
          ?.activeAgents || 0
      ),
      pendingAgents: Number(
        response?.dashboard?.counts
          ?.pendingAgents || 0
      ),
    },

    reports:
      Array.isArray(
        response?.dashboard?.reports
      )
        ? response.dashboard.reports
        : [],

    agents:
      Array.isArray(
        response?.dashboard?.agents
      )
        ? response.dashboard.agents
        : [],
  };
}


export async function fetchMySafetyReports():
  Promise<SafetyReportSummary[]> {
  const path =
    "/api/safety/my-reports";

  const response: any =
    await apiGet(path, {
      headers:
        getKristoHeaders() as any,
    });

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load your reports."
      )
    );
  }

  return Array.isArray(response.reports)
    ? response.reports
    : [];
}

export async function fetchMySafetyReportByCode(
  reportCode: string
): Promise<SafetyReportSummary> {
  const normalizedCode =
    String(reportCode || "")
      .trim()
      .toUpperCase();

  if (!normalizedCode) {
    throw new Error(
      "Report Command Code is required."
    );
  }

  const path =
    "/api/safety/my-reports?code=" +
    encodeURIComponent(
      normalizedCode
    );

  const response: any =
    await apiGet(path, {
      headers:
        getKristoHeaders() as any,
    });

  if (
    !response ||
    response.ok === false ||
    !response.report
  ) {
    throw new Error(
      String(
        response?.error ||
          "Report not found."
      )
    );
  }

  return response.report;
}



export type SafetySystemPerformanceRow = {
  userId: string;
  kristoId?: string;
  assigned: number;
  resolved: number;
  open: number;
  resolutionRate: number;
  averageResolutionMinutes:
    number | null;
};

export type SafetySystemAdminDashboardResponse = {
  counts: {
    total: number;
    open: number;
    assigned: number;
    inReview: number;
    highPriority: number;
    resolved: number;
    escalated: number;
    dismissed: number;
  };

  operations: {
    autoWorkEnabled: boolean;

    topSupervisors:
      SafetySystemPerformanceRow[];

    topAgents:
      SafetySystemPerformanceRow[];

    mostProductive:
      SafetySystemPerformanceRow | null;

    fastestResolution:
      SafetySystemPerformanceRow | null;
  };
};

export async function
fetchSafetySystemAdminDashboard():
  Promise<SafetySystemAdminDashboardResponse> {
  const response: any =
    await apiGet(
      "/api/safety/system-admin/dashboard",
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load Report Center."
      )
    );
  }

  const dashboard =
    response?.dashboard || {};

  const counts =
    dashboard?.counts || {};

  const operations =
    dashboard?.operations || {};

  return {
    counts: {
      total: Number(
        counts.total || 0
      ),

      open: Number(
        counts.open || 0
      ),

      assigned: Number(
        counts.assigned || 0
      ),

      inReview: Number(
        counts.inReview || 0
      ),

      highPriority: Number(
        counts.highPriority || 0
      ),

      resolved: Number(
        counts.resolved || 0
      ),

      escalated: Number(
        counts.escalated || 0
      ),

      dismissed: Number(
        counts.dismissed || 0
      ),
    },

    operations: {
      autoWorkEnabled:
        operations.autoWorkEnabled ===
        true,

      topSupervisors:
        Array.isArray(
          operations.topSupervisors
        )
          ? operations.topSupervisors
          : [],

      topAgents:
        Array.isArray(
          operations.topAgents
        )
          ? operations.topAgents
          : [],

      mostProductive:
        operations.mostProductive ||
        null,

      fastestResolution:
        operations.fastestResolution ||
        null,
    },
  };
}


export async function
setSafetyAutoWorkEnabled(
  enabled: boolean
): Promise<boolean> {
  const response: any =
    await apiPost(
      "/api/safety/system-admin/auto-work",
      {
        enabled:
          enabled === true,
      },
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
        "Could not update Auto Work."
      )
    );
  }

  return (
    response.enabled === true
  );
}


export async function
assignSafetyReportsToSupervisorByQuantity(
  input: {
    supervisorUserId: string;
    quantity: number;
  }
) {
  const response: any =
    await apiPost(
      "/api/safety/system-admin/assign",
      {
        supervisorUserId:
          String(
            input.supervisorUserId || ""
          ).trim(),

        quantity:
          Math.floor(
            Number(input.quantity) || 0
          ),
      },
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not assign reports."
      )
    );
  }

  return {
    assignment: {
      requestedQuantity: Number(
        response?.assignment
          ?.requestedQuantity || 0
      ),

      assignedCount: Number(
        response?.assignment
          ?.assignedCount || 0
      ),

      reportIds:
        Array.isArray(
          response?.assignment
            ?.reportIds
        )
          ? response.assignment.reportIds
          : [],
    },

    dashboard:
      response?.dashboard || null,
  };
}
