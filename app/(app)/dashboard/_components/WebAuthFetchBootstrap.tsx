"use client";

import { ensureWebAuthFetchPatched } from "@/lib/webSessionBootstrap";

ensureWebAuthFetchPatched();

export default function WebAuthFetchBootstrap() {
  ensureWebAuthFetchPatched();
  return null;
}
