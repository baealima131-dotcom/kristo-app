import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { getSessionSync } from "@/src/lib/kristoSession";

export const DEFAULT_AGENT_COMMAND = "A";
export const ALL_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
export const OFFICE_STORAGE_KEY = "tlmc.kingdom.officeBoxes.v2";

export type KeyVisibility = Record<string, boolean>;

export type MyWaySettings = {
  ownerUserId: string | null;
  agentCommand: string;
  agentCommands: string[];
  commandCount: number;
  keyVisibility: KeyVisibility;
  updatedAt?: string;
};

export type OfficeBox = {
  id: string;
  title: string;
  desc: string;
  code: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge: string;
  accent: "gold" | "blue" | "red";
};

export const DEFAULT_BOXES: OfficeBox[] = [
  {
    id: "world",
    title: "THE WORLD",
    desc: "Global direction • movement • routes",
    code: "WRLD1",
    icon: "earth-outline",
    badge: "12",
    accent: "gold",
  },
  {
    id: "security",
    title: "SECURITY",
    desc: "Gate • trust • approvals • access",
    code: "SEC9",
    icon: "shield-checkmark-outline",
    badge: "4",
    accent: "red",
  },
  {
    id: "churches",
    title: "MAKANISA",
    desc: "Churches • leaders • members",
    code: "CHR7",
    icon: "business-outline",
    badge: "8",
    accent: "blue",
  },
  {
    id: "reports",
    title: "REPORT",
    desc: "Reports • stats • progress • logs",
    code: "RPT3",
    icon: "stats-chart-outline",
    badge: "3",
    accent: "gold",
  },
  {
    id: "agents",
    title: "MA AGENTS",
    desc: "Agents • assignments • missions",
    code: "AGT5",
    icon: "people-outline",
    badge: "6",
    accent: "red",
  },
  {
    id: "office",
    title: "OFFICE CORE",
    desc: "Main control • private center",
    code: "CORE1",
    icon: "grid-outline",
    badge: "1",
    accent: "blue",
  },
  {
    id: "kingdom-command",
    title: "KINGDOM COMMAND",
    desc: "Commands • sequence • save",
    code: "KCMD1",
    icon: "key-outline",
    badge: "2",
    accent: "gold",
  },
  {
    id: "key-visibility",
    title: "KEY VISIBILITY",
    desc: "Show / hide keys on gate",
    code: "KEY4",
    icon: "eye-outline",
    badge: "9",
    accent: "blue",
  },
];

export function makeDefaultVisibility(): KeyVisibility {
  const next: KeyVisibility = {};
  for (const k of ALL_KEYS) next[k] = true;
  return next;
}

export function buildKingdomHeaders() {
  const auth = getSessionSync();
  console.log("KINGDOM auth >>>", auth);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (auth?.userId) headers["x-kristo-user-id"] = auth.userId;
  if (auth?.role) headers["x-kristo-role"] = auth.role;
  if (auth?.churchId) headers["x-kristo-church-id"] = auth.churchId;
  return headers;
}

export function kingdomApiBase() {
  return String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
}

export function normalizeCode(v: string) {
  return String(v || "")
    .replace(/[^A-Z0-9]/gi, "")
    .trim()
    .toUpperCase()
    .slice(0, 16);
}

export async function fetchMyWaySettings(): Promise<MyWaySettings> {
  const fallback: MyWaySettings = {
    ownerUserId: null,
    agentCommand: DEFAULT_AGENT_COMMAND,
    agentCommands: [DEFAULT_AGENT_COMMAND],
    commandCount: 1,
    keyVisibility: makeDefaultVisibility(),
  };

  const base = kingdomApiBase();
  if (!base) return fallback;

  try {
    const r = await fetch(`${base}/api/my-way`, {
      method: "GET",
      headers: buildKingdomHeaders(),
    });

    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok || !j?.data) {
      return fallback;
    }

    const commands =
      Array.isArray(j.data.agentCommands) && j.data.agentCommands.length
        ? j.data.agentCommands
            .map((v: any) => String(v || "").trim().toUpperCase())
            .filter(Boolean)
        : [
            String(j.data.agentCommand || DEFAULT_AGENT_COMMAND)
              .trim()
              .toUpperCase() || DEFAULT_AGENT_COMMAND,
          ];

    const commandCount = Math.max(
      1,
      Math.min(4, Number(j.data.commandCount || commands.length || 1))
    );

    return {
      ownerUserId: j.data.ownerUserId || null,
      agentCommand: String(
        j.data.agentCommand || commands[0] || DEFAULT_AGENT_COMMAND
      )
        .trim()
        .toUpperCase(),
      agentCommands: commands.slice(0, 4),
      commandCount,
      keyVisibility: {
        ...makeDefaultVisibility(),
        ...(j.data.keyVisibility || {}),
      },
      updatedAt: j.data.updatedAt,
    };
  } catch {
    return fallback;
  }
}

export async function patchMyWaySettings(
  payload: Partial<MyWaySettings>
): Promise<MyWaySettings> {
  const base = kingdomApiBase();
  if (!base) throw new Error("EXPO_PUBLIC_API_BASE haijawekwa.");

  const r = await fetch(`${base}/api/my-way`, {
    method: "PATCH",
    headers: buildKingdomHeaders(),
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j?.data) {
    throw new Error(j?.error || "Imeshindikana kuhifadhi KINGDOM settings.");
  }

  const commands =
    Array.isArray(j.data.agentCommands) && j.data.agentCommands.length
      ? j.data.agentCommands.map((v: any) => String(v || "").toUpperCase())
      : [String(j.data.agentCommand || DEFAULT_AGENT_COMMAND).toUpperCase()];

  const commandCount = Math.max(
    1,
    Math.min(4, Number(j.data.commandCount || commands.length || 1))
  );

  return {
    ownerUserId: j.data.ownerUserId || null,
    agentCommand: String(
      j.data.agentCommand || commands[0] || DEFAULT_AGENT_COMMAND
    ).toUpperCase(),
    agentCommands: commands.slice(0, 4),
    commandCount,
    keyVisibility: {
      ...makeDefaultVisibility(),
      ...(j.data.keyVisibility || {}),
    },
    updatedAt: j.data.updatedAt,
  };
}

export async function loadBoxes(): Promise<OfficeBox[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFICE_STORAGE_KEY);
    if (!raw) return DEFAULT_BOXES;
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_BOXES;

    return DEFAULT_BOXES.map((base) => {
      const found = parsed.find((x: any) => String(x?.id || "") === base.id);
      return {
        ...base,
        code: found?.code ? normalizeCode(found.code) || base.code : base.code,
      };
    });
  } catch {
    return DEFAULT_BOXES;
  }
}

export async function saveBoxes(next: OfficeBox[]) {
  await AsyncStorage.setItem(OFFICE_STORAGE_KEY, JSON.stringify(next));
}

export const INNER_ROOM_BOX_ID_MAP: Record<string, OfficeBox["id"]> = {
  world: "world",
  security: "security",
  churches: "churches",
  report: "reports",
  agents: "agents",
  command: "kingdom-command",
  visibility: "key-visibility",
};

export function getInnerRoomOfficeBoxId(key: string): OfficeBox["id"] | null {
  return INNER_ROOM_BOX_ID_MAP[String(key || "").toLowerCase()] || null;
}
