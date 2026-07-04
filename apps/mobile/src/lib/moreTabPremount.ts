import type { KristoSession } from "./kristoSession";
import { runAfterHomeDeferredStartup } from "./homeFeedDeferredStartup";
import { seedChurchMediaAccessFromSession } from "./refreshCoordinator";
import { resolveSessionChurchId } from "./churchStore";
import { isPastorSessionRole } from "./churchSubscription";
import { preloadTlmcAssets } from "./tlmcPreload";

export type MoreTabPremountSnapshot = {
  hasChurch: boolean;
  isPastor: boolean;
  churchId: string;
  userId: string;
};

let premountReady = false;
let premountSnapshot: MoreTabPremountSnapshot | null = null;
let premountInflight: Promise<void> | null = null;
let lastPremountKey = "";

export function isMoreTabPremountReady() {
  return premountReady;
}

export function peekMoreTabPremountSnapshot() {
  return premountSnapshot;
}

export async function runMoreTabPremount(session: KristoSession) {
  const key = `${session.userId}:${session.churchId || ""}`;
  if (premountReady && lastPremountKey === key) {
    return;
  }
  if (premountInflight) {
    await premountInflight;
    return;
  }

  console.log("KRISTO_MORE_TAB_PREMOUNT_START", {
    userId: session.userId,
    churchId: session.churchId || null,
  });

  const startedAt = Date.now();
  premountInflight = (async () => {
    const churchId = resolveSessionChurchId(session.churchId || "");
    seedChurchMediaAccessFromSession(
      {
        userId: session.userId,
        role: session.role,
        churchRole: session.churchRole,
      },
      churchId
    );

    premountSnapshot = {
      hasChurch: Boolean(churchId),
      isPastor:
        isPastorSessionRole(session.role) || isPastorSessionRole(session.churchRole),
      churchId,
      userId: String(session.userId || "").trim(),
    };

    try {
      await import("@/app/(tabs)/more/index");
    } catch {}

    void preloadTlmcAssets();

    premountReady = true;
    lastPremountKey = key;

    console.log("KRISTO_MORE_TAB_PREMOUNT_READY", {
      ms: Date.now() - startedAt,
      userId: session.userId,
      hasChurch: premountSnapshot.hasChurch,
    });
  })().finally(() => {
    premountInflight = null;
  });

  await premountInflight;
}

export function startMoreTabPremount(session: KristoSession | null | undefined) {
  const userId = String(session?.userId || "").trim();
  if (!userId || !session) return;

  runAfterHomeDeferredStartup(() => {
    void runMoreTabPremount(session);
  }, { reason: "more-tab-premount" });
}
