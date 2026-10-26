import { redirect } from "next/navigation";

/**
 * Legacy /login (and /login/...) entry point. One server-side redirect to the
 * real sign-in page, keeping the return path and any sub-path. This replaces the
 * former duplicate app/(auth)/login page, which resolved to the same URL and
 * made `next build` fail.
 */
export default async function LoginLegacyPage({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { rest } = await params;
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";
  const requested = first(query.next) || first(query.redirect_url) || "/dashboard";
  // Only same-site relative paths, never an open redirect.
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
  const sub = (rest || []).map((segment) => encodeURIComponent(segment)).join("/");
  redirect(`/sign-in${sub ? `/${sub}` : ""}?next=${encodeURIComponent(next)}`);
}
