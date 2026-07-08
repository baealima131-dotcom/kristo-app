import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getViewer } from "@/app/api/_lib/auth";
import {
  MY_WAY_SETTINGS_STORE_KEY,
  readCoreJsonFile,
  updateCoreJsonFile,
} from "@/app/api/_lib/store/coreDb";

export const runtime = "nodejs";

const ALL_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const DEFAULT_AGENT_COMMAND = "A";

type KeyVisibility = Record<string, boolean>;

type MyWaySettingsRecord = {
  ownerUserId: string | null;
  agentCommand: string;
  agentCommands: string[];
  commandCount: number;
  keyVisibility: KeyVisibility;
  updatedAt?: string;
};

function makeDefaultVisibility(): KeyVisibility {
  const next: KeyVisibility = {};
  for (const k of ALL_KEYS) next[k] = true;
  return next;
}

function defaultSettings(): MyWaySettingsRecord {
  return {
    ownerUserId: null,
    agentCommand: DEFAULT_AGENT_COMMAND,
    agentCommands: [DEFAULT_AGENT_COMMAND],
    commandCount: 1,
    keyVisibility: makeDefaultVisibility(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSettings(raw: Partial<MyWaySettingsRecord> | null | undefined): MyWaySettingsRecord {
  const fallback = defaultSettings();
  const commands =
    Array.isArray(raw?.agentCommands) && raw!.agentCommands!.length
      ? raw!
          .agentCommands!.map((v) => String(v || "").trim().toUpperCase())
          .filter(Boolean)
      : [String(raw?.agentCommand || DEFAULT_AGENT_COMMAND).trim().toUpperCase() || DEFAULT_AGENT_COMMAND];

  const commandCount = Math.max(1, Math.min(4, Number(raw?.commandCount || commands.length || 1)));

  return {
    ownerUserId: raw?.ownerUserId ? String(raw.ownerUserId).trim() : null,
    agentCommand: String(raw?.agentCommand || commands[0] || DEFAULT_AGENT_COMMAND)
      .trim()
      .toUpperCase(),
    agentCommands: commands.slice(0, 4),
    commandCount,
    keyVisibility: {
      ...makeDefaultVisibility(),
      ...(raw?.keyVisibility || {}),
    },
    updatedAt: raw?.updatedAt || fallback.updatedAt,
  };
}

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

async function readSettings(): Promise<MyWaySettingsRecord> {
  const raw = await readCoreJsonFile<Partial<MyWaySettingsRecord>>(
    MY_WAY_SETTINGS_STORE_KEY,
    defaultSettings()
  );
  return normalizeSettings(raw);
}

export async function GET(req: NextRequest) {
  await getViewer(req);
  const data = await readSettings();
  return json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const viewer = await getViewer(req);
  const body = await req.json().catch(() => ({} as Partial<MyWaySettingsRecord>));

  const data = await updateCoreJsonFile<Partial<MyWaySettingsRecord>>(
    MY_WAY_SETTINGS_STORE_KEY,
    (current) => {
      const base = normalizeSettings(current);
      const nextCommands =
        Array.isArray(body.agentCommands) && body.agentCommands.length
          ? body.agentCommands.map((v: unknown) => String(v || "").trim().toUpperCase()).filter(Boolean)
          : base.agentCommands;

      return normalizeSettings({
        ...base,
        ...body,
        ownerUserId:
          body.ownerUserId !== undefined
            ? body.ownerUserId
              ? String(body.ownerUserId).trim()
              : null
            : base.ownerUserId || (viewer.userId ? String(viewer.userId) : null),
        agentCommand: body.agentCommand
          ? String(body.agentCommand).trim().toUpperCase()
          : base.agentCommand,
        agentCommands: nextCommands,
        commandCount:
          body.commandCount !== undefined ? Number(body.commandCount) : base.commandCount,
        keyVisibility: {
          ...base.keyVisibility,
          ...(body.keyVisibility || {}),
        },
        updatedAt: new Date().toISOString(),
      });
    },
    defaultSettings()
  );

  return json({ ok: true, data: normalizeSettings(data) });
}
