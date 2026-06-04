import { Alert } from "react-native";
import { fetchMyActiveChurchMembership } from "./churchMembersApi";
import type { KristoSession } from "./kristoSession";

export const CHURCH_SETUP_NEEDED_TITLE = "Church setup needed";
export const CHURCH_SETUP_NEEDED_MESSAGE =
  "Your account is not connected to a church yet. Please choose or join a church.";
export const CHURCH_SETUP_ROUTE = "/more/church";

export type ChurchLockedRecoveryResult = {
  churchId: string;
  role: string;
  recovered: boolean;
};

export async function recoverChurchIdFromMembership(
  session: KristoSession | null | undefined,
  setSession?: (s: KristoSession) => Promise<void>
): Promise<ChurchLockedRecoveryResult> {
  const userId = String(session?.userId || "").trim();
  const existing = String(session?.churchId || "").trim();

  if (existing) {
    return {
      churchId: existing,
      role: String(session?.role || session?.churchRole || "Member"),
      recovered: false,
    };
  }

  if (!userId) {
    return { churchId: "", role: "Member", recovered: false };
  }

  console.log("KRISTO_CHURCH_LOCKED_RECOVERY_START", { userId });

  try {
    const mine = await fetchMyActiveChurchMembership();
    const churchId = String(mine?.churchId || "").trim();

    if (!churchId) {
      console.log("KRISTO_CHURCH_LOCKED_RECOVERY_FALLBACK", {
        userId,
        reason: "no_active_membership",
      });
      return { churchId: "", role: "Member", recovered: false };
    }

    const role = String(mine.role || "Member");

    if (session && setSession) {
      await setSession({
        ...session,
        churchId,
        activeChurchId: churchId,
        role: role as KristoSession["role"],
        churchRole: role as KristoSession["churchRole"],
      } as KristoSession);
    }

    console.log("KRISTO_CHURCH_LOCKED_RECOVERY_SUCCESS", { userId, churchId, role });
    return { churchId, role, recovered: true };
  } catch (error: any) {
    console.log("KRISTO_CHURCH_LOCKED_RECOVERY_FALLBACK", {
      userId,
      reason: "fetch_failed",
      error: String(error?.message || error || "unknown"),
    });
    return { churchId: "", role: "Member", recovered: false };
  }
}

export type EnsureChurchAccessOptions = {
  session: KristoSession | null | undefined;
  setSession?: (s: KristoSession) => Promise<void>;
  /** When true (default), show English setup alert if recovery fails. Never uses legacy Swahili copy. */
  showSetupAlert?: boolean;
  onNavigateToSetup: () => void;
  onChurchReady: (churchId: string) => void;
};

/**
 * Retry membership recovery, then route to church setup (no legacy "Church locked" alert).
 */
export async function ensureChurchAccessOrSetup(
  opts: EnsureChurchAccessOptions
): Promise<boolean> {
  const existing = String(opts.session?.churchId || "").trim();
  if (existing) {
    opts.onChurchReady(existing);
    return true;
  }

  const recovered = await recoverChurchIdFromMembership(opts.session, opts.setSession);
  if (recovered.churchId) {
    opts.onChurchReady(recovered.churchId);
    return true;
  }

  const showAlert = opts.showSetupAlert !== false;
  if (showAlert) {
    Alert.alert(CHURCH_SETUP_NEEDED_TITLE, CHURCH_SETUP_NEEDED_MESSAGE, [
      { text: "Choose or join", onPress: opts.onNavigateToSetup },
    ]);
  } else {
    opts.onNavigateToSetup();
  }

  return false;
}
