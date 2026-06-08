"use client";

import { useRouter } from "next/navigation";
import { clearWebSession, webAuthFetch } from "@/lib/webSession";

export default function UserMenu() {
  const router = useRouter();

  async function onLogout() {
    try {
      await webAuthFetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearWebSession();
      router.replace("/sign-in");
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      className="text-sm px-3 py-2 rounded-md border border-white/15 hover:bg-white/5"
    >
      Logout
    </button>
  );
}
