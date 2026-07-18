import {
  apiGet,
  apiPatch,
  apiPost,
} from "@/src/lib/kristoApi";
import {
  getKristoHeaders,
} from "@/src/lib/kristoHeaders";
import { resolveApiBase } from "@/src/lib/kristoEnv";

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



export type SafetySupervisorDetailResponse = {
  supervisor: SafetySupervisorSummary;
  dashboard: {
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
    reports: any[];
    agents: any[];
  };
};

export async function fetchSafetySupervisorDetail(
  supervisorUserId: string
): Promise<SafetySupervisorDetailResponse> {
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
    await apiGet(
      `/api/safety/system-admin/supervisors/${encodeURIComponent(
        normalizedUserId
      )}`,
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
          "Could not load supervisor details."
      )
    );
  }

  const dashboard =
    response?.dashboard || {};

  const counts =
    dashboard?.counts || {};

  return {
    supervisor:
      response?.supervisor || {
        userId:
          normalizedUserId,
        churchId: "",
      },

    dashboard: {
      counts: {
        assigned: Number(
          counts.assigned || 0
        ),

        open: Number(
          counts.open || 0
        ),

        inReview: Number(
          counts.inReview || 0
        ),

        resolved: Number(
          counts.resolved || 0
        ),

        highPriority: Number(
          counts.highPriority || 0
        ),

        escalated: Number(
          counts.escalated || 0
        ),

        activeAgents: Number(
          counts.activeAgents || 0
        ),

        pendingAgents: Number(
          counts.pendingAgents || 0
        ),
      },

      reports:
        Array.isArray(
          dashboard?.reports
        )
          ? dashboard.reports
          : [],

      agents:
        Array.isArray(
          dashboard?.agents
        )
          ? dashboard.agents
          : [],
    },
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
  hasSafetyAgentRole?: boolean;
  hasActiveSafetyAgentRelationship?: boolean;
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

    hasSafetyAgentRole:
      response.hasSafetyAgentRole === true,

    hasActiveSafetyAgentRelationship:
      response
        .hasActiveSafetyAgentRelationship ===
      true,
  };
}


export type SafetyCaseIntelligence = {
  status: "ready" | "insufficient_data" | "error";
  analysisMode: "heuristic";
  generatedAt: string;
  dataQuality?: {
    reporterHistoryAvailable: boolean;
    targetHistoryAvailable: boolean;
    evidenceVerified: boolean;
    finalizedReporterCases: number;
    finalizedTargetCases: number;
    limitations: string[];
  };
  reporter: {
    credibilityScore: number | null;
    credibilityLevel: string;
    lifetimeReports: number;
    confirmedReports: number;
    dismissedReports: number;
    accuracyPercent: number | null;
    abuseFlags: string[];
  };
  target: {
    riskScore: number | null;
    totalReports: number;
    uniqueReporters: number;
    activeReports?: number;
    confirmedViolations: number;
    warnings: number;
    removals: number;
    restrictions: number;
    suspensions: number;
    permanentBans?: number;
    repeatedCategories: string[];
    trend: string;
    reportsLast7d?: number;
    reportsLast30d?: number;
    reportsLast90d?: number;
  };
  evidence: {
    strengthScore: number | null;
    originalAvailable: boolean;
    snapshotAvailable: boolean;
    signals: string[];
    limitations: string[];
  };
  patterns: Array<{
    type: string;
    severity: "low" | "medium" | "high";
    title: string;
    explanation: string;
    supportingCount?: number;
  }>;
  assessment: {
    caseRiskScore: number | null;
    signalLevel: string;
    recommendation: string;
    confidence: number | null;
    reasoning: string[];
    aggravatingFactors: string[];
    mitigatingFactors: string[];
    requiresHumanReview: true;
  };
  /** Ledger-backed history; Investigation Center does not render this yet. */
  timelines?: {
    target?: {
      firstReportAt?: string | null;
      lastReportAt?: string | null;
      previousWarnings?: number;
      previousSuspensions?: number;
      previousRestrictions?: number;
      previousRemovals?: number;
      previousPermanentBans?: number;
      confirmedViolations?: number;
      noViolationDismissals?: number;
      repeatedCategories?: string[];
      trend?: {
        reports7d?: number;
        reports30d?: number;
        reports90d?: number;
        lifetime?: number;
        direction?: string;
      };
      enforcementHistory?: Array<{
        at: string;
        type: string;
        reportId?: string;
        reason?: string;
      }>;
    };
    reporter?: {
      lifetimeReports?: number;
      confirmedReports?: number;
      dismissedReports?: number;
      maliciousReports?: number;
      accuracyProgression?: Array<{
        at: string;
        reportId: string;
        outcomeType: string;
        isConfirmedViolation: boolean;
        isDismissed: boolean;
        isMaliciousReport: boolean;
        runningConfirmed: number;
        runningDismissed: number;
      }>;
      repeatedTargetingPattern?: Array<{
        targetKey: string;
        count: number;
      }>;
      reports?: Array<{
        reportId: string;
        at: string;
        outcomeType: string;
      }>;
    };
  };
};

export type SafetyReportSummary = {
  id: string;
  reportCode: string;
  reporterUserId: string;
  reporterKristoId: string;
  reporterDisplayName?: string;
  reporterAvatarUri?: string;
  reporterChurchName?: string;

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
  targetMediaUri?: string;
  targetCreatedAt?: string;
  targetChurchName?: string;
  originalContentAvailable?: boolean;

  targetReportCount?: number;
  targetUniqueReporterCount?: number;
  targetActiveReportCount?: number;
  targetEscalatedReportCount?: number;
  targetResolvedReportCount?: number;
  targetDismissedReportCount?: number;

  reporterLifetimeReportCount?: number | null;

  /** Deprecated weighted-signal payload — not used by Investigation Center. */
  legacySignals?: {
    aiIntelligenceAvailable?: boolean;
    aiWeightedReportScore?: number | null;
    aiWeightedReportPercent?: number | null;
    aiActionThreshold?: number;
    aiActionRequired?: boolean;
    aiSignalLevel?: string;
    aiReportRecommendation?: string;
    reporterVoteWeightPercent?: number | null;
  } | null;

  caseIntelligence?: SafetyCaseIntelligence | null;

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
    | "dismissed"
    | "enforcement_pending"
    | "recovery_required";
  assignedSupervisorUserId?: string;
  assignedAgentUserId?: string;

  decisionType?:
    | "no_violation"
    | "warning"
    | "remove_content"
    | "restrict_account"
    | "suspend_account"
    | "permanent_ban"
    | "escalate";
  decisionReason?: string;
  decisionNotes?: string;
  decisionConfidence?: number;
  decisionDurationDays?: number;
  decidedByUserId?: string;
  decidedByRole?:
    | "agent"
    | "supervisor"
    | "system_admin";
  decisionAt?: string;

  createdAt: string;
  updatedAt: string;
};


export type SafetyAgentDashboardResponse = {
  counts: {
    totalAssigned: number;
    open: number;
    inReview: number;
    resolved: number;
    highPriority: number;
  };
  reports: SafetyReportSummary[];
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
    displayName?: string;
    avatarUrl?: string;
    avatarUri?: string;
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

export type SafetyAgentProfile = {
  userId: string;
  displayName?: string;
  avatarUri?: string;
};

const safetyAgentProfileCache =
  new Map<string, SafetyAgentProfile>();

function normalizeSafetyAgentRow(
  row: any
): SafetySupervisorDashboardResponse["agents"][number] {
  const userId = String(row?.userId || "").trim();
  const displayName = String(
    row?.displayName || row?.fullName || ""
  ).trim();
  const avatarUri = String(
    row?.avatarUri || row?.avatarUrl || ""
  ).trim();

  return {
    userId,
    kristoId:
      String(row?.kristoId || "").trim().toUpperCase() ||
      undefined,
    displayName: displayName || undefined,
    avatarUrl: avatarUri || undefined,
    avatarUri: avatarUri || undefined,
    churchId: String(row?.churchId || "").trim(),
    status:
      row?.status === "pending" ||
      row?.status === "paused"
        ? row.status
        : "active",
    open: Number(row?.open || 0),
    inReview: Number(row?.inReview || 0),
    resolved: Number(row?.resolved || 0),
    totalAssigned: Number(row?.totalAssigned || 0),
  };
}

/** Load real profile name/avatar for Safety Agents via the shared users profile API. */
export async function fetchSafetyAgentProfiles(
  userIds: string[]
): Promise<Record<string, SafetyAgentProfile>> {
  const unique = Array.from(
    new Set(
      userIds
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  const out: Record<string, SafetyAgentProfile> = {};

  await Promise.all(
    unique.map(async (userId) => {
      const cached = safetyAgentProfileCache.get(userId);
      if (cached) {
        out[userId] = cached;
        return;
      }

      try {
        const response: any = await apiGet(
          `/api/users/${encodeURIComponent(userId)}/profile`,
          {
            headers: getKristoHeaders() as any,
          },
          {
            screen: "SafetyAgentProfile",
            throttleMs: 60_000,
          }
        );

        if (!response || response.ok === false || !response.profile) {
          return;
        }

        const profile = response.profile;
        const displayName = String(
          profile?.fullName ||
            profile?.displayName ||
            profile?.name ||
            ""
        ).trim();
        const avatarUri = String(
          profile?.avatarUrl ||
            profile?.avatarUri ||
            profile?.profileImage ||
            ""
        ).trim();

        const resolved: SafetyAgentProfile = {
          userId,
          displayName: displayName || undefined,
          avatarUri: avatarUri || undefined,
        };

        safetyAgentProfileCache.set(userId, resolved);
        out[userId] = resolved;
      } catch {
        // Keep placeholder identity when a single profile fails.
      }
    })
  );

  return out;
}


export type SafetyCaseViewerMode =
  | "supervisor"
  | "agent";

export type SafetyCasePermissions = {
  canInvestigate: boolean;
  canAssignAgent: boolean;
  canEscalate: boolean;
  canResolve: boolean;
};

export async function fetchSafetySupervisorReport(
  reportId: string
): Promise<{
  viewerMode:
    SafetyCaseViewerMode;
  permissions:
    SafetyCasePermissions;
  report:
    SafetyReportSummary;
  agents:
    SafetySupervisorDashboardResponse["agents"];
}> {
  const normalizedId =
    String(reportId || "").trim();

  if (!normalizedId) {
    throw new Error(
      "Safety report ID is required."
    );
  }

  const response: any =
    await apiGet(
      `/api/safety/supervisor/reports/${encodeURIComponent(
        normalizedId
      )}`,
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false ||
    !response.report
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not load this safety report."
      )
    );
  }

  const viewerMode:
    SafetyCaseViewerMode =
      response?.viewerMode ===
        "agent"
        ? "agent"
        : "supervisor";

  const reportPayload =
    (response.report || {}) as SafetyReportSummary;

  const caseIntelligence =
    reportPayload.caseIntelligence &&
    typeof reportPayload.caseIntelligence ===
      "object"
      ? reportPayload.caseIntelligence
      : null;

  console.log("KRISTO_SAFETY_CASE_CLIENT_FETCH", {
    reportId: normalizedId,
    apiBase: resolveApiBase(),
    httpOk: response?.ok !== false,
    hasCaseIntelligence: Boolean(caseIntelligence),
    status: caseIntelligence?.status ?? null,
    caseRiskScore:
      caseIntelligence?.assessment?.caseRiskScore ??
      null,
  });

  return {
    viewerMode,

    permissions: {
      canInvestigate:
        response?.permissions
          ?.canInvestigate !== false,

      canAssignAgent:
        response?.permissions
          ?.canAssignAgent === true,

      canEscalate:
        response?.permissions
          ?.canEscalate !== false,

      canResolve:
        response?.permissions
          ?.canResolve !== false,
    },

    report: {
      ...reportPayload,
      caseIntelligence,
    },

    agents:
      Array.isArray(
        response.agents
      )
        ? response.agents.map(normalizeSafetyAgentRow)
        : [],
  };
}



export async function
assignSafetyReportToAgent(
  input: {
    reportId: string;
    agentUserId: string;
  }
): Promise<{
  report: SafetyReportSummary;
  agents:
    SafetySupervisorDashboardResponse["agents"];
}> {
  const reportId =
    String(
      input.reportId || ""
    ).trim();

  const agentUserId =
    String(
      input.agentUserId || ""
    ).trim();

  if (!reportId || !agentUserId) {
    throw new Error(
      "Report ID and Agent user ID are required."
    );
  }

  const response: any =
    await apiPost(
      `/api/safety/supervisor/reports/${encodeURIComponent(
        reportId
      )}`,
      {
        agentUserId,
      },
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false ||
    !response.report
  ) {
    throw new Error(
      String(
        response?.error ||
          "Could not assign this report."
      )
    );
  }

  return {
    report:
      response.report as
        SafetyReportSummary,

    agents:
      Array.isArray(
        response.agents
      )
        ? response.agents.map(normalizeSafetyAgentRow)
        : [],
  };
}



export async function
assignSafetyReportsToAgent(
  input: {
    agentUserId: string;
    count: number;
  }
): Promise<{
  assignedCount: number;
  availableCount: number;
  agents:
    SafetySupervisorDashboardResponse["agents"];
}> {
  const agentUserId =
    String(
      input.agentUserId || ""
    ).trim();

  const count =
    Math.floor(
      Number(input.count) || 0
    );

  if (!agentUserId) {
    throw new Error(
      "Agent user ID is required."
    );
  }

  if (count < 1) {
    throw new Error(
      "Enter the number of reports to assign."
    );
  }

  const response: any =
    await apiPost(
      "/api/safety/supervisor/agents",
      {
        action:
          "assign_reports",
        agentUserId,
        count,
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
    assignedCount:
      Number(
        response.assignedCount || 0
      ),

    availableCount:
      Number(
        response.availableCount || 0
      ),

    agents:
      Array.isArray(
        response.agents
      )
        ? response.agents.map(normalizeSafetyAgentRow)
        : [],
  };
}

export type SafetySupervisorAgent =
  SafetySupervisorDashboardResponse["agents"][number];

export async function
addSafetySupervisorAgent(
  input: {
    kristoId: string;
    churchId: string;
  }
): Promise<{
  outcome:
    | "invited"
    | "alreadyInvited"
    | "alreadyActive";
  invitation?: {
    id: string;
    status: string;
  } | null;
  agent: SafetySupervisorAgent;
}> {
  const kristoId =
    String(input.kristoId || "")
      .trim()
      .toUpperCase();

  const churchId =
    String(input.churchId || "")
      .trim()
      .toUpperCase();

  if (!kristoId || !churchId) {
    throw new Error(
      "KRISTO ID and Church ID are required."
    );
  }

  const response: any =
    await apiPost(
      "/api/safety/supervisor/agents",
      {
        kristoId,
        churchId,
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
          "Could not add Safety Agent."
      )
    );
  }

  return {
    outcome:
      response.outcome ===
      "alreadyActive"
        ? "alreadyActive"
        : response.outcome ===
          "alreadyInvited"
        ? "alreadyInvited"
        : "invited",

    invitation:
      response?.invitation || null,

    agent:
      response.agent as
        SafetySupervisorAgent,
  };
}


export async function
removeSafetySupervisorAgent(
  input: {
    agentUserId: string;
    churchId: string;
  }
): Promise<{
  removed: boolean;
}> {
  const agentUserId =
    String(
      input.agentUserId || ""
    ).trim();

  const churchId =
    String(
      input.churchId || ""
    )
      .trim()
      .toUpperCase();

  if (!agentUserId || !churchId) {
    throw new Error(
      "Agent user ID and Church ID are required."
    );
  }

  const response: any =
    await apiPost(
      "/api/safety/supervisor/agents",
      {
        action: "remove",
        agentUserId,
        churchId,
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
          "Could not remove Safety Agent."
      )
    );
  }

  return {
    removed:
      response.removed === true,
  };
}


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
        ? response.dashboard.agents.map(
            normalizeSafetyAgentRow
          )
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


export async function
fetchSafetyAgentDashboard():
Promise<SafetyAgentDashboardResponse> {
  const response: any =
    await apiGet(
      "/api/safety/agent/dashboard",
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
          "Could not load your assigned safety reports."
      )
    );
  }

  return {
    counts: {
      totalAssigned:
        Number(
          response?.counts
            ?.totalAssigned
        ) || 0,

      open:
        Number(
          response?.counts?.open
        ) || 0,

      inReview:
        Number(
          response?.counts
            ?.inReview
        ) || 0,

      resolved:
        Number(
          response?.counts
            ?.resolved
        ) || 0,

      highPriority:
        Number(
          response?.counts
            ?.highPriority
        ) || 0,
    },

    reports:
      Array.isArray(
        response?.reports
      )
        ? response.reports
        : [],
  };
}

export type SafetyDecisionType =
  | "no_violation"
  | "warning"
  | "remove_content"
  | "restrict_account"
  | "suspend_account"
  | "permanent_ban"
  | "escalate";

export async function issueSafetyReportDecision(
  input: {
    reportId: string;
    decisionType:
      SafetyDecisionType;
    reason: string;
    notes?: string;
    confidence?: number;
    durationDays?: number;
  }
): Promise<{
  report: SafetyReportSummary;
  enforcement?: {
    type: string;
    applied: boolean;
    message: string;
    enforcementId?: string;
    expiresAt?: string;
  };
}> {
  const reportId =
    String(
      input.reportId || ""
    ).trim();

  const reason =
    String(
      input.reason || ""
    ).trim();

  if (!reportId) {
    throw new Error(
      "Safety report ID is required."
    );
  }

  if (reason.length < 8) {
    throw new Error(
      "Enter a clear reason for this decision."
    );
  }

  const response: any =
    await apiPatch(
      `/api/safety/supervisor/reports/${encodeURIComponent(
        reportId
      )}`,
      {
        action:
          "issue_decision",
        decisionType:
          input.decisionType,
        reason,
        notes:
          String(
            input.notes || ""
          ).trim(),
        confidence:
          input.confidence,
        durationDays:
          input.durationDays,
      },
      {
        headers:
          getKristoHeaders() as any,
      }
    );

  if (
    !response ||
    response.ok === false ||
    !response.report
  ) {
    throw new Error(
      String(
        response?.error ||
        "Could not issue this Safety decision."
      )
    );
  }

  return {
    report:
      response.report as
        SafetyReportSummary,

    enforcement:
      response.enforcement
        ? {
            type:
              String(
                response
                  .enforcement
                  .type || ""
              ),

            applied:
              Boolean(
                response
                  .enforcement
                  .applied
              ),

            message:
              String(
                response
                  .enforcement
                  .message || ""
              ),

            enforcementId:
              String(
                response
                  .enforcement
                  .enforcementId ||
                ""
              ) || undefined,

            expiresAt:
              String(
                response
                  .enforcement
                  .expiresAt ||
                ""
              ) || undefined,
          }
        : undefined,
  };
}

