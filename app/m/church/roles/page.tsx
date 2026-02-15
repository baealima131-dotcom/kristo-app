import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function MobileChurchRolesPage() {
  redirect("/dashboard/church/roles?embed=1");
}
