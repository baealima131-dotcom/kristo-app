import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type OfflineActivationAgentStatus = "active" | "inactive";

export type OfflineActivationAgent = {
  id: string;
  supervisorUserId: string;
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

const STORE_FILE = "offline_activation_agents.json";

function newAgentId(): string {
  return `oactagent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAgent(raw: Partial<OfflineActivationAgent>): OfflineActivationAgent {
  const statusRaw = String(raw.status || "active").trim();
  const status: OfflineActivationAgentStatus = statusRaw === "inactive" ? "inactive" : "active";
  return {
    id: String(raw.id || "").trim(),
    supervisorUserId: String(raw.supervisorUserId || "").trim(),
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
  const rows = await readJsonFile<AgentStore>(STORE_FILE, { agents: [] });
  const agents = Array.isArray(rows?.agents) ? rows.agents.map((row) => normalizeAgent(row)) : [];
  return { agents };
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

export async function createSupervisorAgent(input: {
  supervisorUserId: string;
  fullName: string;
  phone: string;
  status?: OfflineActivationAgentStatus;
  avatarUrl?: string;
  linkedUserId?: string;
}): Promise<OfflineActivationAgent> {
  const supervisorUserId = String(input.supervisorUserId || "").trim();
  const fullName = String(input.fullName || "").trim();
  const phone = String(input.phone || "").trim();
  if (!supervisorUserId) throw new Error("supervisorUserId required");
  if (!fullName) throw new Error("Agent name is required");
  if (!phone) throw new Error("Phone number is required");

  const now = new Date().toISOString();
  const agent = normalizeAgent({
    id: newAgentId(),
    supervisorUserId,
    fullName,
    phone,
    status: input.status || "active",
    avatarUrl: input.avatarUrl,
    linkedUserId: input.linkedUserId,
    createdAt: now,
    updatedAt: now,
  });

  await updateJsonFile<AgentStore>(
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
  await updateJsonFile<AgentStore>(
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
  await updateJsonFile<AgentStore>(
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
