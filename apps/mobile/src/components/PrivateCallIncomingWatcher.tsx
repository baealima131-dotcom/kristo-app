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
} from "expo-router";

import {
  useKristoSession,
} from "@/src/lib/KristoSessionProvider";
import {
  isPrivateCallAudioActive,
} from "@/src/lib/activeCallStore";
import {
  fetchIncomingPrivateCalls,
} from "@/src/lib/privateCallService";
import {
  hasLiveCallScreen,
  markIncomingCallScreenOpened,
  wasIncomingCallScreenOpened,
} from "@/src/lib/push/kristoCallRouting";

/*
 * A call rings for 30 s, so with the app open an incoming call must show
 * within a few seconds. Polling stays at this pace while the app is in
 * front; in the background push (FCM / VoIP) delivers calls instead.
 */
const IDLE_POLL_DELAYS_MS = [
  2_000,
  3_000,
] as const;

const RINGING_RECHECK_MS = 700;
const BUSY_RECHECK_MS = 3_000;

export function PrivateCallIncomingWatcher() {
  const router = useRouter();

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
        AppState.currentState !== "active"
      ) {
        return;
      }

      /*
       * Already in a call (ringing or connected): do not open another
       * call over it. A finished call's screen left open does not count,
       * so a new call still shows there.
       */
      if (
        hasLiveCallScreen() ||
        isPrivateCallAudioActive()
      ) {
        resetToFastIdle();

        console.log(
          "KRISTO_PRIVATE_CALL_POLL_SCHEDULE",
          {
            mode: "busy_in_call",
            delayMs:
              BUSY_RECHECK_MS,
          }
        );

        schedule(
          BUSY_RECHECK_MS
        );

        return;
      }

      console.log(
        "KRISTO_PRIVATE_CALL_INCOMING_POLL",
        {
          receiverUserId: userId,
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
              .has(call.id) ||
            wasIncomingCallScreenOpened(call.id)
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
      markIncomingCallScreenOpened(
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
  ]);

  return null;
}
