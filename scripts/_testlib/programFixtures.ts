/**
 * Test-account fixtures for the offline-activation program, written through the
 * app's own store functions (Postgres when DATABASE_URL is set, else local JSON).
 * Emails use the reserved .test domain; nothing is ever sent to them.
 */
import bcrypt from "bcryptjs";

import { upsertProfilePersist } from "../../app/api/auth/_lib/profile.ts";
import { upsertChurchProfile } from "../../app/api/_lib/churches.ts";
import { addActiveMember, getActiveMembership } from "../../app/api/_lib/memberships.ts";
import { upsertPlatformRole } from "../../app/api/_lib/platformRoles.ts";
import { dbCreateUser, dbGetUserById, hasDurableStore } from "../../app/api/_lib/store/authDb.ts";
import { localCreateUser, localGetUserById } from "../../app/api/_lib/store/localAuthStore.ts";

export type FixtureUser = {
  id: string;
  kristoId: string;
  name: string;
  email: string;
  password?: string;
  church?: { id: string; role: "Member" | "Pastor" | "Church_Admin" };
  platformRole?: "System_Admin" | "Supervisor" | "Agent";
};

export async function seedChurches(churches: { id: string; name: string }[]) {
  for (const church of churches) await upsertChurchProfile({ id: church.id, name: church.name });
}

export async function seedUsers(users: FixtureUser[]) {
  for (const u of users) {
    const existing = hasDurableStore() ? await dbGetUserById(u.id) : await localGetUserById(u.id);
    if (!existing) {
      const record = {
        id: u.id,
        kristoId: u.kristoId,
        email: u.email,
        password: bcrypt.hashSync(u.password || crypto.randomUUID(), 10),
        lastSeenAt: Date.now(),
      };
      if (hasDurableStore()) await dbCreateUser(record);
      else await localCreateUser(record);
    }
    await upsertProfilePersist({ userId: u.id, userCode: u.kristoId, fullName: u.name } as any);
    if (u.church && !(await getActiveMembership(u.id))) {
      const added = await addActiveMember(u.church.id, u.id, u.name, u.church.role);
      if (!added.ok) throw new Error(`fixture membership failed for ${u.id}: ${added.error}`);
    }
    if (u.platformRole) await upsertPlatformRole(u.id, u.platformRole, "test fixture");
  }
}
