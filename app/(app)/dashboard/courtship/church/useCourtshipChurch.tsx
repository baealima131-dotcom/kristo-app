"use client";

import { useEffect, useState } from "react";

type MeResponse = {
  ok: boolean;
  viewer?: { userId: string; email?: string };
};

export function useCourtshipChurch() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        const d: MeResponse = await r.json().catch(() => ({ ok: false }));
        if (r.ok && d?.ok && d.viewer?.userId) {
          setUserId(d.viewer.userId);
          setEmail(String(d.viewer.email || ""));
        } else {
          setUserId("");
          setEmail("");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { loading, userId, email };
}
