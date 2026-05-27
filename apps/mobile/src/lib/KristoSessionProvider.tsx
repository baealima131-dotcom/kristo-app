import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import type { KristoSession } from "./kristoSession";
import {
  MOBILE_SESSION_IDLE_MS,
  clearSession,
  loadSession,
  saveSession,
  setSessionSync,
  touchMobileSession,
} from "./kristoSession";
import { fetchMyActiveChurchMembership } from "./churchMembersApi";
import { apiGet } from "./kristoApi";
import { getKristoHeaders } from "./kristoHeaders";
import { resolveChurchDisplayName } from "./churchStore";
import { resolveActiveChurchFromProfileResponse } from "./churchMembershipSync";
import { clearResponseCacheForRequest } from "./kristoTraffic";
import { silentPreloadTabScreens } from "./screenDataCache";
import {
  inviteEventTargetsCurrentUser,
  onChurchInviteAccepted,
  onChurchInviteSent,
  onChurchMembershipChanged,
} from "./kristoChurchInviteEvents";

type Ctx = {
  session: KristoSession | null;
  loading: boolean;
  setSession: (s: KristoSession) => Promise<void>;
  logout: () => Promise<void>;
};

const C = createContext<Ctx | null>(null);

export function KristoSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<KristoSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSession();
      if (!alive) return;

      setSessionSync(s);
      setSessionState(s);
      setLoading(false);

      // Home ifunguke kwanza; profile/church/home feed zijipange kimya kimya nyuma
      (async () => {
        const ready = ((await silentSyncProfile(s, { returnOnly: true })) as KristoSession | null) || s || null;
        if (!alive || !ready?.userId) return;
        setSessionSync(ready);
        setSessionState(ready);
        await silentPreloadChurchAndHome(ready);
      })();
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function silentPreloadChurchAndHome(baseSession: KristoSession | null) {
    await silentPreloadTabScreens(baseSession);
  }

  async function silentSyncProfile(baseSession: KristoSession | null, opts?: { returnOnly?: boolean }) {
    if (!baseSession?.userId) return baseSession;

    try {
      const headerChurchId = String(baseSession.churchId || "").trim();
      if (!headerChurchId) {
        clearResponseCacheForRequest("GET", "/api/auth/profile", baseSession.userId);
      }

      const res: any = await apiGet("/api/auth/profile", {
        headers: getKristoHeaders({ userId: baseSession.userId, role: baseSession.role, churchId: headerChurchId }),
      }, { screen: "SessionProvider", throttleMs: headerChurchId ? 120000 : 0 });

      if (!res?.ok || !res?.profile) return baseSession;

      const p = res.profile;
      const resolved = resolveActiveChurchFromProfileResponse(res);
      const syncedChurchId = resolved.churchId;
      const syncedRole = resolved.churchId ? resolved.role : "Member";
      console.log("KRISTO_MEMBERSHIP_RESOLVED", {
        userId: baseSession.userId,
        headerChurchId,
        syncedChurchId,
        membershipStatus: String(res?.activeMembership?.status || "none"),
        churchRole: syncedRole,
        source: "mobile-profile-sync",
      });
      const churchName = syncedChurchId
        ? String(res?.churchName || "").trim() || (await resolveChurchDisplayName(syncedChurchId, baseSession.userId))
        : "";
      const next: KristoSession = {
        ...baseSession,
        churchId: syncedChurchId,
        activeChurchId: syncedChurchId,
        churchName: churchName || (syncedChurchId ? (baseSession as any).churchName || "" : ""),
        role: syncedRole as any,
        churchRole: syncedRole as any,
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
    if (!session?.userId) return;

    const checkExpiry = async () => {
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
            const churchName = await resolveChurchDisplayName(syncedChurchId, loaded.userId);
            const next = {
              ...loaded,
              churchId: syncedChurchId,
              activeChurchId: syncedChurchId,
              churchName: churchName || (loaded as any).churchName || "",
              role: syncedRole as any,
              churchRole: syncedRole as any,
            };
            await saveSession(next);
            setSessionSync(next);
            setSessionState(next);
          }
        } catch {}
      }
    };

    silentSyncProfile(session);
    void silentPreloadTabScreens(session);
    const t = setInterval(async () => {
      await checkExpiry();
      const latest = await loadSession();
      await silentSyncProfile(latest || session);
    }, 120000);

    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "active") {
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
                const churchName = await resolveChurchDisplayName(syncedChurchId, touched.userId);
                const next = {
                  ...touched,
                  churchId: syncedChurchId,
                  activeChurchId: syncedChurchId,
                  churchName: churchName || (touched as any).churchName || "",
                  role: syncedRole as any,
                  churchRole: syncedRole as any,
                };
                await saveSession(next);
                setSessionSync(next);
                setSessionState(next);
                return;
              }
            } catch {}
          }
          setSessionState(touched);
          await silentSyncProfile(touched);
          await silentPreloadTabScreens(touched);
        }
      }
    });

    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [session?.userId, session?.churchId]);

  useEffect(() => {
    const syncMembershipFromEvent = async (payload: { targetUserId?: string; targetKristoId?: string; userId?: string; kristoId?: string }) => {
      const loaded = await loadSession();
      if (!loaded?.userId) return;
      const kristoId = String((loaded as any)?.kristoId || "").trim();
      if (!inviteEventTargetsCurrentUser(payload, { userId: loaded.userId, kristoId })) return;
      clearResponseCacheForRequest("GET", "/api/auth/profile", loaded.userId);
      await silentSyncProfile(loaded);
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

  async function logout() {
    await clearSession();
    setSessionState(null);
  }

  const value = useMemo(() => ({ session, loading, setSession, logout }), [session, loading]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useKristoSession() {
  const v = useContext(C);
  if (!v) throw new Error("useKristoSession must be used inside KristoSessionProvider");
  return v;
}
