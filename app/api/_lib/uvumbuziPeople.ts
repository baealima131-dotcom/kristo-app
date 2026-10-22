import { getUserById } from "@/app/api/auth/_lib/session";
import { dbFindUserByKristoId, ensureAuthStoreReady, hasDurableStore } from "@/app/api/_lib/store/authDb";
import { localFindUserByKristoId } from "@/app/api/_lib/store/localAuthStore";
import type { LabPeopleDirectory } from "@/app/api/_lib/uvumbuziLabProxy";

/**
 * Kristo account directory for UVUMBUZI Lab: maps public Kristo IDs to internal
 * user ids and back. Returns nothing else (no names, emails or phones).
 */
export const uvumbuziPeople: LabPeopleDirectory = {
  async resolveKristoId(kristoId) {
    const wanted = String(kristoId || "").trim().toUpperCase();
    if (!wanted) return null;
    await ensureAuthStoreReady();
    const user = hasDurableStore() ? await dbFindUserByKristoId(wanted) : await localFindUserByKristoId(wanted);
    // Exact match on the account's own public Kristo ID only (never an internal id or another code).
    return user?.id && String(user.kristoId || "").trim().toUpperCase() === wanted ? user.id : null;
  },

  async publicIds(userIds) {
    const out: Record<string, string> = {};
    await Promise.all(
      userIds.map(async (id) => {
        const user = await getUserById(id).catch(() => null);
        const kristoId = String(user?.kristoId || "").trim();
        if (kristoId) out[id] = kristoId;
      })
    );
    return out;
  },
};
