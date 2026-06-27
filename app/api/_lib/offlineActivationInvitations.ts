import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { upsertPlatformRole, type PlatformRole } from "@/app/api/_lib/platformRoles";

export type OfflineActivationInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled";

export type OfflineActivationInvitationRole = "Supervisor";

export type OfflineActivationInvitation = {
  id: string;
  inviteeUserId: string;
  inviteeKristoId: string;
  churchId: string;
  invitedByUserId: string;
  role: OfflineActivationInvitationRole;
  status: OfflineActivationInvitationStatus;
  createdAt: string;
  respondedAt?: string | null;
};

type InvitationStore = {
  invitations: OfflineActivationInvitation[];
};

const STORE_FILE = "offline_activation_invitations.json";

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

async function readStore(): Promise<InvitationStore> {
  const rows = await readJsonFile<InvitationStore>(STORE_FILE, { invitations: [] });
  const invitations = Array.isArray(rows?.invitations)
    ? rows.invitations.map((row) => normalizeInvitation(row))
    : [];
  return { invitations };
}

export async function findPendingSupervisorInvitation(input: {
  inviteeUserId: string;
  churchId: string;
}): Promise<OfflineActivationInvitation | null> {
  const inviteeUserId = String(input.inviteeUserId || "").trim();
  const churchId = String(input.churchId || "").trim();
  if (!inviteeUserId || !churchId) return null;

  const store = await readStore();
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

  return invitation;
}

export async function listPendingInvitationsForUser(
  userId: string
): Promise<OfflineActivationInvitation[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];

  const store = await readStore();
  return store.invitations
    .filter((row) => row.inviteeUserId === uid && row.status === "pending")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

export async function listPendingSupervisorInvitations(): Promise<OfflineActivationInvitation[]> {
  const store = await readStore();
  return store.invitations
    .filter((row) => row.role === "Supervisor" && row.status === "pending")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

export async function getInvitationById(
  invitationId: string
): Promise<OfflineActivationInvitation | null> {
  const id = String(invitationId || "").trim();
  if (!id) return null;

  const store = await readStore();
  return store.invitations.find((row) => row.id === id) || null;
}

export async function respondToInvitation(input: {
  invitationId: string;
  inviteeUserId: string;
  action: "accept" | "decline";
}): Promise<{ invitation: OfflineActivationInvitation; platformRole: PlatformRole | null }> {
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
    let declined: OfflineActivationInvitation = existing;
    await updateJsonFile<InvitationStore>(
      STORE_FILE,
      (current) => {
        const invitations = Array.isArray(current?.invitations)
          ? current.invitations.map((row) => normalizeInvitation(row))
          : [];
        const idx = invitations.findIndex((row) => row.id === invitationId);
        if (idx < 0) throw new Error("Invitation not found");
        declined = normalizeInvitation({
          ...invitations[idx],
          status: "declined",
          respondedAt,
        });
        invitations[idx] = declined;
        return { invitations };
      },
      { invitations: [] }
    );
    return { invitation: declined, platformRole: null };
  }

  const savedRole = await upsertPlatformRole(
    inviteeUserId,
    "Supervisor",
    `Supervisor for ${existing.churchId} • KRISTO ${existing.inviteeKristoId} • accepted invitation ${existing.id}`
  );

  let accepted: OfflineActivationInvitation = existing;
  await updateJsonFile<InvitationStore>(
    STORE_FILE,
    (current) => {
      const invitations = Array.isArray(current?.invitations)
        ? current.invitations.map((row) => normalizeInvitation(row))
        : [];
      const idx = invitations.findIndex((row) => row.id === invitationId);
      if (idx < 0) throw new Error("Invitation not found");
      accepted = normalizeInvitation({
        ...invitations[idx],
        status: "accepted",
        respondedAt,
      });
      invitations[idx] = accepted;
      return { invitations };
    },
    { invitations: [] }
  );

  return { invitation: accepted, platformRole: savedRole.platformRole };
}
