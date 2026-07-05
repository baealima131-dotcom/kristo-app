import {
  performLogoutCleanup,
  setLoggedOutFlag,
  setSessionSync,
  type LogoutCleanupParams,
} from "./kristoSession";
import { cancelAllScheduledRefreshes, resetAuthRefreshStateForLogout } from "./refreshCoordinator";
import {
  markDeleteAccountExitFinished,
  markDeleteAccountExitStarted,
  markLogoutExitFinished,
  markLogoutExitStarted,
} from "./kristoSessionExitFlags";

export {
  isDeleteAccountInProgress,
  isLogoutInProgress,
  isSessionExitInProgress,
} from "./kristoSessionExitFlags";

function beginSessionExit(kind: "delete" | "logout") {
  if (kind === "delete") markDeleteAccountExitStarted();
  else markLogoutExitStarted();

  setSessionSync(null);
  cancelAllScheduledRefreshes();
  resetAuthRefreshStateForLogout();
  void setLoggedOutFlag(true);
}

export function beginDeleteAccountExit() {
  beginSessionExit("delete");
}

export function beginLogoutExit() {
  beginSessionExit("logout");
}

export function completeSessionExitCleanup(
  params: LogoutCleanupParams,
  kind: "delete" | "logout"
): void {
  void performLogoutCleanup({ ...params, reason: kind }).finally(() => {
    if (kind === "delete") markDeleteAccountExitFinished();
    else markLogoutExitFinished();
  });
}
