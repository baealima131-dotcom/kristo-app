// app/page.tsx
import { redirect } from "next/navigation";
import { vipGetViewer } from "@/app/api/_lib/vipAuthCookies";
import { vipGetProfile } from "@/app/api/_lib/vipAuthStore";

export default async function Page() {
  const viewer = await vipGetViewer();
  if (!viewer) redirect("/sign-in");

  const profile = vipGetProfile(viewer.userId);
  if (!profile) redirect("/onboarding");

  redirect("/dashboard");
}
