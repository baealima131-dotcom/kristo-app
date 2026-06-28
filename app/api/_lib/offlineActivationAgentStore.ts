import {
  OFFLINE_ACTIVATION_AGENTS_STORE_KEY,
  readOfflineActivationJsonFile,
  updateOfflineActivationJsonFile,
} from "@/app/api/_lib/store/offlineActivationDb";

export type OfflineActivationAgentStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "inactive";

export function isAcceptedAgentStatus(status: string): boolean {
  const raw = String(status || "").trim();
  return raw === "accepted" || raw === "active";
}

export type OfflineActivationAgent = {
  id: string;
  supervisorUserId: string;
  kristoId: string;
  churchId: string;
  fullName: string;
  phone: string;
  status: OfflineActivationAgentStatus;
  avatarUrl?: string;
  linkedUserId?: string;
  createdAt: string;
  updatedAt: string;
};

type AgentStore = {
  agents: OfflineActivationAgent[];
};

const STORE_FILE = OFFLINE_ACTIVATION_AGENTS_STORE_KEY;

function newAgentId(): string {
  return `oactagent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAgentStatus(raw: unknown): OfflineActivationAgentStatus {
  const statusRaw = String(raw || "accepted").trim();
  if (statusRaw === "active") return "accepted";
  if (
    statusRaw === "pending" ||
    statusRaw === "accepted" ||
    statusRaw === "declined" ||
    statusRaw === "inactive"
  ) {
    return statusRaw;
  }
  return "accepted";
}

function normalizeAgent(raw: Partial<OfflineActivationAgent>): OfflineActivationAgent {
  const status = normalizeAgentStatus(raw.status);
  return {
    id: String(raw.id || "").trim(),
    supervisorUserId: String(raw.supervisorUserId || "").trim(),
    kristoId: String(raw.kristoId || "").trim().toUpperCase(),
    churchId: String(raw.churchId || "").trim(),
    fullName: String(raw.fullName || "").trim(),
    phone: String(raw.phone || "").trim(),
    status,
    avatarUrl: raw.avatarUrl ? String(raw.avatarUrl).trim() : undefined,
    linkedUserId: raw.linkedUserId ? String(raw.linkedUserId).trim() : undefined,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
  };
}

async function readStore(): Promise<AgentStore> {
  const rows = await readOfflineActivationJsonFile<AgentStore>(STORE_FILE, { agents: [] });
  const agents = Array.isArray(rows?.agents) ? rows.agents.map((row) => normalizeAgent(row)) : [];
  return { agents };
}

export async function listAgentsByLinkedUserId(linkedUserId: string): Promise<OfflineActivationAgent[]> {
  const uid = String(linkedUserId || "").trim();
  if (!uid) return [];
  const store = await readStore();
  return store.agents
    .filter((row) => String(row.linkedUserId || "").trim() === uid)
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

export async function listSupervisorAgents(supervisorUserId: string): Promise<OfflineActivationAgent[]> {
  const uid = String(supervisorUserId || "").trim();
  if (!uid) return [];
  const store = await readStore();
  return store.agents
    .filter((row) => row.supervisorUserId === uid)
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

export async function getSupervisorAgent(
  supervisorUserId: string,
  agentId: string
): Promise<OfflineActivationAgent | null> {
  const uid = String(supervisorUserId || "").trim();
  const id = String(agentId || "").trim();
  if (!uid || !id) return null;
  const store = await readStore();
  return store.agents.find((row) => row.supervisorUserId === uid && row.id === id) || null;
}

export async function findSupervisorAgentByLinkedUser(
  supervisorUserId: string,
  linkedUserId: string,
  churchId: string
): Promise<OfflineActivationAgent | null> {
  const uid = String(supervisorUserId || "").trim();
  const linked = String(linkedUserId || "").trim();
  const church = String(churchId || "").trim();
  if (!uid || !linked || !church) return null;
  const store = await readStore();
  return (
    store.agents.find(
      (row) =>
        row.supervisorUserId === uid &&
        String(row.linkedUserId || "").trim() === linked &&
        String(row.churchId || "").trim() === church
    ) || null
  );
}

export async function createSupervisorAgent(input: {
  supervisorUserId: string;
  kristoId: string;
  churchId: string;
  fullName: string;
  phone?: string;
  status?: OfflineActivationAgentStatus;
  avatarUrl?: string;
  linkedUserId: string;
}): Promise<OfflineActivationAgent> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const kristoId = String(input.kristoId || "").trim().toUpperCase();
  const churchId = String(input.churchId || "").trim();
  const fullName = String(input.fullName || "").trim();
  const linkedUserId = String(input.linkedUserId || "").trim();
  if (!supervisorUserId) throw new Error("supervisorUserId required");
  if (!kristoId) throw new Error("KRISTO ID is required");
  if (!churchId) throw new Error("Church ID is required");
  if (!linkedUserId) throw new Error("linkedUserId required");
  if (!fullName) throw new Error("Could not resolve agent name");

  const existing = await findSupervisorAgentByLinkedUser(supervisorUserId, linkedUserId, churchId);
  if (existing) {
    throw new Error("This agent is already registered for this church");
  }

  const now = new Date().toISOString();
  const agent = normalizeAgent({
    id: newAgentId(),
    supervisorUserId,
    kristoId,
    churchId,
    fullName,
    phone: String(input.phone || "").trim(),
    status: input.status || "pending",
    avatarUrl: input.avatarUrl,
    linkedUserId,
    createdAt: now,
    updatedAt: now,
  });

  await updateOfflineActivationJsonFile<AgentStore>(
    STORE_FILE,
    (current) => {
      const agents = Array.isArray(current?.agents) ? current.agents.map((row) => normalizeAgent(row)) : [];
      return { agents: [agent, ...agents] };
    },
    { agents: [] }
  );

  return agent;
}

export async function updateSupervisorAgent(input: {
  supervisorUserId: string;
  agentId: string;
  fullName?: string;
  phone?: string;
  status?: OfflineActivationAgentStatus;
  avatarUrl?: string;
}): Promise<OfflineActivationAgent> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const agentId = String(input.agentId || "").trim();
  if (!supervisorUserId || !agentId) throw new Error("supervisorUserId and agentId required");

  let updated: OfflineActivationAgent | null = null;
  await updateOfflineActivationJsonFile<AgentStore>(
    STORE_FILE,
    (current) => {
      const agents = Array.isArray(current?.agents) ? current.agents.map((row) => normalizeAgent(row)) : [];
      const idx = agents.findIndex((row) => row.supervisorUserId === supervisorUserId && row.id === agentId);
      if (idx < 0) throw new Error("Agent not found");
      updated = normalizeAgent({
        ...agents[idx],
        ...(input.fullName !== undefined ? { fullName: String(input.fullName || "").trim() } : {}),
        ...(input.phone !== undefined ? { phone: String(input.phone || "").trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: String(input.avatarUrl || "").trim() || undefined } : {}),
        updatedAt: new Date().toISOString(),
      });
      agents[idx] = updated;
      return { agents };
    },
    { agents: [] }
  );

  if (!updated) throw new Error("Agent not found");
  return updated;
}

export async function deleteSupervisorAgent(supervisorUserId: string, agentId: string): Promise<boolean> {
  const uid = String(supervisorUserId || "").trim();
  const id = String(agentId || "").trim();
  if (!uid || !id) return false;

  let removed = false;
  await updateOfflineActivationJsonFile<AgentStore>(
    STORE_FILE,
    (current) => {
      const agents = Array.isArray(current?.agents) ? current.agents.map((row) => normalizeAgent(row)) : [];
      const next = agents.filter((row) => !(row.supervisorUserId === uid && row.id === id));
      removed = next.length !== agents.length;
      return { agents: next };
    },
    { agents: [] }
  );

  return removed;
}

export async function resolveAgentDisplayName(agentId: string): Promise<string | undefined> {
  const id = String(agentId || "").trim();
  if (!id) return undefined;
  const store = await readStore();
  const agent = store.agents.find((row) => row.id === id);
  return agent?.fullName || undefined;
}

export async function updateAgentRegistrationStatusByInvite(input: {
  supervisorUserId: string;
  linkedUserId: string;
  churchId: string;
  status: OfflineActivationAgentStatus;
}): Promise<OfflineActivationAgent | null> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const linkedUserId = String(input.linkedUserId || "").trim();
  const churchId = String(input.churchId || "").trim();
  if (!supervisorUserId || !linkedUserId || !churchId) return null;

  let updated: OfflineActivationAgent | null = null;
  await updateOfflineActivationJsonFile<AgentStore>(
    STORE_FILE,
    (current) => {
      const agents = Array.isArray(current?.agents) ? current.agents.map((row) => normalizeAgent(row)) : [];
      const idx = agents.findIndex(
        (row) =>
          row.supervisorUserId === supervisorUserId &&
          String(row.linkedUserId || "").trim() === linkedUserId &&
          String(row.churchId || "").trim() === churchId
      );
      if (idx < 0) return { agents };
      updated = normalizeAgent({
        ...agents[idx],
        status: input.status,
        updatedAt: new Date().toISOString(),
      });
      agents[idx] = updated;
      return { agents };
    },
    { agents: [] }
  );

  return updated;
}
