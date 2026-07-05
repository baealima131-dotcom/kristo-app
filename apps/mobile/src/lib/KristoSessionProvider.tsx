import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { KristoSession } from "./kristoSession";
import {
  MOBILE_SESSION_IDLE_MS,
  getSessionSync,
  isLoggedOutFlagSet,
  loadSession,
  saveSession,
  setSessionSync,
  touchMobileSession,
} from "./kristoSession";
import { fetchMyActiveChurchMembership } from "./churchMembersApi";
import { apiGet } from "./kristoApi";
import { getKristoHeaders } from "./kristoHeaders";
import { resolveChurchDisplayName } from "./churchStore";
import { resolveActiveChurchFromProfileResponse, isActiveMembershipStatus } from "./churchMembershipSync";
import { resolvePlatformRoleFromAuthPayload } from "./platformRole";
import { clearResponseCacheForRequest } from "./kristoTraffic";
import {
  hydrateSessionOnce,
  resetChurchMediaAccessCacheOnSwitch,
  runCoordinatedAppRefresh,
  scheduleCoordinatedAppRefresh,
  seedChurchMediaAccessFromSession,
} from "./refreshCoordinator";
import { runAfterHomeDeferredStartup } from "./homeFeedDeferredStartup";
import {
  inviteEventTargetsCurrentUser,
  onChurchInviteAccepted,
  onChurchInviteSent,
  onChurchMembershipChanged,
} from "./kristoChurchInviteEvents";
import { startMediaUploadResumeSystem } from "./optimisticVideoUpload";
import { startHomeFeedStartupPrewarm } from "./homeFeedStartupPrewarm";
import { startFirstHomeFeedVideoPrepare } from "./homeFeedVideoStartup";
import { startMoreTabPremount } from "./moreTabPremount";
import { isHomeFeedInlineVideoAutoplayEnabled } from "./homeFeedVideoMode";
import {
  beginDeleteAccountExit,
  beginLogoutExit,
  completeSessionExitCleanup,
  isSessionExitInProgress,
} from "./kristoSessionExit";
import {
  logOutRevenueCat,
  realignRevenueCatIdentityForChurch,
} from "./payments/mobileSubscriptions";
import { clearChurchMediaProfileCache } from "./churchMediaProfileStore";

type ExitSessionReason = "delete" | "logout";

type Ctx = {
  session: KristoSession | null;
  loading: boolean;
  setSession: (s: KristoSession) => Promise<void>;
  logout: () => Promise<void>;
  exitSessionFast: (params: { reason: ExitSessionReason; userId?: string; churchId?: string }) => void;
};

const C = createContext<Ctx | null>(null);

export function KristoSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<KristoSession | null>(null);
  const [loading, setLoading] = useState(true);
  const prevChurchIdRef = useRef("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSession();
      if (!alive) return;

      setSessionSync(s);
      setSessionState(s);
      setLoading(false);

      if (isHomeFeedInlineVideoAutoplayEnabled()) {
        startFirstHomeFeedVideoPrepare(s);
        startHomeFeedStartupPrewarm(s);
      }

      runAfterHomeDeferredStartup(async () => {
        if (!alive || isSessionExitInProgress() || (await isLoggedOutFlagSet())) {
          if (alive) {
            setSessionSync(null);
            setSessionState(null);
          }
          return;
        }

        const ready =
          ((await hydrateSessionOnce(s, (base) =>
            silentSyncProfile(base, { returnOnly: true })
          )) as KristoSession | null) || s || null;
        if (!alive || !ready?.userId || isSessionExitInProgress() || (await isLoggedOutFlagSet())) return;
        seedChurchMediaAccessFromSession(
          {
            userId: ready.userId,
            role: ready.role,
            churchRole: ready.churchRole,
          },
          String(ready.churchId || "").trim()
        );
        setSessionSync(ready);
        setSessionState(ready);
        if (isHomeFeedInlineVideoAutoplayEnabled()) {
          startFirstHomeFeedVideoPrepare(ready);
          startHomeFeedStartupPrewarm(ready);
        }
        startMoreTabPremount(ready);
        await runCoordinatedAppRefresh(ready, { deferMs: 0 });
        void realignRevenueCatIdentityForChurch({
          churchId: String(ready.churchId || "").trim(),
          userId: ready.userId,
          reason: "session-hydrate",
        });
      }, { reason: "session-profile-hydrate" });
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function silentSyncProfile(
    baseSession: KristoSession | null,
    opts?: { returnOnly?: boolean; forceFresh?: boolean; throttleMs?: number; omitChurchHeader?: boolean }
  ) {
    if (!baseSession?.userId) return baseSession;
    if (isSessionExitInProgress()) return null;
    if (await isLoggedOutFlagSet()) return null;

    try {
      const headerChurchId = String(baseSession.churchId || "").trim();
      const forceFresh = Boolean(opts?.forceFresh);
      const omitChurchHeader = Boolean(opts?.omitChurchHeader);
      const throttleMs =
        typeof opts?.throttleMs === "number"
          ? opts.throttleMs
          : forceFresh
            ? 0
            : headerChurchId
              ? 120000
              : 0;

      if (forceFresh || !headerChurchId) {
        clearResponseCacheForRequest("GET", "/api/auth/profile", baseSession.userId);
      }

      const res: any = await apiGet(
        "/api/auth/profile",
        {
          headers: getKristoHeaders({
            userId: baseSession.userId,
            role: omitChurchHeader ? "Member" : baseSession.role,
            churchId: omitChurchHeader ? "" : headerChurchId,
            sessionToken: baseSession.sessionToken,
          }),
        },
        { screen: "SessionProvider", throttleMs }
      );

      if (!res?.ok || !res?.profile) return baseSession;

      const p = res.profile;
      const membershipStatus = String(res?.activeMembership?.status || "").trim();
      const resolved = resolveActiveChurchFromProfileResponse(res);
      let syncedChurchId = resolved.churchId;
      let syncedRole = resolved.churchId ? resolved.role : "Member";

      if (membershipStatus && !isActiveMembershipStatus(membershipStatus)) {
        syncedChurchId = "";
        syncedRole = "Member";
      }

      console.log("KRISTO_MEMBERSHIP_RESOLVED", {
        userId: baseSession.userId,
        headerChurchId,
        syncedChurchId,
        membershipStatus: membershipStatus || "none",
        churchRole: syncedRole,
        source: forceFresh ? "mobile-profile-sync-force" : "mobile-profile-sync",
      });

      const churchName = syncedChurchId
        ? String(res?.churchName || "").trim() || (await resolveChurchDisplayName(syncedChurchId, baseSession.userId))
        : "";
      const currentRole = String(baseSession.role || baseSession.churchRole || "Member");
      const safeSyncedRole =
        syncedChurchId &&
        syncedChurchId === String(baseSession.churchId || "").trim() &&
        currentRole === "Pastor" &&
        syncedRole === "Member"
          ? "Pastor"
          : syncedRole;

      const platformRole = resolvePlatformRoleFromAuthPayload(res);
      console.log("KRISTO_SESSION_CHURCH_ROLE", {
        userId: baseSession.userId,
        churchRole: safeSyncedRole,
        churchId: syncedChurchId,
      });
      console.log("KRISTO_SESSION_PLATFORM_ROLE", {
        userId: baseSession.userId,
        platformRole,
      });

      if (safeSyncedRole !== syncedRole) {
        console.log("KRISTO_SESSION_ROLE_DOWNGRADE_BLOCKED", {
          userId: baseSession.userId,
          churchId: syncedChurchId,
          from: currentRole,
          attempted: syncedRole,
          kept: safeSyncedRole,
          source: "SessionProvider.silentSyncProfile",
        });
      }

      const next: KristoSession = {
        ...baseSession,
        churchId: syncedChurchId,
        activeChurchId: syncedChurchId,
        churchName: churchName || (syncedChurchId ? (baseSession as any).churchName || "" : ""),
        role: safeSyncedRole as any,
        churchRole: safeSyncedRole as any,
        platformRole,
        offlineActivationRole: platformRole,
        name: String(p.fullName || baseSession.name || ""),
        displayName: String(p.fullName || baseSession.displayName || baseSession.name || ""),
        phone: String(p.phone || baseSession.phone || ""),
        city: String(p.city || baseSession.city || ""),
        country: String(p.country || baseSession.country || ""),
        avatarUrl: String(p.avatarUrl || (baseSession as any).avatarUrl || ""),
        avatarUri: String(p.avatarUrl || (baseSession as any).avatarUri || ""),
      } as any;

      await saveSession(next);
      if (!opts?.returnOnly) {
        setSessionSync(next);
        setSessionState(next);
      }
      return next;
    } catch {}
  }

  useEffect(() => {
    if (loading) return;
    const churchId = String(session?.churchId || "").trim();
    if (!session?.userId || !churchId) return;

    void startMediaUploadResumeSystem("app-startup");
  }, [loading, session?.userId, session?.churchId]);

  useEffect(() => {
    const userId = String(session?.userId || "").trim();
    const churchId = String(session?.churchId || "").trim();
    const prev = prevChurchIdRef.current;

    if (userId && churchId && prev && prev !== churchId) {
      resetChurchMediaAccessCacheOnSwitch({
        userId,
        previousChurchId: prev,
        nextChurchId: churchId,
      });
      clearResponseCacheForRequest("GET", "/api/church/media", userId);
      clearResponseCacheForRequest("GET", "/api/church/media-hosts", userId);
      clearResponseCacheForRequest("GET", "/api/church/overview", userId);
      clearResponseCacheForRequest("GET", "/api/church/ministries", userId);
      clearResponseCacheForRequest("GET", "/api/church/feed", userId);
      void clearChurchMediaProfileCache(prev);
      void (async () => {
        await logOutRevenueCat();
        await realignRevenueCatIdentityForChurch({
          churchId,
          userId,
          reason: "church-switch",
        });
      })();
      void (async () => {
        const loaded = await loadSession();
        if (!loaded?.userId || loaded.userId !== userId) return;
        if (String(loaded.churchId || "").trim() !== churchId) return;
        if (loaded.mediaProfile) {
          const cleared = { ...loaded, mediaProfile: null };
          await saveSession(cleared);
          setSessionSync(cleared);
          setSessionState(cleared);
        }
      })();
    }

    if (churchId) prevChurchIdRef.current = churchId;
  }, [session?.userId, session?.churchId]);

  useEffect(() => {
    if (!session?.userId) return;

    const checkExpiry = async () => {
      if (await isLoggedOutFlagSet()) {
        setSessionSync(null);
        setSessionState(null);
        return;
      }

      const loaded = await loadSession();
      if (!loaded) {
        setSessionSync(null);
        setSessionState(null);
        return;
      }

      if (!String(loaded.churchId || "").trim()) {
        try {
          const mine = await fetchMyActiveChurchMembership();
          if (mine?.churchId) {
            const syncedChurchId = String(mine.churchId);
            const syncedRole = String(mine.role || "Member");
            const platformRole = mine.platformRole || null;
            const churchName = await resolveChurchDisplayName(syncedChurchId, loaded.userId);
            const next = {
              ...loaded,
              churchId: syncedChurchId,
              activeChurchId: syncedChurchId,
              churchName: churchName || (loaded as any).churchName || "",
              role: syncedRole as any,
              churchRole: syncedRole as any,
              platformRole,
              offlineActivationRole: platformRole,
            };
            await saveSession(next);
            setSessionSync(next);
            setSessionState(next);
          }
        } catch {}
      }
    };

    if (isSessionExitInProgress()) return;

    silentSyncProfile(session).then((synced) => {
      if (isSessionExitInProgress()) return;
      const next = synced || session;
      seedChurchMediaAccessFromSession(
        {
          userId: next.userId,
          role: next.role,
          churchRole: next.churchRole,
        },
        String(next.churchId || "").trim()
      );
    });
    const t = setInterval(async () => {
      if (isSessionExitInProgress()) return;
      await checkExpiry();
      const latest = await loadSession();
      const synced = await silentSyncProfile(latest || session);
      if (synced && !String(synced.churchId || "").trim()) {
        return;
      }
    }, 120000);

    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "active") {
        if (isSessionExitInProgress() || (await isLoggedOutFlagSet())) {
          setSessionSync(null);
          setSessionState(null);
          return;
        }

        const loaded = await loadSession();
        if (!loaded) {
          setSessionSync(null);
          setSessionState(null);
          return;
        }

        const touched = await touchMobileSession();
        if (touched) {
          if (!String(touched.churchId || "").trim()) {
            try {
              const mine = await fetchMyActiveChurchMembership();
              if (mine?.churchId) {
                const syncedChurchId = String(mine.churchId);
                const syncedRole = String(mine.role || "Member");
                const platformRole = mine.platformRole || null;
                const churchName = await resolveChurchDisplayName(syncedChurchId, touched.userId);
                const next = {
                  ...touched,
                  churchId: syncedChurchId,
                  activeChurchId: syncedChurchId,
                  churchName: churchName || (touched as any).churchName || "",
                  role: syncedRole as any,
                  churchRole: syncedRole as any,
                  platformRole,
                  offlineActivationRole: platformRole,
                };
                await saveSession(next);
                setSessionSync(next);
                setSessionState(next);
                return;
              }
            } catch {}
          }
          setSessionState(touched);
          clearResponseCacheForRequest("GET", "/api/auth/profile", touched.userId);
          const synced = await silentSyncProfile(touched, { throttleMs: 0, omitChurchHeader: true });
          seedChurchMediaAccessFromSession(
            {
              userId: (synced || touched).userId,
              role: (synced || touched).role,
              churchRole: (synced || touched).churchRole,
            },
            String((synced || touched).churchId || "").trim()
          );
          scheduleCoordinatedAppRefresh(synced || touched, { force: true, delayMs: 2500 });
        }
      }
    });

    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [session?.userId, session?.churchId]);

  useEffect(() => {
    const syncMembershipFromEvent = async (payload: {
      targetUserId?: string;
      targetKristoId?: string;
      userId?: string;
      kristoId?: string;
    }) => {
      if (isSessionExitInProgress()) return;
      const loaded = await loadSession();
      if (!loaded?.userId) return;
      const kristoId = String((loaded as any)?.kristoId || "").trim();
      if (!inviteEventTargetsCurrentUser(payload, { userId: loaded.userId, kristoId })) return;

      clearResponseCacheForRequest("GET", "/api/auth/profile", loaded.userId);

      const cleared: KristoSession = {
        ...loaded,
        churchId: "",
        activeChurchId: "",
        churchName: "",
        role: "Member",
        churchRole: "Member",
      } as KristoSession;
      await saveSession(cleared);
      setSessionSync(cleared);
      setSessionState(cleared);

      const synced =
        (await silentSyncProfile(cleared, {
          forceFresh: true,
          throttleMs: 0,
          omitChurchHeader: true,
        })) || cleared;

      scheduleCoordinatedAppRefresh(synced, { force: true, delayMs: 2500 });
    };

    const unsubs = [
      onChurchInviteSent((payload) => {
        void syncMembershipFromEvent(payload);
      }),
      onChurchInviteAccepted((payload) => {
        void syncMembershipFromEvent(payload);
      }),
      onChurchMembershipChanged((payload) => {
        void syncMembershipFromEvent(payload);
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, []);

  async function setSession(s: KristoSession) {
    await saveSession(s);
    setSessionSync(s);
    setSessionState(s);
  }

  function exitSessionFast(params: {
    reason: ExitSessionReason;
    userId?: string;
    churchId?: string;
  }) {
    const sync = getSessionSync();
    const userId = String(params.userId || session?.userId || sync?.userId || "").trim();
    const churchId = String(params.churchId || session?.churchId || sync?.churchId || "").trim();

    if (params.reason === "delete") beginDeleteAccountExit();
    else beginLogoutExit();

    setSessionState(null);
    completeSessionExitCleanup({ userId, churchId }, params.reason);
  }

  async function logout() {
    exitSessionFast({ reason: "logout" });
  }

  const value = useMemo(
    () => ({ session, loading, setSession, logout, exitSessionFast }),
    [session, loading]
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useKristoSession() {
  const v = useContext(C);
  if (!v) throw new Error("useKristoSession must be used inside KristoSessionProvider");
  return v;
}
