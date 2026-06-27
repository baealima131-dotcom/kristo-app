import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { hasDurableStore } from "@/app/api/_lib/store/authDb";
import {
  dbCreateSupervisorInvitation,
  dbFindPendingSupervisorInvitation,
  dbGetInvitationById,
  dbListPendingInvitationsForUser,
  dbListPendingSupervisorInvitations,
  dbUpdateInvitationStatus,
  ensureOfflineActivationInvitationStoreReady,
  resolveOfflineActivationInvitationStoreMode,
  type OfflineActivationInvitationRecord,
  type OfflineActivationInvitationRole,
  type OfflineActivationInvitationStatus,
} from "@/app/api/_lib/store/offlineActivationInvitationDb";
import { upsertPlatformRole, type PlatformRole } from "@/app/api/_lib/platformRoles";

export type {
  OfflineActivationInvitationRole,
  OfflineActivationInvitationStatus,
};

export type OfflineActivationInvitation = OfflineActivationInvitationRecord;

type InvitationStore = {
  invitations: OfflineActivationInvitation[];
};

const STORE_FILE = "offline_activation_invitations.json";

let storeModeLogged = false;

function logStoreModeOnce() {
  if (storeModeLogged) return;
  storeModeLogged = true;
  console.log("KRISTO_OFFLINE_INVITES_STORE_MODE", {
    mode: resolveOfflineActivationInvitationStoreMode(),
  });
}

function newInvitationId(): string {
  return `oactinv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeInvitation(raw: Partial<OfflineActivationInvitation>): OfflineActivationInvitation {
  const statusRaw = String(raw.status || "pending").trim();
  let status: OfflineActivationInvitationStatus = "pending";
  if (
    statusRaw === "accepted" ||
    statusRaw === "declined" ||
    statusRaw === "cancelled" ||
    statusRaw === "pending"
  ) {
    status = statusRaw;
  }

  return {
    id: String(raw.id || "").trim(),
    inviteeUserId: String(raw.inviteeUserId || "").trim(),
    inviteeKristoId: String(raw.inviteeKristoId || "").trim().toUpperCase(),
    churchId: String(raw.churchId || "").trim(),
    invitedByUserId: String(raw.invitedByUserId || "").trim(),
    role: "Supervisor",
    status,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    respondedAt: raw.respondedAt ? String(raw.respondedAt) : null,
  };
}

async function readJsonStore(): Promise<InvitationStore> {
  const rows = await readJsonFile<InvitationStore>(STORE_FILE, { invitations: [] });
  const invitations = Array.isArray(rows?.invitations)
    ? rows.invitations.map((row) => normalizeInvitation(row))
    : [];
  return { invitations };
}

async function ensureStoreReady() {
  logStoreModeOnce();
  if (hasDurableStore()) {
    await ensureOfflineActivationInvitationStoreReady();
  }
}

export async function findPendingSupervisorInvitation(input: {
  inviteeUserId: string;
  churchId: string;
}): Promise<OfflineActivationInvitation | null> {
  await ensureStoreReady();

  if (hasDurableStore()) {
    return dbFindPendingSupervisorInvitation(input);
  }

  const inviteeUserId = String(input.inviteeUserId || "").trim();
  const churchId = String(input.churchId || "").trim();
  if (!inviteeUserId || !churchId) return null;

  const store = await readJsonStore();
  return (
    store.invitations.find(
      (row) =>
        row.inviteeUserId === inviteeUserId &&
        row.churchId === churchId &&
        row.role === "Supervisor" &&
        row.status === "pending"
    ) || null
  );
}

export async function createSupervisorInvitation(input: {
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
}): Promise<OfflineActivationInvitation> {
  await ensureStoreReady();

  if (hasDurableStore()) {
    const invitation = await dbCreateSupervisorInvitation(input);
    console.log("KRISTO_OFFLINE_INVITES_CREATE_PERSISTED", {
      mode: "postgres",
      invitationId: invitation.id,
      inviteeUserId: invitation.inviteeUserId,
      churchId: invitation.churchId,
      status: invitation.status,
    });
    return invitation;
  }

  const inviteeUserId = String(input.inviteeUserId || "").trim();
  const inviteeKristoId = String(input.inviteeKristoId || "").trim().toUpperCase();
  const churchId = String(input.churchId || "").trim();
  const invitedByUserId = String(input.invitedByUserId || "").trim();

  if (!inviteeUserId) throw new Error("inviteeUserId required");
  if (!inviteeKristoId) throw new Error("inviteeKristoId required");
  if (!churchId) throw new Error("churchId required");
  if (!invitedByUserId) throw new Error("invitedByUserId required");

  const existing = await findPendingSupervisorInvitation({ inviteeUserId, churchId });
  if (existing) return existing;

  const createdAt = new Date().toISOString();
  const invitation = normalizeInvitation({
    id: newInvitationId(),
    inviteeUserId,
    inviteeKristoId,
    churchId,
    invitedByUserId,
    role: "Supervisor",
    status: "pending",
    createdAt,
    respondedAt: null,
  });

  await updateJsonFile<InvitationStore>(
    STORE_FILE,
    (current) => {
      const invitations = Array.isArray(current?.invitations)
        ? current.invitations.map((row) => normalizeInvitation(row))
        : [];
      invitations.push(invitation);
      return { invitations };
    },
    { invitations: [] }
  );

  console.log("KRISTO_OFFLINE_INVITES_CREATE_PERSISTED", {
    mode: "local-json",
    invitationId: invitation.id,
    inviteeUserId: invitation.inviteeUserId,
    churchId: invitation.churchId,
    status: invitation.status,
  });

  return invitation;
}

export async function listPendingInvitationsForUser(
  userId: string
): Promise<OfflineActivationInvitation[]> {
  await ensureStoreReady();

  if (hasDurableStore()) {
    return dbListPendingInvitationsForUser(userId);
  }

  const uid = String(userId || "").trim();
  if (!uid) return [];

  const store = await readJsonStore();
  return store.invitations
    .filter((row) => row.inviteeUserId === uid && row.status === "pending")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

export async function listPendingSupervisorInvitations(): Promise<OfflineActivationInvitation[]> {
  await ensureStoreReady();

  if (hasDurableStore()) {
    return dbListPendingSupervisorInvitations();
  }

  const store = await readJsonStore();
  return store.invitations
    .filter((row) => row.role === "Supervisor" && row.status === "pending")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

export async function getInvitationById(
  invitationId: string
): Promise<OfflineActivationInvitation | null> {
  await ensureStoreReady();

  if (hasDurableStore()) {
    return dbGetInvitationById(invitationId);
  }

  const id = String(invitationId || "").trim();
  if (!id) return null;

  const store = await readJsonStore();
  return store.invitations.find((row) => row.id === id) || null;
}

async function persistInvitationResponse(input: {
  invitationId: string;
  status: OfflineActivationInvitationStatus;
  respondedAt: string;
}): Promise<OfflineActivationInvitation> {
  if (hasDurableStore()) {
    const updated = await dbUpdateInvitationStatus(input);
    console.log("KRISTO_OFFLINE_INVITES_RESPOND_PERSISTED", {
      mode: "postgres",
      invitationId: updated.id,
      status: updated.status,
      inviteeUserId: updated.inviteeUserId,
    });
    return updated;
  }

  let updated: OfflineActivationInvitation | null = null;
  await updateJsonFile<InvitationStore>(
    STORE_FILE,
    (current) => {
      const invitations = Array.isArray(current?.invitations)
        ? current.invitations.map((row) => normalizeInvitation(row))
        : [];
      const idx = invitations.findIndex((row) => row.id === input.invitationId);
      if (idx < 0) throw new Error("Invitation not found");
      updated = normalizeInvitation({
        ...invitations[idx],
        status: input.status,
        respondedAt: input.respondedAt,
      });
      invitations[idx] = updated;
      return { invitations };
    },
    { invitations: [] }
  );

  if (!updated) throw new Error("Invitation not found");

  console.log("KRISTO_OFFLINE_INVITES_RESPOND_PERSISTED", {
    mode: "local-json",
    invitationId: updated.id,
    status: updated.status,
    inviteeUserId: updated.inviteeUserId,
  });

  return updated;
}

export async function respondToInvitation(input: {
  invitationId: string;
  inviteeUserId: string;
  action: "accept" | "decline";
}): Promise<{ invitation: OfflineActivationInvitation; platformRole: PlatformRole | null }> {
  await ensureStoreReady();

  const invitationId = String(input.invitationId || "").trim();
  const inviteeUserId = String(input.inviteeUserId || "").trim();
  const action = input.action;

  if (!invitationId) throw new Error("invitationId required");
  if (!inviteeUserId) throw new Error("Not authorized");
  if (action !== "accept" && action !== "decline") {
    throw new Error("action must be accept or decline");
  }

  const existing = await getInvitationById(invitationId);
  if (!existing) throw new Error("Invitation not found");
  if (existing.inviteeUserId !== inviteeUserId) {
    throw new Error("Not authorized to respond to this invitation");
  }
  if (existing.status !== "pending") {
    throw new Error(`Invitation is already ${existing.status}`);
  }

  const respondedAt = new Date().toISOString();

  if (action === "decline") {
    const declined = await persistInvitationResponse({
      invitationId,
      status: "declined",
      respondedAt,
    });
    return { invitation: declined, platformRole: null };
  }

  const savedRole = await upsertPlatformRole(
    inviteeUserId,
    "Supervisor",
    `Supervisor for ${existing.churchId} • KRISTO ${existing.inviteeKristoId} • accepted invitation ${existing.id}`
  );

  const accepted = await persistInvitationResponse({
    invitationId,
    status: "accepted",
    respondedAt,
  });

  return { invitation: accepted, platformRole: savedRole.platformRole };
}

export { resolveOfflineActivationInvitationStoreMode };
