import { useEffect, useRef } from "react";

import {
  extractLightLivePayload,
  fetchLightLiveState,
  logLiveTraffic,
  shallowJsonEqual,
  startAdaptiveLivePolling,
  type LightLivePayload,
} from "@/src/lib/liveRealtime";

export type LiveBackendSyncHandlers = {
  onPatch: (patch: LightLivePayload) => void;
  pushHeartbeat?: (body: Record<string, any>) => Promise<any>;
};

export function useLiveRoomBackendSync(opts: {
  enabled: boolean;
  headers: Record<string, string>;
  handlers: LiveBackendSyncHandlers;
  heartbeatEnabled?: boolean;
  heartbeatBody?: Record<string, any>;
  isInteractive?: () => boolean;
}) {
  const handlersRef = useRef(opts.handlers);
  handlersRef.current = opts.handlers;
  const headersRef = useRef(opts.headers);
  headersRef.current = opts.headers;
  const heartbeatBodyRef = useRef(opts.heartbeatBody || {});
  heartbeatBodyRef.current = opts.heartbeatBody || {};

  const lastPatchRef = useRef<string>("");
  const lastHeartbeatRef = useRef<string>("");

  useEffect(() => {
    if (!opts.enabled) return;

    const applyPatch = (patch: LightLivePayload) => {
      if (patch.routeFailed) {
        logLiveTraffic("live patch preserved route failure");
        return;
      }

      const sig = JSON.stringify({
        removed: patch.removedFromLive || false,
        policy: patch.requestPolicy || "",
        reqKeys: patch.requests ? Object.keys(patch.requests).sort() : [],
        presenceKeys: patch.viewerPresence ? Object.keys(patch.viewerPresence).sort() : [],
        liveId: patch.liveId || "",
        isLive: patch.isLive ?? null,
      });
      if (sig === lastPatchRef.current) {
        logLiveTraffic("live patch skipped unchanged");
        return;
      }
      lastPatchRef.current = sig;
      handlersRef.current.onPatch(patch);
    };

    const stopSync = startAdaptiveLivePolling({
      screen: "LiveRoom",
      enabled: true,
      activeMs: 6000,
      idleMs: 22000,
      isActive: opts.isInteractive,
      onTick: async () => {
        const patch = await fetchLightLiveState(headersRef.current, "LiveRoom");
        applyPatch(patch);
      },
    });

    let heartbeatStop: (() => void) | null = null;
    if (opts.heartbeatEnabled && handlersRef.current.pushHeartbeat) {
      heartbeatStop = startAdaptiveLivePolling({
        screen: "LiveRoomHeartbeat",
        activeMs: 15000,
        idleMs: 30000,
        isActive: opts.isInteractive,
        onTick: async () => {
          const body = heartbeatBodyRef.current;
          const sig = JSON.stringify(body);
          if (sig === lastHeartbeatRef.current) {
            logLiveTraffic("heartbeat skipped unchanged");
            return;
          }
          lastHeartbeatRef.current = sig;
          const res = await handlersRef.current.pushHeartbeat?.(body);
          if (res?.live) {
            applyPatch(extractLightLivePayload({ ok: true, live: res.live }));
          }
        },
      });
    }

    return () => {
      stopSync();
      heartbeatStop?.();
    };
  }, [opts.enabled, opts.heartbeatEnabled, opts.isInteractive]);
}
