"use client";

import { webAuthHeaders } from "@/lib/webSession";

let bootstrapped = false;

function patchWebAuthFetch() {
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

    const headers = new Headers(init?.headers);
    const auth = webAuthHeaders();
    for (const [key, value] of Object.entries(auth)) {
      if (!headers.has(key)) headers.set(key, value);
    }

    console.log("KRISTO_WEB_AUTH_FETCH_HEADERS", {
      url,
      source: "fetch-bootstrap",
      hasUserId: Boolean(auth["x-kristo-user-id"]),
      hasSessionToken: Boolean(auth["x-kristo-session-token"]),
      userId: auth["x-kristo-user-id"] || null,
      sessionTokenLen: auth["x-kristo-session-token"]?.length || 0,
    });

    return nativeFetch(input, {
      ...init,
      headers,
      credentials: init?.credentials ?? "include",
    });
  };

  console.log("KRISTO_WEB_AUTH_FETCH_HEADERS", { bootstrap: true, patched: true });
}

// Patch synchronously on module load so dashboard child fetches get auth headers immediately.
if (typeof window !== "undefined") {
  patchWebAuthFetch();
}

export default function WebAuthFetchBootstrap() {
  patchWebAuthFetch();
  return null;
}
