import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";

const FILE_NAME = "my_way_settings.json";
const DEFAULT_AGENT_COMMAND = "A";
const ALL_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

type KeyVisibility = Record<string, boolean>;

type MyWaySettings = {
  ownerUserId: string | null;
  agentCommand: string;
  agentCommands: string[];
  commandCount: number;
  keyVisibility: KeyVisibility;
  updatedAt: string;
};

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function makeDefaultVisibility(): KeyVisibility {
  const next: KeyVisibility = {};
  for (const k of ALL_KEYS) next[k] = true;
  return next;
}

function normalizeSingleCommand(v: unknown) {
  const next = String(v || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();

  if (!next) throw new Error("Command required");
  if (next.length < 1 || next.length > 16) {
    throw new Error("Command iwe kati ya 1 hadi 16.");
  }
  if (!/^[A-Z0-9]+$/.test(next)) {
    throw new Error("Tumia herufi A-Z au number 0-9 tu.");
  }
  return next;
}

function normalizeCommands(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const next = raw
    .map((v) => String(v || "").replace(/\s+/g, "").trim().toUpperCase())
    .filter(Boolean);

  if (next.length < 1) return [DEFAULT_AGENT_COMMAND];
  if (next.length > 4) throw new Error("Unaweza kuweka command 1 hadi 4 tu.");

  const validated = next.map(normalizeSingleCommand);
  return validated.slice(0, 4);
}

function normalizeCommandCount(v: unknown, commandsLen: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return Math.max(1, Math.min(4, commandsLen));
  return Math.max(1, Math.min(4, Math.trunc(n), commandsLen));
}

function normalizeVisibility(input: unknown, forcedVisible: string[] = []) {
  const merged = makeDefaultVisibility();
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  for (const k of ALL_KEYS) {
    if (typeof raw[k] === "boolean") merged[k] = raw[k] as boolean;
  }

  for (const k of forcedVisible) {
    if (/^[A-Z0-9]$/.test(k)) merged[k] = true;
  }

  return merged;
}

async function readSettings(): Promise<MyWaySettings> {
  const fallback: MyWaySettings = {
    ownerUserId: null,
    agentCommand: DEFAULT_AGENT_COMMAND,
    agentCommands: [DEFAULT_AGENT_COMMAND],
    commandCount: 1,
    keyVisibility: makeDefaultVisibility(),
    updatedAt: new Date(0).toISOString(),
  };

  const raw = await readJsonFile<any>(FILE_NAME, fallback);

  let agentCommands: string[];
  try {
    if (Array.isArray(raw?.agentCommands) && raw.agentCommands.length > 0) {
      agentCommands = normalizeCommands(raw.agentCommands);
    } else {
      agentCommands = [normalizeSingleCommand(raw?.agentCommand || DEFAULT_AGENT_COMMAND)];
    }
  } catch {
    agentCommands = [DEFAULT_AGENT_COMMAND];
  }

  const commandCount = normalizeCommandCount(raw?.commandCount, agentCommands.length);
  const activeCommands = agentCommands.slice(0, commandCount);
  const forcedVisible = activeCommands
    .join("")
    .split("")
    .filter((k) => /^[A-Z0-9]$/.test(k));

  return {
    ownerUserId: raw?.ownerUserId ? String(raw.ownerUserId) : null,
    agentCommand: activeCommands[0] || DEFAULT_AGENT_COMMAND,
    agentCommands,
    commandCount,
    keyVisibility: normalizeVisibility(raw?.keyVisibility, forcedVisible),
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const userId = String(ctxOrRes.viewer.userId || "").trim();
  let settings = await readSettings();

  if (!settings.ownerUserId && userId) {
    settings = {
      ...settings,
      ownerUserId: userId,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(FILE_NAME, settings);
  }

  return json({ ok: true, data: settings });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const userId = String(ctxOrRes.viewer.userId || "").trim();
  const body = await req.json().catch(() => ({} as any));
  const current = await readSettings();

  const ownerUserId = current.ownerUserId || userId;
  if (current.ownerUserId && current.ownerUserId !== userId) {
    return json(
      {
        ok: false,
        error: "Forbidden",
        details: { hint: "Owner tu anaweza kubadilisha MY WAY global settings." },
      },
      { status: 403 }
    );
  }

  let nextCommands = current.agentCommands;
  if (body?.agentCommands !== undefined) {
    try {
      nextCommands = normalizeCommands(body.agentCommands);
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message || "Invalid commands") }, { status: 400 });
    }
  } else if (body?.agentCommand !== undefined) {
    try {
      nextCommands = [normalizeSingleCommand(body.agentCommand)];
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message || "Invalid command") }, { status: 400 });
    }
  }

  const nextCommandCount =
    body?.commandCount !== undefined
      ? normalizeCommandCount(body.commandCount, nextCommands.length)
      : Math.max(1, Math.min(4, nextCommands.length));

  const activeCommands = nextCommands.slice(0, nextCommandCount);
  const forcedVisible = activeCommands
    .join("")
    .split("")
    .filter((k) => /^[A-Z0-9]$/.test(k));

  const nextKeyVisibility =
    body?.keyVisibility !== undefined
      ? normalizeVisibility(body.keyVisibility, forcedVisible)
      : normalizeVisibility(current.keyVisibility, forcedVisible);

  const next: MyWaySettings = {
    ownerUserId,
    agentCommand: activeCommands[0] || DEFAULT_AGENT_COMMAND,
    agentCommands: nextCommands,
    commandCount: nextCommandCount,
    keyVisibility: nextKeyVisibility,
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(FILE_NAME, next);
  return json({ ok: true, data: next });
}
