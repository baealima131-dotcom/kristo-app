import { cookies } from "next/headers";
import { vipFindSessionByToken, vipGetUserById } from "./vipAuthStore";

export const VIP_SESSION_COOKIE = "kristo_vip_session";

export type VipViewer = {
  userId: string;
  email: string;
};

export async function vipGetViewer(): Promise<VipViewer | null> {
  const ck = await cookies();
  const token = ck.get(VIP_SESSION_COOKIE)?.value;
  if (!token) return null;

  const s = vipFindSessionByToken(token);
  if (!s) return null;

  const u = vipGetUserById(s.userId);
  if (!u) return null;

  return { userId: u.id, email: u.email };
}

export async function vipRequireViewer() {
  const v = await vipGetViewer();
  if (!v) {
    const err: any = new Error("UNAUTHENTICATED");
    err.status = 401;
    throw err;
  }
  return v;
}
