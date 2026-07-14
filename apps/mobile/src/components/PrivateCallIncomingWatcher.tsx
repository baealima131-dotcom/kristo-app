import React, {
  useEffect,
  useRef,
} from "react";
import {
  AppState,
  type AppStateStatus,
} from "react-native";
import {
  useRouter,
  useSegments,
} from "expo-router";

import {
  useKristoSession,
} from "@/src/lib/KristoSessionProvider";
import {
  fetchIncomingPrivateCalls,
} from "@/src/lib/privateCallService";

const IDLE_POLL_DELAYS_MS = [
  2_000,
  4_000,
  8_000,
  15_000,
] as const;

const RINGING_RECHECK_MS = 700;
const ACTIVE_CALL_RECHECK_MS = 15_000;

function activePrivateCallIdFromSegments(
  segments: string[]
): string | null {
  const index =
    segments.findIndex(
      (segment) =>
        segment === "private-call"
    );

  if (index < 0) {
    return null;
  }

  const next =
    String(
      segments[index + 1] || ""
    ).trim();

  return next || null;
}

export function PrivateCallIncomingWatcher() {
  const router = useRouter();
  const segments =
    useSegments() as string[];

  const {
    session,
    loading,
  } = useKristoSession();

  const userId =
    String(
      session?.userId || ""
    ).trim();

  const appStateRef =
    useRef<AppStateStatus>(
      AppState.currentState
    );

  const handledCallIdsRef =
    useRef<Set<string>>(
      new Set()
    );

  const navigatingRef =
    useRef(false);

  useEffect(() => {
    if (loading || !userId) {
      return;
    }

    let alive = true;

    let timer:
      ReturnType<typeof setTimeout> |
      null = null;

    let idleDelayIndex = 0;

    const clearTimer = () => {
      if (!timer) {
        return;
      }

      clearTimeout(timer);
      timer = null;
    };

    const schedule = (
      delayMs: number
    ) => {
      if (!alive) {
        return;
      }

      clearTimer();

      timer = setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const resetToFastIdle = () => {
      idleDelayIndex = 0;
    };

    const nextIdleDelay = () => {
      const delay =
        IDLE_POLL_DELAYS_MS[
          Math.min(
            idleDelayIndex,
            IDLE_POLL_DELAYS_MS.length - 1
          )
        ];

      idleDelayIndex =
        Math.min(
          idleDelayIndex + 1,
          IDLE_POLL_DELAYS_MS.length - 1
        );

      return delay;
    };

    const poll = async () => {
      if (!alive) {
        return;
      }

      if (
        appStateRef.current !== "active"
      ) {
        return;
      }

      const activeCallId =
        activePrivateCallIdFromSegments(
          segments
        );

      if (activeCallId) {
        handledCallIdsRef.current.add(
          activeCallId
        );

        resetToFastIdle();

        console.log(
          "KRISTO_PRIVATE_CALL_POLL_SCHEDULE",
          {
            mode: "active_call_screen",
            delayMs:
              ACTIVE_CALL_RECHECK_MS,
            activeCallId,
          }
        );

        schedule(
          ACTIVE_CALL_RECHECK_MS
        );

        return;
      }

      console.log(
        "KRISTO_PRIVATE_CALL_INCOMING_POLL",
        {
          receiverUserId: userId,
          activeCallId,
        }
      );

      const incoming =
        await fetchIncomingPrivateCalls()
          .catch(() => []);

      if (!alive) {
        return;
      }

      const ringing =
        incoming.filter(
          (call) =>
            call.status === "ringing"
        );

      if (ringing.length === 0) {
        const delayMs =
          nextIdleDelay();

        console.log(
          "KRISTO_PRIVATE_CALL_POLL_SCHEDULE",
          {
            mode: "idle",
            delayMs,
            receiverUserId: userId,
          }
        );

        schedule(delayMs);
        return;
      }

      resetToFastIdle();

      console.log(
        "KRISTO_PRIVATE_CALL_INCOMING_FOUND",
        {
          receiverUserId: userId,
          count: ringing.length,
          calls: ringing.map(
            (call) => ({
              callId: call.id,
              callerUserId:
                call.callerUserId,
              receiverUserId:
                call.pastorUserId,
              churchId:
                call.churchId,
              status:
                call.status,
            })
          ),
        }
      );

      const nextCall =
        ringing.find((call) => {
          if (
            call.callerUserId ===
            userId
          ) {
            return false;
          }

          if (
            call.pastorUserId !==
            userId
          ) {
            return false;
          }

          if (
            handledCallIdsRef.current
              .has(call.id)
          ) {
            return false;
          }

          return true;
        });

      if (
        !nextCall ||
        navigatingRef.current
      ) {
        schedule(
          RINGING_RECHECK_MS
        );
        return;
      }

      handledCallIdsRef.current.add(
        nextCall.id
      );

      navigatingRef.current = true;

      console.log(
        "KRISTO_PRIVATE_CALL_RECEIVER_SCREEN_OPENED",
        {
          callId: nextCall.id,
          callerUserId:
            nextCall.callerUserId,
          receiverUserId:
            nextCall.pastorUserId,
          churchId:
            nextCall.churchId,
          status:
            nextCall.status,
          source:
            "incoming-poll",
        }
      );

      router.push({
        pathname:
          "/more/private-call/[callId]",
        params: {
          callId: nextCall.id,
        },
      } as any);

      navigatingRef.current = false;

      schedule(
        RINGING_RECHECK_MS
      );
    };

    const appStateSubscription =
      AppState.addEventListener(
        "change",
        (nextState) => {
          const previousState =
            appStateRef.current;

          appStateRef.current =
            nextState;

          if (
            nextState === "active" &&
            previousState !== "active"
          ) {
            /*
             * Never wait for a 15-second
             * backoff after the app returns
             * to foreground.
             */
            resetToFastIdle();
            clearTimer();
            void poll();
          }

          if (
            nextState !== "active"
          ) {
            clearTimer();
          }
        }
      );

    void poll();

    return () => {
      alive = false;
      clearTimer();
      appStateSubscription.remove();
    };
  }, [
    loading,
    userId,
    router,
    segments,
  ]);

  return null;
}
