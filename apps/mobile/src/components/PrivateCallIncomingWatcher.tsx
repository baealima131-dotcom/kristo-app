import React, { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useRouter, useSegments } from "expo-router";

import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { fetchIncomingPrivateCalls } from "@/src/lib/privateCallService";

const POLL_MS = 2500;

function activePrivateCallIdFromSegments(segments: string[]): string | null {
  const idx = segments.findIndex((s) => s === "private-call");
  if (idx < 0) return null;
  const next = String(segments[idx + 1] || "").trim();
  return next || null;
}

export function PrivateCallIncomingWatcher() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const { session, loading } = useKristoSession();
  const userId = String(session?.userId || "").trim();

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const handledCallIdsRef = useRef<Set<string>>(new Set());
  const navigatingRef = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (loading || !userId) return;

    let alive = true;

    const poll = async () => {
      if (!alive) return;
      if (appStateRef.current !== "active") return;

      const activeCallId = activePrivateCallIdFromSegments(segments);
      if (activeCallId) {
        handledCallIdsRef.current.add(activeCallId);
        return;
      }

      console.log("KRISTO_PRIVATE_CALL_INCOMING_POLL", {
        receiverUserId: userId,
        activeCallId,
      });

      const incoming = await fetchIncomingPrivateCalls().catch(() => []);
      if (!alive || incoming.length === 0) return;

      const ringing = incoming.filter((call) => call.status === "ringing");
      if (ringing.length === 0) return;

      console.log("KRISTO_PRIVATE_CALL_INCOMING_FOUND", {
        receiverUserId: userId,
        count: ringing.length,
        calls: ringing.map((call) => ({
          callId: call.id,
          callerUserId: call.callerUserId,
          receiverUserId: call.pastorUserId,
          churchId: call.churchId,
          status: call.status,
        })),
      });

      const nextCall = ringing.find((call) => {
        if (call.callerUserId === userId) return false;
        if (call.pastorUserId !== userId) return false;
        if (handledCallIdsRef.current.has(call.id)) return false;
        if (activeCallId === call.id) return false;
        return true;
      });

      if (!nextCall || navigatingRef.current) return;

      handledCallIdsRef.current.add(nextCall.id);
      navigatingRef.current = true;

      console.log("KRISTO_PRIVATE_CALL_RECEIVER_SCREEN_OPENED", {
        callId: nextCall.id,
        callerUserId: nextCall.callerUserId,
        receiverUserId: nextCall.pastorUserId,
        churchId: nextCall.churchId,
        status: nextCall.status,
        source: "incoming-poll",
      });

      router.push({
        pathname: "/more/private-call/[callId]",
        params: {
          callId: nextCall.id,
        },
      } as any);
      navigatingRef.current = false;
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loading, userId, segments, router]);

  return null;
}
