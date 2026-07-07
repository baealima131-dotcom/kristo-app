import { resolveMinistryLiveViewerOnlyFromRouteParams } from "@/src/lib/ministryLiveActivation";

export type LivePreflightMode = "viewer" | "audio-publisher" | "video-publisher";

export type LivePreflightModeResolved = {
  mode: LivePreflightMode;
  needsMic: boolean;
  needsCamera: boolean;
  role: string;
  claimedByMe: boolean;
  roleMutated: false;
};

function routeParamTrue(params: Record<string, unknown>, key: string): boolean {
  return String(params[key] || "") === "1";
}

function routeClaimedByMe(
  params: Record<string, unknown>,
  userId?: string
): boolean {
  const claimed = String(params.claimedByUserId || "").trim();
  const uid = String(userId || params.currentUserId || "").trim();
  return !!claimed && !!uid && claimed === uid;
}

/** Mic publish intent from route — stable at mount. */
export function resolveLivePreflightNeedsMicFromRoute(
  params: Record<string, unknown>
): boolean {
  if (routeParamTrue(params, "canPublishMic")) return true;
  if (resolveMinistryLiveViewerOnlyFromRouteParams(params)) return false;
  if (routeParamTrue(params, "canPublish") && !routeParamTrue(params, "enteredAsViewer")) {
    return true;
  }
  return false;
}

/** Camera / video publish intent from route — stable at mount. */
export function resolveLivePreflightNeedsCameraFromRoute(
  params: Record<string, unknown>
): boolean {
  if (routeParamTrue(params, "canPublishCamera")) return true;
  if (resolveMinistryLiveViewerOnlyFromRouteParams(params)) return false;
  if (routeParamTrue(params, "mediaSlotPublisher")) return true;
  if (
    routeParamTrue(params, "canPublish") &&
    !routeParamTrue(params, "enteredAsViewer") &&
    String(params.canPublishCamera || "") !== "0" &&
    !routeParamTrue(params, "canPublishMic")
  ) {
    return true;
  }
  if (
    routeParamTrue(params, "canPublish") &&
    !routeParamTrue(params, "enteredAsViewer") &&
    routeParamTrue(params, "canPublishMic") &&
    routeParamTrue(params, "canPublishCamera")
  ) {
    return true;
  }
  return false;
}

export function resolveLivePreflightModeFromRoute(
  params: Record<string, unknown>,
  userId?: string
): LivePreflightModeResolved {
  const role = String(params.role || "").trim();
  const claimedByMe = routeClaimedByMe(params, userId);

  if (resolveMinistryLiveViewerOnlyFromRouteParams(params)) {
    return {
      mode: "viewer",
      needsMic: false,
      needsCamera: false,
      role,
      claimedByMe,
      roleMutated: false,
    };
  }

  const needsCamera = resolveLivePreflightNeedsCameraFromRoute(params);
  const needsMic = resolveLivePreflightNeedsMicFromRoute(params);

  if (needsCamera) {
    return {
      mode: "video-publisher",
      needsMic: true,
      needsCamera: true,
      role,
      claimedByMe,
      roleMutated: false,
    };
  }

  if (needsMic) {
    return {
      mode: "audio-publisher",
      needsMic: true,
      needsCamera: false,
      role,
      claimedByMe,
      roleMutated: false,
    };
  }

  return {
    mode: "viewer",
    needsMic: false,
    needsCamera: false,
    role,
    claimedByMe,
    roleMutated: false,
  };
}

/** @deprecated Use resolveLivePreflightModeFromRoute().mode !== "viewer" */
export function resolveLivePreflightRoutePublisher(
  params: Record<string, unknown>
): boolean {
  return resolveLivePreflightModeFromRoute(params).mode !== "viewer";
}

export function resolveLivePreflightRouteNeedsMic(
  params: Record<string, unknown>
): boolean {
  return resolveLivePreflightNeedsMicFromRoute(params);
}

export function resolveLivePreflightRouteNeedsCamera(
  params: Record<string, unknown>
): boolean {
  return resolveLivePreflightNeedsCameraFromRoute(params);
}
