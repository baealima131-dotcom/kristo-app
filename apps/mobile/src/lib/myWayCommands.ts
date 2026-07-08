import {
  MY_WAY_COMMAND_LENGTH,
  normalizeMyWayCommandCode,
  resolveMyWayCommandCode,
  listMyWayCommands,
  type MyWayCommandResolution,
} from "./myWayCommandRegistry";
import { buildKingdomHeaders, kingdomApiBase } from "./kingdomSettings";

export {
  MY_WAY_COMMAND_LENGTH,
  normalizeMyWayCommandCode,
  resolveMyWayCommandCode,
  listMyWayCommands,
  type MyWayCommandResolution,
};

export async function resolveMyWayCommand(code: string): Promise<MyWayCommandResolution | null> {
  const normalized = normalizeMyWayCommandCode(code);
  if (normalized.length !== MY_WAY_COMMAND_LENGTH) return null;

  const base = kingdomApiBase();
  if (base) {
    try {
      const r = await fetch(`${base}/api/my-way/resolve`, {
        method: "POST",
        headers: buildKingdomHeaders(),
        body: JSON.stringify({ code: normalized }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && j?.data?.route) {
        return {
          code: normalized,
          title: String(j.data.title || ""),
          description: j.data.description ? String(j.data.description) : undefined,
          action: "navigate",
          route: String(j.data.route),
          source: "api",
        };
      }
    } catch {
      // Fall through to local registry when API is unreachable.
    }
  }

  const local = resolveMyWayCommandCode(normalized);
  if (!local) return null;
  return { ...local, source: "local" };
}
