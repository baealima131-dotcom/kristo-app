let deleteInProgress = false;
let logoutInProgress = false;

export function isDeleteAccountInProgress(): boolean {
  return deleteInProgress;
}

export function isLogoutInProgress(): boolean {
  return logoutInProgress;
}

export function isSessionExitInProgress(): boolean {
  return deleteInProgress || logoutInProgress;
}

export function markDeleteAccountExitStarted() {
  deleteInProgress = true;
}

export function markLogoutExitStarted() {
  logoutInProgress = true;
}

export function markDeleteAccountExitFinished() {
  deleteInProgress = false;
}

export function markLogoutExitFinished() {
  logoutInProgress = false;
}
