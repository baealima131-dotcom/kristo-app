import {
  MY_WAY_COMMAND_LENGTH,
  MY_WAY_COMMAND_MAX_LENGTH,
  normalizeMyWayCommandCode,
  resolveMyWayCommandCode,
  listMyWayCommands,
  type MyWayCommandResolution,
} from "./myWayCommandRegistry";
import { buildKingdomHeaders, kingdomApiBase } from "./kingdomSettings";

export {
  MY_WAY_COMMAND_LENGTH,
  MY_WAY_COMMAND_MAX_LENGTH,
  normalizeMyWayCommandCode,
  resolveMyWayCommandCode,
  listMyWayCommands,
  type MyWayCommandResolution,
};

export async function resolveMyWayCommand(code: string): Promise<MyWayCommandResolution | null> {
  const normalized = normalizeMyWayCommandCode(code);
  if (!normalized) return null;

  const base = kingdomApiBase();
  if (base) {
    try {
      const r = await fetch(`${base}/api/my-way/resolve`, {
        method: "POST",
        headers: buildKingdomHeaders(),
        body: JSON.stringify({ code: normalized }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && j?.data) {
        const data = j.data;
        if (data.action === "pastor_call") {
          return {
            code: normalized,
            title: String(data.title || "Call Pastor"),
            description: data.description ? String(data.description) : undefined,
            action: "pastor_call",
            source: "api",
          };
        }
        if (data.route) {
          return {
            code: normalized,
            title: String(data.title || ""),
            description: data.description ? String(data.description) : undefined,
            action: "navigate",
            route: String(data.route),
            source: "api",
          };
        }
      }
    } catch {
      // Fall through to local registry when API is unreachable.
    }
  }

  const local = resolveMyWayCommandCode(normalized);
  if (!local) return null;
  return { ...local, source: "local" };
}