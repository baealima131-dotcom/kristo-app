// app/(auth)/login/[[...rest]]/page.tsx
import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect("/sign-in");
}
