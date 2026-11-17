import { readCoreJsonFile, updateCoreJsonFile } from "@/app/api/_lib/store/coreDb";
import {
  getChurchById,
  searchChurches,
  upsertChurchProfile,
  type ChurchActivationStatus,
} from "@/app/api/_lib/churches";
import { addActiveMember, getActiveMembership, getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import { createNotification } from "@/app/api/_lib/notifications";
import { listPlatformRoleUsers } from "@/app/api/_lib/platformRoles";
import { listAgentsByLinkedUserId } from "@/app/api/_lib/offlineActivationAgentStore";
import {
  OFFLINE_ACTIVATION_CODES_STORE_KEY,
  readOfflineActivationJsonFile,
} from "@/app/api/_lib/store/offlineActivationDb";
import { activateChurchWithAgentCode } from "@/app/api/_lib/offlineActivationCodeStore";
import { invalidateChurchActivationCache } from "@/app/api/_lib/churchActivationGate";

/**
 * Church applications: nobody creates a church directly any more. Applicants (or agents on their
 * behalf, with an activation code assigned to them) submit an application; only a System Admin
 * reviews it. A conditional approval provisions the church in a hidden "pending_requirements"
 * state (the applicant becomes its Pastor so members can join by Church ID); the church opens
 * only when its requirements are met and the configured activation step is done.
 *
 * Stored as one core document (same data layer and read-modify-write pattern as other core
 * stores). Every submission, attribution, decision, requirement change and activation is kept
 * in the application's history.
 */

const STORE_FILE = "church-applications.json";

export const CHURCH_APPLICATION_STATUSES = [
  "pending_review",
  "more_info_needed",
  "conditionally_approved",
  "requirements_in_progress",
  "ready_for_admin_review",
  "active",
  "rejected",
  "expired",
] as const;
export type ChurchApplicationStatus = (typeof CHURCH_APPLICATION_STATUSES)[number];

export const CHURCH_APPLICATION_STATUS_LABELS: Record<ChurchApplicationStatus, string> = {
  pending_review: "Pending Review",
  more_info_needed: "More Information Needed",
  conditionally_approved: "Conditionally Approved",
  requirements_in_progress: "Requirements In Progress",
  ready_for_admin_review: "Ready for Admin Review",
  active: "Active",
  rejected: "Rejected",
  expired: "Expired",
};

/** Statuses that block a second application by the same applicant / for the same church. */
const OPEN_STATUSES = new Set<ChurchApplicationStatus>([
  "pending_review",
  "more_info_needed",
  "conditionally_approved",
  "requirements_in_progress",
  "ready_for_admin_review",
  "expired",
]);
/** The church exists (provisioned) but is not open yet. */
const PROVISIONED_STATUSES = new Set<ChurchApplicationStatus>([
  "conditionally_approved",
  "requirements_in_progress",
  "ready_for_admin_review",
  "expired",
]);
/** Shown with the review badge in the System Admin Report Center. */
const NEEDS_REVIEW_STATUSES = new Set<ChurchApplicationStatus>(["pending_review", "ready_for_admin_review"]);

export type RequirementKind = "verified_members" | "manual";
export type ActivationMode = "auto" | "admin_review";

export type ApplicationRequirement = {
  id: string;
  kind: RequirementKind;
  title: string;
  description?: string;
  /** verified_members: approved active members needed (the applicant/Pastor is not counted). */
  target?: number;
  deadlineAt: string;
  templateId?: string;
  current?: number;
  completedAt?: string;
  completedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type RequirementTemplate = {
  id: string;
  kind: RequirementKind;
  title: string;
  description?: string;
  target?: number;
  durationDays: number;
  builtin?: boolean;
  createdBy?: string;
  createdAt: string;
};

export type ApplicationEvent = {
  at: string;
  type: string;
  byUserId: string;
  byRole: "applicant" | "agent" | "admin" | "system";
  fromStatus?: ChurchApplicationStatus;
  toStatus?: ChurchApplicationStatus;
  message?: string;
  details?: Record<string, unknown>;
};

export type ApplicationChurchInfo = {
  name: string;
  phone: string;
  country: string;
  province: string;
  city: string;
  address?: string;
  description?: string;
};

export type AgentAttribution = {
  agentUserId: string;
  agentRegistrationId: string;
  agentName: string;
  agentKristoId: string;
  agentCode: string;
  submittedAt: string;
  codeRedeemedAt?: string;
  codeRedeemError?: string;
};

export type ChurchApplication = {
  id: string;
  status: ChurchApplicationStatus;
  church: ApplicationChurchInfo;
  applicantUserId: string;
  applicantName: string;
  applicantKristoId?: string;
  source: "direct" | "agent";
  agent?: AgentAttribution;
  submittedByUserId: string;
  submittedAt: string;
  updatedAt: string;
  churchId?: string;
  activationMode: ActivationMode;
  /** How the System Admin approved: with requirements (conditional) or without (active at once). */
  approvalType?: "with_requirements" | "without_requirements";
  requirements: ApplicationRequirement[];
  adminMessage?: string;
  adminMessageAt?: string;
  applicantResponse?: string;
  applicantUnseenUpdate?: boolean;
  decidedAt?: string;
  decidedBy?: string;
  activatedAt?: string;
  activatedBy?: string;
  dedupeKey: string;
  history: ApplicationEvent[];
};

type ApplicationStore = { applications: ChurchApplication[]; templates: RequirementTemplate[] };

export class ChurchApplicationError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BUILTIN_TEMPLATES: RequirementTemplate[] = [
  {
    id: "tpl_members_12_30",
    kind: "verified_members",
    title: "Reach 12 verified members",
    description: "12 approved members (besides the Pastor) within 30 days.",
    target: 12,
    durationDays: 30,
    builtin: true,
    createdAt: "2026-11-05T00:00:00.000Z",
  },
  {
    id: "tpl_members_25_60",
    kind: "verified_members",
    title: "Reach 25 verified members",
    description: "25 approved members (besides the Pastor) within 60 days.",
    target: 25,
    durationDays: 60,
    builtin: true,
    createdAt: "2026-11-05T00:00:00.000Z",
  },
  {
    id: "tpl_pastor_identity",
    kind: "manual",
    title: "Pastor identity confirmed",
    description: "Kristo App confirms the Pastor's identity and leadership role.",
    durationDays: 14,
    builtin: true,
    createdAt: "2026-11-05T00:00:00.000Z",
  },
  {
    id: "tpl_location_confirmed",
    kind: "manual",
    title: "Church location confirmed",
    description: "Kristo App confirms the church's meeting place.",
    durationDays: 30,
    builtin: true,
    createdAt: "2026-11-05T00:00:00.000Z",
  },
];

function nowIso() {
  return new Date().toISOString();
}

function rid(prefix: string, len = 8) {
  let s = "";
  while (s.length < len) s += Math.random().toString(36).slice(2).toUpperCase();
  return `${prefix}${s.slice(0, len)}`;
}

function clean(input: unknown, max: number): string {
  const s = String(input ?? "").trim().replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max) : s;
}

function norm(input: unknown): string {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function addDays(days: number, from = Date.now()) {
  return new Date(from + days * 86400000).toISOString();
}

function dedupeKeyFor(church: ApplicationChurchInfo) {
  return [norm(church.name), norm(church.city), norm(church.country)].join("|");
}

async function readStore(): Promise<ApplicationStore> {
  const raw = await readCoreJsonFile<ApplicationStore>(STORE_FILE, { applications: [], templates: [] });
  return {
    applications: Array.isArray(raw?.applications) ? raw.applications : [],
    templates: Array.isArray(raw?.templates) ? raw.templates : [],
  };
}

async function updateStore(mutator: (store: ApplicationStore) => ApplicationStore) {
  return updateCoreJsonFile<ApplicationStore>(
    STORE_FILE,
    (current) =>
      mutator({
        applications: Array.isArray(current?.applications) ? current.applications : [],
        templates: Array.isArray(current?.templates) ? current.templates : [],
      }),
    { applications: [], templates: [] }
  );
}

/**
 * Applies `fn` to the latest stored copy of one application. `expectedUpdatedAt` guards against a
 * concurrent change made between loading and saving (409 instead of a silent overwrite).
 */
async function mutateApplication(
  id: string,
  expectedUpdatedAt: string | null,
  fn: (app: ChurchApplication) => ChurchApplication
): Promise<ChurchApplication> {
  let saved: ChurchApplication | null = null;
  await updateStore((store) => {
    const idx = store.applications.findIndex((a) => a.id === id);
    if (idx < 0) throw new ChurchApplicationError(404, "not_found", "Application not found");
    const current = store.applications[idx];
    if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
      throw new ChurchApplicationError(409, "conflict", "The application changed meanwhile. Reload and try again.");
    }
    saved = fn({ ...current, history: [...(current.history || [])] });
    store.applications[idx] = saved;
    return store;
  });
  return saved!;
}

function pushEvent(app: ChurchApplication, event: Omit<ApplicationEvent, "at"> & { at?: string }) {
  app.history.push({ at: event.at || nowIso(), ...event });
}

function setStatus(
  app: ChurchApplication,
  to: ChurchApplicationStatus,
  event: Omit<ApplicationEvent, "at" | "fromStatus" | "toStatus" | "type"> & { type?: string; at?: string }
) {
  const from = app.status;
  app.status = to;
  pushEvent(app, { ...event, type: event.type || "status_changed", fromStatus: from, toStatus: to });
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

async function notifySystemAdmins(title: string, message: string) {
  try {
    const admins = await listPlatformRoleUsers("System_Admin");
    for (const admin of admins) {
      const active = await getActiveMembership(admin.userId).catch(() => undefined);
      await createNotification({
        churchId: String(active?.churchId || ""),
        targetUserId: admin.userId,
        type: "Generic",
        title,
        message,
      });
    }
  } catch (e) {
    console.log("KRISTO_CHURCH_APPLICATION_NOTIFY_ADMINS_FAILED", { error: String((e as any)?.message || e) });
  }
}

/**
 * In-app notification for the applicant. Notifications are church-scoped, so one is only
 * delivered once the applicant has a church (after conditional approval); before that the
 * Church tab shows the update through `applicantUnseenUpdate`.
 */
async function notifyApplicant(app: ChurchApplication, title: string, message: string) {
  try {
    const active = await getActiveMembership(app.applicantUserId).catch(() => undefined);
    if (!active?.churchId) return;
    await createNotification({
      churchId: active.churchId,
      targetUserId: app.applicantUserId,
      type: "Generic",
      title,
      message,
    });
  } catch (e) {
    console.log("KRISTO_CHURCH_APPLICATION_NOTIFY_APPLICANT_FAILED", { error: String((e as any)?.message || e) });
  }
}

/* ------------------------------------------------------------------ */
/* Agent codes                                                         */
/* ------------------------------------------------------------------ */

/**
 * Read-only check of the existing activation-code rules (same as activateChurchWithAgentCode):
 * the code must be assigned to one of this agent's registrations and still assigned_to_agent.
 * Redemption itself happens through activateChurchWithAgentCode when the church is provisioned.
 */
async function checkAgentCode(agentUserId: string, rawCode: string) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) throw new ChurchApplicationError(400, "agent_code_required", "Agent code is required");
  const registrations = await listAgentsByLinkedUserId(agentUserId);
  const registration = registrations[0];
  if (!registration) {
    throw new ChurchApplicationError(403, "agent_not_registered", "No agent registration found for this user");
  }
  const ids = new Set(registrations.map((r) => r.id));
  const store = await readOfflineActivationJsonFile<{ batches?: any[] }>(OFFLINE_ACTIVATION_CODES_STORE_KEY, {
    batches: [],
  });
  const found = (store.batches || [])
    .flatMap((b: any) => (Array.isArray(b?.codes) ? b.codes : []))
    .find((c: any) => String(c?.code || "").trim().toUpperCase() === code);
  if (!found) throw new ChurchApplicationError(400, "agent_code_not_found", "Agent code not found");
  const assignedTo = String(found.assignedAgentUserId || "").trim();
  if (!assignedTo || !ids.has(assignedTo)) {
    throw new ChurchApplicationError(403, "agent_code_not_assigned", "This agent code is not assigned to you");
  }
  if (found.status === "redeemed") throw new ChurchApplicationError(409, "agent_code_redeemed", "This agent code has already been used");
  if (found.status === "disabled") throw new ChurchApplicationError(409, "agent_code_disabled", "This agent code is disabled");
  if (found.status !== "assigned_to_agent") {
    throw new ChurchApplicationError(409, "agent_code_unavailable", "This agent code is not available");
  }
  const registrationForCode = registrations.find((r) => r.id === assignedTo) || registration;
  return { code, registration: registrationForCode };
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

function parseChurchInfo(body: any): ApplicationChurchInfo {
  const church: ApplicationChurchInfo = {
    name: clean(body?.name, 120),
    phone: clean(body?.phone, 40),
    country: clean(body?.country, 80),
    province: clean(body?.province, 80),
    city: clean(body?.city, 80),
    address: clean(body?.address, 200) || undefined,
    description: clean(body?.description, 600) || undefined,
  };
  if (!church.name || church.name.length < 3) {
    throw new ChurchApplicationError(400, "invalid_name", "Enter the church name");
  }
  if (!/^\+\d{6,16}$/.test(church.phone.replace(/[\s-]/g, ""))) {
    throw new ChurchApplicationError(400, "invalid_phone", "Enter a valid phone number with country code");
  }
  if (!church.country || !church.province || !church.city) {
    throw new ChurchApplicationError(400, "invalid_location", "Select the church country and location");
  }
  return church;
}

async function assertNoDuplicate(applicantUserId: string, church: ApplicationChurchInfo, agentCode?: string) {
  const store = await readStore();
  const key = dedupeKeyFor(church);
  const mine = store.applications.find(
    (a) => a.applicantUserId === applicantUserId && (OPEN_STATUSES.has(a.status) || a.status === "active")
  );
  if (mine) {
    throw new ChurchApplicationError(409, "duplicate_application", "This applicant already has a church application", {
      applicationId: mine.id,
    });
  }
  const same = store.applications.find((a) => a.dedupeKey === key && (OPEN_STATUSES.has(a.status) || a.status === "active"));
  if (same) {
    throw new ChurchApplicationError(
      409,
      "duplicate_church_application",
      "An application for a church with this name in this city already exists"
    );
  }
  if (agentCode) {
    const reserved = store.applications.find(
      (a) => a.agent?.agentCode === agentCode && OPEN_STATUSES.has(a.status) && !a.agent?.codeRedeemedAt
    );
    if (reserved) {
      throw new ChurchApplicationError(409, "agent_code_in_use", "This agent code is already used by another open application");
    }
  }
  const existing = await searchChurches({ q: church.name, limit: 50, includeDev: true, includePending: true }).catch(() => []);
  const clash = existing.find(
    (c) => norm(c.name) === norm(church.name) && norm(c.city) === norm(church.city) && norm(c.country) === norm(church.country)
  );
  if (clash) {
    throw new ChurchApplicationError(409, "church_already_exists", "A church with this name already exists in this city", {
      churchId: clash.id,
    });
  }
}

export async function submitChurchApplication(input: {
  actorUserId: string;
  source: "direct" | "agent";
  body: any;
}): Promise<ChurchApplication> {
  const church = parseChurchInfo(input.body);
  const at = nowIso();

  let applicantUserId = input.actorUserId;
  let agent: AgentAttribution | undefined;

  if (input.source === "agent") {
    const leaderKristoId = clean(input.body?.leaderKristoId, 40).toUpperCase();
    if (!leaderKristoId) {
      throw new ChurchApplicationError(400, "leader_required", "Enter the church leader's Kristo ID");
    }
    const leader = await getProfileByUserCode(leaderKristoId);
    if (!leader?.userId) throw new ChurchApplicationError(404, "leader_not_found", "No Kristo account with this Kristo ID");
    if (leader.userId === input.actorUserId) {
      throw new ChurchApplicationError(400, "leader_is_agent", "An agent cannot apply for themselves through an agent code");
    }
    const checked = await checkAgentCode(input.actorUserId, input.body?.agentCode);
    applicantUserId = leader.userId;
    agent = {
      agentUserId: input.actorUserId,
      agentRegistrationId: checked.registration.id,
      agentName: checked.registration.fullName || "",
      agentKristoId: checked.registration.kristoId || "",
      agentCode: checked.code,
      submittedAt: at,
    };
  }

  const active = await getActiveMembership(applicantUserId);
  if (active?.churchId) {
    throw new ChurchApplicationError(
      409,
      "applicant_has_church",
      "The applicant already belongs to a church. One account can lead only one church."
    );
  }

  await assertNoDuplicate(applicantUserId, church, agent?.agentCode);

  const profile = await getProfile(applicantUserId).catch(() => null);
  const app: ChurchApplication = {
    id: rid("CAPP-"),
    status: "pending_review",
    church,
    applicantUserId,
    applicantName: clean(profile?.fullName, 120) || "Applicant",
    applicantKristoId: clean(profile?.userCode, 40).toUpperCase() || undefined,
    source: input.source,
    agent,
    submittedByUserId: input.actorUserId,
    submittedAt: at,
    updatedAt: at,
    activationMode: "admin_review",
    requirements: [],
    dedupeKey: dedupeKeyFor(church),
    history: [
      {
        at,
        type: "submitted",
        byUserId: input.actorUserId,
        byRole: input.source === "agent" ? "agent" : "applicant",
        toStatus: "pending_review",
        details: agent
          ? {
              source: "agent",
              agentUserId: agent.agentUserId,
              agentRegistrationId: agent.agentRegistrationId,
              agentName: agent.agentName,
              agentKristoId: agent.agentKristoId,
              agentCode: agent.agentCode,
            }
          : { source: "direct" },
      },
    ],
  };

  await updateStore((store) => {
    // Re-check under the write: no second open application for this applicant or church.
    if (store.applications.some((a) => a.applicantUserId === applicantUserId && (OPEN_STATUSES.has(a.status) || a.status === "active"))) {
      throw new ChurchApplicationError(409, "duplicate_application", "This applicant already has a church application");
    }
    if (store.applications.some((a) => a.dedupeKey === app.dedupeKey && (OPEN_STATUSES.has(a.status) || a.status === "active"))) {
      throw new ChurchApplicationError(409, "duplicate_church_application", "An application for this church already exists");
    }
    store.applications.push(app);
    return store;
  });

  console.log("KRISTO_CHURCH_APPLICATION_SUBMITTED", {
    applicationId: app.id,
    source: app.source,
    applicantUserId,
    agentUserId: agent?.agentUserId || null,
  });
  await notifySystemAdmins(
    "New church application",
    `${app.church.name} (${app.church.city}, ${app.church.country}) applied${agent ? ` through agent ${agent.agentName || agent.agentKristoId}` : ""}. Review it in Report Center > Churches.`
  );
  return app;
}

/* ------------------------------------------------------------------ */
/* Requirements and evaluation                                         */
/* ------------------------------------------------------------------ */

async function countVerifiedMembers(app: ChurchApplication): Promise<number> {
  if (!app.churchId) return 0;
  const rows = await getMembershipsForChurch(app.churchId, "Active").catch(() => []);
  // Verified member = an approved, active membership on a Kristo account (the Pastor excluded).
  return rows.filter((m) => m.userId && m.userId !== app.applicantUserId).length;
}

function parseRequirementInput(raw: any, prev: ApplicationRequirement | undefined, templates: RequirementTemplate[]) {
  const at = nowIso();
  const template = raw?.templateId ? templates.find((t) => t.id === String(raw.templateId)) : undefined;
  const kind: RequirementKind =
    (raw?.kind === "verified_members" || raw?.kind === "manual" ? raw.kind : template?.kind) || "manual";
  const title = clean(raw?.title, 120) || template?.title || "";
  if (!title) throw new ChurchApplicationError(400, "requirement_title", "Each requirement needs a title");

  let target: number | undefined;
  if (kind === "verified_members") {
    target = Math.floor(Number(raw?.target ?? template?.target ?? 0));
    if (!Number.isFinite(target) || target < 1 || target > 100000) {
      throw new ChurchApplicationError(400, "requirement_target", "Member target must be between 1 and 100000");
    }
  }

  let deadlineAt = "";
  if (raw?.deadlineAt) {
    const ms = Date.parse(String(raw.deadlineAt));
    if (!Number.isFinite(ms)) throw new ChurchApplicationError(400, "requirement_deadline", "Invalid deadline");
    deadlineAt = new Date(ms).toISOString();
  } else {
    const days = Math.floor(Number(raw?.durationDays ?? template?.durationDays ?? 0));
    if (!Number.isFinite(days) || days < 1 || days > 730) {
      throw new ChurchApplicationError(400, "requirement_deadline", "Deadline must be 1 to 730 days");
    }
    deadlineAt = addDays(days);
  }

  return {
    id: prev?.id || rid("REQ-", 6),
    kind,
    title,
    description: clean(raw?.description, 300) || template?.description || undefined,
    target,
    deadlineAt,
    templateId: template?.id || prev?.templateId,
    current: prev?.current,
    completedAt: prev && prev.kind === kind && (kind === "manual" || prev.target === target) ? prev.completedAt : undefined,
    completedBy: prev && prev.kind === kind && (kind === "manual" || prev.target === target) ? prev.completedBy : undefined,
    createdAt: prev?.createdAt || at,
    updatedAt: at,
  } satisfies ApplicationRequirement;
}

function describeRequirement(r: ApplicationRequirement) {
  const due = r.deadlineAt.slice(0, 10);
  return r.kind === "verified_members" ? `${r.title} (${r.target} members by ${due})` : `${r.title} (by ${due})`;
}

type EvaluationEffects = { activated: boolean; ready: boolean; expired: boolean; started: boolean };

/** Updates progress and applies automatic transitions. Mutates `app`; returns what happened. */
function applyEvaluation(app: ChurchApplication, verifiedMembers: number, nowMs = Date.now()): EvaluationEffects {
  const effects: EvaluationEffects = { activated: false, ready: false, expired: false, started: false };
  if (!PROVISIONED_STATUSES.has(app.status) || app.status === "ready_for_admin_review") return effects;

  const at = new Date(nowMs).toISOString();
  for (const r of app.requirements) {
    if (r.kind !== "verified_members") continue;
    r.current = verifiedMembers;
    if (!r.completedAt && verifiedMembers >= Number(r.target || 0)) {
      r.completedAt = at;
      r.completedBy = "system";
      pushEvent(app, {
        at,
        type: "requirement_met",
        byUserId: "system",
        byRole: "system",
        details: { requirementId: r.id, title: r.title, current: verifiedMembers, target: r.target },
      });
    }
  }

  const allMet = app.requirements.every((r) => !!r.completedAt);
  if (allMet) {
    if (app.activationMode === "auto") {
      setStatus(app, "active", {
        at,
        type: "activated",
        byUserId: "system",
        byRole: "system",
        message: app.requirements.length ? "All requirements met" : "Approved without requirements",
      });
      app.activatedAt = at;
      app.activatedBy = "system";
      effects.activated = true;
    } else {
      setStatus(app, "ready_for_admin_review", { at, byUserId: "system", byRole: "system", message: "All requirements met" });
      effects.ready = true;
    }
    app.updatedAt = at;
    return effects;
  }

  const overdue = app.requirements.some((r) => !r.completedAt && Date.parse(r.deadlineAt) < nowMs);
  if (overdue && app.status !== "expired") {
    setStatus(app, "expired", { at, byUserId: "system", byRole: "system", message: "A requirement deadline passed" });
    effects.expired = true;
    app.updatedAt = at;
    return effects;
  }
  if (!overdue && app.status === "expired") {
    setStatus(app, "requirements_in_progress", { at, byUserId: "system", byRole: "system", message: "Deadline extended" });
    app.updatedAt = at;
    return effects;
  }

  const anyProgress = app.requirements.some((r) => r.completedAt || Number(r.current || 0) > 0);
  if (app.status === "conditionally_approved" && anyProgress) {
    setStatus(app, "requirements_in_progress", { at, byUserId: "system", byRole: "system" });
    effects.started = true;
    app.updatedAt = at;
  }
  return effects;
}

async function setChurchActivation(app: ChurchApplication, status: ChurchActivationStatus) {
  if (!app.churchId) return;
  const church = await getChurchById(app.churchId);
  if (!church) return;
  await upsertChurchProfile({ id: app.churchId, name: church.name, activationStatus: status, applicationId: app.id });
  invalidateChurchActivationCache(app.churchId);
}

async function afterEffects(app: ChurchApplication, effects: EvaluationEffects) {
  if (effects.activated) {
    await setChurchActivation(app, "active");
    await notifyApplicant(
      app,
      "Your church is active",
      app.requirements.length
        ? `${app.church.name} met all requirements and is now active on Kristo App.`
        : `${app.church.name} was approved and is now active on Kristo App. You can post and create ministries.`
    );
    console.log("KRISTO_CHURCH_APPLICATION_ACTIVATED", { applicationId: app.id, churchId: app.churchId, by: "system" });
  }
  if (effects.ready) {
    await notifySystemAdmins("Church ready for final review", `${app.church.name} met all requirements and is waiting for activation.`);
    await notifyApplicant(app, "Requirements complete", `${app.church.name} met all requirements. A Kristo App admin will do the final review.`);
  }
  if (effects.expired) {
    await notifyApplicant(app, "Church application expired", `A requirement deadline for ${app.church.name} has passed. Contact Kristo App Support.`);
  }
}

/** Recomputes progress for one application and persists automatic transitions. */
export async function refreshChurchApplication(app: ChurchApplication): Promise<ChurchApplication> {
  if (!PROVISIONED_STATUSES.has(app.status) || app.status === "ready_for_admin_review") return app;
  const members = await countVerifiedMembers(app);
  const preview = structuredClone(app) as ChurchApplication;
  const effects = applyEvaluation(preview, members);
  const progressChanged = preview.requirements.some((r, i) => r.current !== app.requirements[i]?.current);
  if (preview.status === app.status && !progressChanged && !preview.requirements.some((r, i) => r.completedAt !== app.requirements[i]?.completedAt)) {
    return preview;
  }
  let saved = preview;
  try {
    saved = await mutateApplication(app.id, app.updatedAt, (current) => {
      applyEvaluation(current, members);
      if (current.status !== app.status) current.applicantUnseenUpdate = true;
      return current;
    });
  } catch (e) {
    if ((e as any)?.code === "conflict") return preview;
    throw e;
  }
  await afterEffects(saved, effects);
  return saved;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export async function listRequirementTemplates(): Promise<RequirementTemplate[]> {
  const store = await readStore();
  return [...BUILTIN_TEMPLATES, ...store.templates];
}

export async function saveRequirementTemplate(adminUserId: string, raw: any): Promise<RequirementTemplate> {
  const kind: RequirementKind = raw?.kind === "verified_members" ? "verified_members" : "manual";
  const title = clean(raw?.title, 120);
  if (!title) throw new ChurchApplicationError(400, "template_title", "Template needs a title");
  const durationDays = Math.floor(Number(raw?.durationDays || 0));
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 730) {
    throw new ChurchApplicationError(400, "template_duration", "Duration must be 1 to 730 days");
  }
  let target: number | undefined;
  if (kind === "verified_members") {
    target = Math.floor(Number(raw?.target || 0));
    if (!Number.isFinite(target) || target < 1 || target > 100000) {
      throw new ChurchApplicationError(400, "template_target", "Member target must be between 1 and 100000");
    }
  }
  const template: RequirementTemplate = {
    id: rid("tpl_", 8).toLowerCase(),
    kind,
    title,
    description: clean(raw?.description, 300) || undefined,
    target,
    durationDays,
    createdBy: adminUserId,
    createdAt: nowIso(),
  };
  await updateStore((store) => {
    store.templates.push(template);
    return store;
  });
  console.log("KRISTO_CHURCH_REQUIREMENT_TEMPLATE_CREATED", { templateId: template.id, by: adminUserId });
  return template;
}

export async function deleteRequirementTemplate(adminUserId: string, templateId: string) {
  if (BUILTIN_TEMPLATES.some((t) => t.id === templateId)) {
    throw new ChurchApplicationError(400, "template_builtin", "Built-in templates cannot be deleted");
  }
  let removed = false;
  await updateStore((store) => {
    const before = store.templates.length;
    store.templates = store.templates.filter((t) => t.id !== templateId);
    removed = store.templates.length !== before;
    return store;
  });
  if (!removed) throw new ChurchApplicationError(404, "template_not_found", "Template not found");
  console.log("KRISTO_CHURCH_REQUIREMENT_TEMPLATE_DELETED", { templateId, by: adminUserId });
}

export type AdminListFilter = { status?: string; source?: string; q?: string };

export async function listChurchApplicationsForAdmin(filter: AdminListFilter) {
  const store = await readStore();
  const refreshed: ChurchApplication[] = [];
  for (const app of store.applications) refreshed.push(await refreshChurchApplication(app));

  const counts: Record<string, number> = { all: refreshed.length, needs_review: 0 };
  for (const s of CHURCH_APPLICATION_STATUSES) counts[s] = 0;
  for (const app of refreshed) {
    counts[app.status] = (counts[app.status] || 0) + 1;
    if (NEEDS_REVIEW_STATUSES.has(app.status)) counts.needs_review += 1;
  }
  const sourceCounts = {
    direct: refreshed.filter((a) => a.source === "direct").length,
    agent: refreshed.filter((a) => a.source === "agent").length,
  };

  const status = String(filter.status || "all");
  const source = String(filter.source || "all");
  const q = norm(filter.q);
  const rows = refreshed
    .filter((a) =>
      status === "all" ? true : status === "needs_review" ? NEEDS_REVIEW_STATUSES.has(a.status) : a.status === status
    )
    .filter((a) => (source === "all" ? true : a.source === source))
    .filter((a) => {
      if (!q) return true;
      return [
        a.id,
        a.church.name,
        a.church.city,
        a.church.country,
        a.applicantName,
        a.applicantKristoId,
        a.churchId,
        a.agent?.agentName,
        a.agent?.agentKristoId,
        a.agent?.agentCode,
      ]
        .map(norm)
        .some((v) => v.includes(q));
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return { applications: rows, counts, sourceCounts };
}

export async function getChurchApplicationForAdmin(id: string) {
  const store = await readStore();
  const app = store.applications.find((a) => a.id === id);
  if (!app) throw new ChurchApplicationError(404, "not_found", "Application not found");
  return refreshChurchApplication(app);
}

async function generateChurchId(): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const id = `CH7-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    if (/^CH7-[A-Z0-9]{6}$/.test(id) && !(await getChurchById(id))) return id;
  }
  throw new ChurchApplicationError(500, "church_id", "Could not allocate a Church ID");
}

/** Creates the church in its hidden pending state and makes the applicant its Pastor. */
async function provisionChurch(app: ChurchApplication): Promise<{ churchId: string; agent?: AgentAttribution }> {
  const active = await getActiveMembership(app.applicantUserId);
  if (active?.churchId) {
    throw new ChurchApplicationError(409, "applicant_has_church", "The applicant already belongs to another church");
  }
  if (app.agent && !app.agent.codeRedeemedAt) {
    await checkAgentCode(app.agent.agentUserId, app.agent.agentCode);
  }
  const churchId = await generateChurchId();
  await upsertChurchProfile({
    id: churchId,
    name: app.church.name,
    phone: app.church.phone,
    country: app.church.country,
    province: app.church.province,
    city: app.church.city,
    address: app.church.address || [app.church.city, app.church.province, app.church.country].filter(Boolean).join(" • "),
    pastorName: app.applicantName,
    activationStatus: "pending_requirements",
    applicationId: app.id,
  });
  const membership = await addActiveMember(churchId, app.applicantUserId, app.applicantName, "Pastor");
  if (!membership.ok) throw new ChurchApplicationError(409, "pastor_membership", membership.error);

  let agent = app.agent ? { ...app.agent } : undefined;
  if (agent && !agent.codeRedeemedAt) {
    // Attribution through the existing agent-code redemption (same rules and records as before).
    try {
      const redeemed = await activateChurchWithAgentCode({
        agentUserId: agent.agentUserId,
        churchId,
        activationCode: agent.agentCode,
      });
      agent = { ...agent, codeRedeemedAt: redeemed.activation.activatedAt, codeRedeemError: undefined };
    } catch (e) {
      agent = { ...agent, codeRedeemError: String((e as any)?.message || e) };
    }
  }
  return { churchId, agent };
}

const ACTION_ROLE: ApplicationEvent["byRole"] = "admin";

export async function applyAdminAction(input: { adminUserId: string; id: string; body: any }) {
  const { adminUserId, id, body } = input;
  const action = String(body?.action || "").trim();
  const message = clean(body?.message, 1000) || undefined;
  const expectedUpdatedAt = body?.expectedUpdatedAt ? String(body.expectedUpdatedAt) : null;

  const store = await readStore();
  const loaded = store.applications.find((a) => a.id === id);
  if (!loaded) throw new ChurchApplicationError(404, "not_found", "Application not found");
  const app = await refreshChurchApplication(loaded);
  const guardStatus = (allowed: ChurchApplicationStatus[]) => {
    if (!allowed.includes(app.status)) {
      throw new ChurchApplicationError(409, "invalid_status", `Not possible while the application is ${CHURCH_APPLICATION_STATUS_LABELS[app.status]}`);
    }
  };
  const templates = [...BUILTIN_TEMPLATES, ...store.templates];
  const at = nowIso();
  let effects: EvaluationEffects = { activated: false, ready: false, expired: false, started: false };
  let applicantTitle = "";
  let applicantMessage = "";
  let saved: ChurchApplication;

  if (action === "note") {
    // "Leave pending": record a note, status unchanged.
    if (!message) throw new ChurchApplicationError(400, "message_required", "Write a note");
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      pushEvent(a, { at, type: "admin_note", byUserId: adminUserId, byRole: ACTION_ROLE, message });
      a.updatedAt = at;
      return a;
    });
  } else if (action === "request_info") {
    guardStatus(["pending_review", "more_info_needed"]);
    if (!message) throw new ChurchApplicationError(400, "message_required", "Tell the applicant what is missing");
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      setStatus(a, "more_info_needed", { at, byUserId: adminUserId, byRole: ACTION_ROLE, message });
      a.adminMessage = message;
      a.adminMessageAt = at;
      a.applicantUnseenUpdate = true;
      a.updatedAt = at;
      return a;
    });
    applicantTitle = "More information needed";
    applicantMessage = `Kristo App needs more information about ${app.church.name}: ${message}`;
  } else if (action === "reject") {
    guardStatus(["pending_review", "more_info_needed", "conditionally_approved", "requirements_in_progress", "ready_for_admin_review", "expired"]);
    if (!message) throw new ChurchApplicationError(400, "message_required", "Give the applicant a reason");
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      setStatus(a, "rejected", { at, byUserId: adminUserId, byRole: ACTION_ROLE, message });
      a.adminMessage = message;
      a.adminMessageAt = at;
      a.decidedAt = at;
      a.decidedBy = adminUserId;
      a.applicantUnseenUpdate = true;
      a.updatedAt = at;
      return a;
    });
    // A provisioned church stays hidden; its records are kept.
    await setChurchActivation(saved, "closed");
    applicantTitle = "Church application not approved";
    applicantMessage = `${app.church.name}: ${message}`;
  } else if (action === "approve") {
    guardStatus(["pending_review", "more_info_needed"]);
    // "Approve without requirements": the church is created and activated at once.
    const withoutRequirements = body?.withoutRequirements === true;
    const activationMode: ActivationMode = withoutRequirements || body?.activationMode === "auto" ? "auto" : "admin_review";
    const rawReqs = Array.isArray(body?.requirements) ? body.requirements : [];
    if (withoutRequirements && rawReqs.length) {
      throw new ChurchApplicationError(400, "requirements_not_allowed", "Approving without requirements cannot include requirements");
    }
    if (rawReqs.length > 20) throw new ChurchApplicationError(400, "too_many_requirements", "At most 20 requirements");
    const requirements = rawReqs.map((r: any) => parseRequirementInput(r, undefined, templates));
    const provisioned = await provisionChurch(app);
    saved = await mutateApplication(id, null, (a) => {
      a.churchId = provisioned.churchId;
      a.agent = provisioned.agent;
      a.activationMode = activationMode;
      a.requirements = requirements;
      a.decidedAt = at;
      a.decidedBy = adminUserId;
      a.adminMessage = message;
      a.adminMessageAt = message ? at : a.adminMessageAt;
      a.applicantUnseenUpdate = true;
      a.approvalType = withoutRequirements ? "without_requirements" : "with_requirements";
      setStatus(a, "conditionally_approved", {
        at,
        type: withoutRequirements ? "approved_without_requirements" : "approved_with_requirements",
        byUserId: adminUserId,
        byRole: ACTION_ROLE,
        message,
        details: {
          approvalType: a.approvalType,
          churchId: provisioned.churchId,
          activationMode,
          requirements: requirements.map(describeRequirement),
          agentCodeRedeemedAt: provisioned.agent?.codeRedeemedAt,
          agentCodeRedeemError: provisioned.agent?.codeRedeemError,
        },
      });
      if (provisioned.agent?.codeRedeemedAt) {
        pushEvent(a, {
          at,
          type: "agent_attribution_recorded",
          byUserId: adminUserId,
          byRole: ACTION_ROLE,
          details: { agentCode: provisioned.agent.agentCode, agentRegistrationId: provisioned.agent.agentRegistrationId, churchId: provisioned.churchId },
        });
      }
      effects = applyEvaluation(a, 0);
      a.updatedAt = at;
      return a;
    });
    // Without requirements the church is active now; afterEffects sends "Your church is active".
    applicantTitle = withoutRequirements || !requirements.length ? "" : "Church application approved with requirements";
    applicantMessage = `${app.church.name} is approved on conditions. Open Church Requirements in the Church tab to see what to do next.`;
  } else if (action === "update_requirements") {
    guardStatus(["conditionally_approved", "requirements_in_progress", "ready_for_admin_review", "expired"]);
    const rawReqs = Array.isArray(body?.requirements) ? body.requirements : [];
    if (rawReqs.length > 20) throw new ChurchApplicationError(400, "too_many_requirements", "At most 20 requirements");
    const byId = new Map(app.requirements.map((r) => [r.id, r]));
    const next = rawReqs.map((r: any) => parseRequirementInput(r, r?.id ? byId.get(String(r.id)) : undefined, templates));
    const activationMode: ActivationMode | undefined =
      body?.activationMode === "auto" || body?.activationMode === "admin_review" ? body.activationMode : undefined;
    const members = await countVerifiedMembers(app);
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      const before = a.requirements.map(describeRequirement);
      a.requirements = next;
      if (activationMode) a.activationMode = activationMode;
      pushEvent(a, {
        at,
        type: "requirements_changed",
        byUserId: adminUserId,
        byRole: ACTION_ROLE,
        message,
        details: { before, after: next.map(describeRequirement), activationMode: a.activationMode },
      });
      // Changed requirements are evaluated again from the current state.
      if (a.status === "ready_for_admin_review" && !next.every((r: ApplicationRequirement) => r.completedAt)) {
        setStatus(a, "requirements_in_progress", { at, byUserId: adminUserId, byRole: ACTION_ROLE, message: "Requirements changed" });
      }
      effects = applyEvaluation(a, members);
      if (message) {
        a.adminMessage = message;
        a.adminMessageAt = at;
      }
      a.applicantUnseenUpdate = true;
      a.updatedAt = at;
      return a;
    });
    applicantTitle = "Church requirements updated";
    applicantMessage = `The requirements for ${app.church.name} changed. Open the Church tab to see them.`;
  } else if (action === "extend_deadline") {
    guardStatus(["conditionally_approved", "requirements_in_progress", "expired"]);
    const ms = Date.parse(String(body?.deadlineAt || ""));
    if (!Number.isFinite(ms) || ms <= Date.now()) {
      throw new ChurchApplicationError(400, "requirement_deadline", "The new deadline must be in the future");
    }
    const requirementId = String(body?.requirementId || "all");
    const members = await countVerifiedMembers(app);
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      const changed: string[] = [];
      for (const r of a.requirements) {
        if (r.completedAt || (requirementId !== "all" && r.id !== requirementId)) continue;
        changed.push(`${r.title}: ${r.deadlineAt.slice(0, 10)} -> ${new Date(ms).toISOString().slice(0, 10)}`);
        r.deadlineAt = new Date(ms).toISOString();
        r.updatedAt = at;
      }
      if (!changed.length) throw new ChurchApplicationError(400, "nothing_to_extend", "No open requirement to extend");
      pushEvent(a, { at, type: "deadline_extended", byUserId: adminUserId, byRole: ACTION_ROLE, message, details: { changed } });
      effects = applyEvaluation(a, members);
      if (message) {
        a.adminMessage = message;
        a.adminMessageAt = at;
      }
      a.applicantUnseenUpdate = true;
      a.updatedAt = at;
      return a;
    });
    applicantTitle = "Deadline extended";
    applicantMessage = `The deadline for ${app.church.name} was extended. Open the Church tab for details.`;
  } else if (action === "complete_requirement") {
    guardStatus(["conditionally_approved", "requirements_in_progress", "expired"]);
    const requirementId = String(body?.requirementId || "");
    const target = app.requirements.find((r) => r.id === requirementId);
    if (!target) throw new ChurchApplicationError(404, "requirement_not_found", "Requirement not found");
    if (target.kind !== "manual") {
      throw new ChurchApplicationError(400, "requirement_automatic", "Member requirements complete automatically");
    }
    const members = await countVerifiedMembers(app);
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      const r = a.requirements.find((x) => x.id === requirementId)!;
      r.completedAt = at;
      r.completedBy = adminUserId;
      r.updatedAt = at;
      pushEvent(a, { at, type: "requirement_confirmed", byUserId: adminUserId, byRole: ACTION_ROLE, message, details: { requirementId, title: r.title } });
      effects = applyEvaluation(a, members);
      a.applicantUnseenUpdate = true;
      a.updatedAt = at;
      return a;
    });
    applicantTitle = "Requirement completed";
    applicantMessage = `"${target.title}" is complete for ${app.church.name}.`;
  } else if (action === "activate") {
    guardStatus(["ready_for_admin_review"]);
    saved = await mutateApplication(id, expectedUpdatedAt, (a) => {
      setStatus(a, "active", { at, type: "activated", byUserId: adminUserId, byRole: ACTION_ROLE, message });
      a.activatedAt = at;
      a.activatedBy = adminUserId;
      if (message) {
        a.adminMessage = message;
        a.adminMessageAt = at;
      }
      a.applicantUnseenUpdate = true;
      a.updatedAt = at;
      return a;
    });
    await setChurchActivation(saved, "active");
    console.log("KRISTO_CHURCH_APPLICATION_ACTIVATED", { applicationId: id, churchId: saved.churchId, by: adminUserId });
    applicantTitle = "Your church is active";
    applicantMessage = `${app.church.name} is now active on Kristo App.`;
  } else {
    throw new ChurchApplicationError(400, "unknown_action", "Unknown action");
  }

  console.log("KRISTO_CHURCH_APPLICATION_ADMIN_ACTION", { applicationId: id, action, by: adminUserId, status: saved.status });
  if (applicantTitle) await notifyApplicant(saved, applicantTitle, applicantMessage);
  await afterEffects(saved, effects);
  return saved;
}

/* ------------------------------------------------------------------ */
/* Applicant                                                           */
/* ------------------------------------------------------------------ */

export async function getMyChurchApplication(userId: string): Promise<ChurchApplication | null> {
  const store = await readStore();
  const mine = store.applications
    .filter((a) => a.applicantUserId === userId)
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0];
  return mine ? refreshChurchApplication(mine) : null;
}

/** For a member (not the applicant) of a church that is not open yet. */
export async function getPendingChurchForMember(userId: string) {
  const active = await getActiveMembership(userId).catch(() => undefined);
  if (!active?.churchId) return null;
  const church = await getChurchById(active.churchId);
  if (!church?.activationStatus || church.activationStatus === "active") return null;
  const store = await readStore();
  const app = store.applications.find((a) => a.churchId === church.id);
  const refreshed = app ? await refreshChurchApplication(app) : null;
  return {
    churchId: church.id,
    churchName: church.name,
    activationStatus: church.activationStatus,
    applicationStatus: refreshed?.status,
    requirements: (refreshed?.requirements || []).map((r) => ({
      title: r.title,
      kind: r.kind,
      target: r.target,
      current: r.current,
      deadlineAt: r.deadlineAt,
      completed: !!r.completedAt,
    })),
  };
}

export async function markMyApplicationSeen(userId: string, id: string) {
  await mutateApplication(id, null, (a) => {
    if (a.applicantUserId !== userId) throw new ChurchApplicationError(404, "not_found", "Application not found");
    a.applicantUnseenUpdate = false;
    return a;
  });
}

/** The applicant answers a "More Information Needed" request; the application goes back to review. */
export async function respondToInfoRequest(userId: string, id: string, body: any) {
  const store = await readStore();
  const app = store.applications.find((a) => a.id === id && a.applicantUserId === userId);
  if (!app) throw new ChurchApplicationError(404, "not_found", "Application not found");
  if (app.status !== "more_info_needed") {
    throw new ChurchApplicationError(409, "invalid_status", "The application is not waiting for more information");
  }
  const response = clean(body?.response, 1000);
  if (!response) throw new ChurchApplicationError(400, "response_required", "Write your answer for the admin");
  const church = body?.church ? parseChurchInfo({ ...app.church, ...body.church }) : app.church;
  const at = nowIso();
  const saved = await mutateApplication(id, app.updatedAt, (a) => {
    const changedFields = (Object.keys(church) as (keyof ApplicationChurchInfo)[]).filter((k) => church[k] !== a.church[k]);
    a.church = church;
    a.dedupeKey = dedupeKeyFor(church);
    a.applicantResponse = response;
    setStatus(a, "pending_review", {
      at,
      type: "applicant_responded",
      byUserId: userId,
      byRole: "applicant",
      message: response,
      details: changedFields.length ? { changedFields } : undefined,
    });
    a.updatedAt = at;
    return a;
  });
  await notifySystemAdmins("Church application updated", `${saved.church.name} answered your request for more information.`);
  return saved;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function timelineFor(app: ChurchApplication) {
  return app.history
    .filter((e) => e.toStatus || e.type === "requirements_changed" || e.type === "deadline_extended" || e.type === "requirement_met" || e.type === "requirement_confirmed")
    .map((e) => ({
      at: e.at,
      type: e.type,
      status: e.toStatus,
      statusLabel:
        e.type === "approved_without_requirements"
          ? "Approved"
          : e.toStatus
            ? CHURCH_APPLICATION_STATUS_LABELS[e.toStatus]
            : undefined,
      message: e.byRole === "admin" || e.byRole === "applicant" ? e.message : undefined,
    }));
}

/** What the applicant may see: no admin notes, no internal ids of other users. */
export function toApplicantView(app: ChurchApplication) {
  return {
    id: app.id,
    status: app.status,
    statusLabel: CHURCH_APPLICATION_STATUS_LABELS[app.status],
    church: app.church,
    churchId: app.churchId,
    source: app.source,
    agentName: app.agent?.agentName || undefined,
    submittedAt: app.submittedAt,
    updatedAt: app.updatedAt,
    activationMode: app.activationMode,
    adminMessage: app.adminMessage,
    adminMessageAt: app.adminMessageAt,
    unseenUpdate: !!app.applicantUnseenUpdate,
    requirements: app.requirements.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      target: r.target,
      current: r.current,
      deadlineAt: r.deadlineAt,
      completed: !!r.completedAt,
      completedAt: r.completedAt,
    })),
    timeline: timelineFor(app),
  };
}

export function toAdminView(app: ChurchApplication) {
  return {
    ...app,
    statusLabel: CHURCH_APPLICATION_STATUS_LABELS[app.status],
    needsReview: NEEDS_REVIEW_STATUSES.has(app.status),
  };
}
