import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { KristoSession } from "./kristoSession";
import { clearSession, loadSession, saveSession, setSessionSync } from "./kristoSession";

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
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function setSession(s: KristoSession) {
    await saveSession(s);
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
