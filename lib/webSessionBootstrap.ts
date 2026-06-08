"use client";

import { webAuthHeaders } from "@/lib/webSession";

let bootstrapped = false;

export function ensureWebAuthFetchPatched() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    const isKristoApi = url.startsWith("/api/") || url.includes("/api/");
    if (!isKristoApi) return nativeFetch(input, init);

    const auth = webAuthHeaders();
    const hasUserId = Boolean(auth["x-kristo-user-id"]);
    const hasSessionToken = Boolean(auth["x-kristo-session-token"]);
    const tokenLen = auth["x-kristo-session-token"]?.length || 0;

    console.log("KRISTO_WEB_AUTH_FETCH_HEADERS", {
      url,
      source: "fetch-bootstrap",
      hasUserId,
      hasSessionToken,
      tokenLen,
    });

    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(auth)) {
      if (!headers.has(key)) headers.set(key, value);
    }

    return nativeFetch(input, {
      ...init,
      headers,
      credentials: init?.credentials ?? "include",
    });
  };
}

if (typeof window !== "undefined") {
  ensureWebAuthFetchPatched();
}
