export const MY_WAY_COMMAND_LENGTH = 6;

export type MyWayCommandResolution = {
  code: string;
  title: string;
  description?: string;
  action: "navigate";
  route: string;
  source: "builtin" | "kingdom-box" | "api" | "local";
};

const KINGDOM_BOX_ROUTES: Record<string, string> = {
  world: "/kingdom/world",
  security: "/kingdom/security",
  churches: "/kingdom/churches",
  reports: "/kingdom/reports",
  agents: "/kingdom/agents",
  office: "/kingdom/office-core",
  "kingdom-command": "/kingdom/kingdom-command",
  "key-visibility": "/kingdom/key-visibility",
};

const KINGDOM_BOX_CODES: Array<{ id: string; title: string; desc: string; code: string }> = [
  { id: "world", title: "THE WORLD", desc: "Global direction • movement • routes", code: "WRLD1" },
  { id: "security", title: "SECURITY", desc: "Gate • trust • approvals • access", code: "SEC9" },
  { id: "churches", title: "MAKANISA", desc: "Churches • leaders • members", code: "CHR7" },
  { id: "reports", title: "REPORT", desc: "Reports • stats • progress • logs", code: "RPT3" },
  { id: "agents", title: "MA AGENTS", desc: "Agents • assignments • missions", code: "AGT5" },
  { id: "office", title: "OFFICE CORE", desc: "Main control • private center", code: "CORE1" },
  {
    id: "kingdom-command",
    title: "KINGDOM COMMAND",
    desc: "Commands • sequence • save",
    code: "KCMD1",
  },
  { id: "key-visibility", title: "KEY VISIBILITY", desc: "Show / hide keys on gate", code: "KEY4" },
];

/** V1 built-in 6-character MY WAY commands (Kristo App destinations). */
const BUILTIN_MY_WAY_COMMANDS: MyWayCommandResolution[] = [
  {
    code: "NOTIFY",
    title: "Notifications",
    description: "Open your Kristo notifications inbox.",
    action: "navigate",
    route: "/more/notifications",
    source: "builtin",
  },
  {
    code: "CHURCH",
    title: "Church Room",
    description: "Open Church Room messages.",
    action: "navigate",
    route: "/more/my-church-room/messages",
    source: "builtin",
  },
  {
    code: "KNGDOM",
    title: "Kingdom",
    description: "Open the Kingdom control screen.",
    action: "navigate",
    route: "/more/kingdom",
    source: "builtin",
  },
  {
    code: "BIBLE1",
    title: "Bible",
    description: "Open Bible reading.",
    action: "navigate",
    route: "/more/bible",
    source: "builtin",
  },
];

function padKingdomBoxCode(raw: string): string {
  const normalized = String(raw || "")
    .replace(/[^A-Z0-9]/gi, "")
    .trim()
    .toUpperCase();
  if (!normalized) return "";
  if (normalized.length >= MY_WAY_COMMAND_LENGTH) {
    return normalized.slice(0, MY_WAY_COMMAND_LENGTH);
  }
  return normalized.padEnd(MY_WAY_COMMAND_LENGTH, "0");
}

function kingdomBoxCommands(): MyWayCommandResolution[] {
  return KINGDOM_BOX_CODES.map((box) => {
    const route = KINGDOM_BOX_ROUTES[box.id] || `/kingdom/${box.id}`;
    return {
      code: padKingdomBoxCode(box.code),
      title: box.title,
      description: box.desc,
      action: "navigate" as const,
      route,
      source: "kingdom-box" as const,
    };
  }).filter((entry) => entry.code.length === MY_WAY_COMMAND_LENGTH);
}

export function normalizeMyWayCommandCode(value: string): string {
  return String(value || "")
    .replace(/[^A-Z0-9]/gi, "")
    .trim()
    .toUpperCase()
    .slice(0, MY_WAY_COMMAND_LENGTH);
}

export function listMyWayCommands(): MyWayCommandResolution[] {
  const byCode = new Map<string, MyWayCommandResolution>();

  for (const entry of kingdomBoxCommands()) {
    byCode.set(entry.code, entry);
  }
  for (const entry of BUILTIN_MY_WAY_COMMANDS) {
    byCode.set(entry.code, entry);
  }

  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export function resolveMyWayCommandCode(code: string): MyWayCommandResolution | null {
  const normalized = normalizeMyWayCommandCode(code);
  if (normalized.length !== MY_WAY_COMMAND_LENGTH) return null;
  return listMyWayCommands().find((entry) => entry.code === normalized) || null;
}
