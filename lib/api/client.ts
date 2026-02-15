export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; details?: any };
export type ApiRes<T> = ApiOk<T> | ApiErr;

const BASE_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_BASE_URL || ""
    : process.env.API_BASE_URL || "";

function devHeaders(): Record<string, string> {
  // DEV ONLY: keep existing header-auth flow (no breaking changes)
  const on = process.env.NEXT_PUBLIC_KRISTO_DEV_HEADER_AUTH === "1";
  if (!on) return {};

  const uid = (process.env.NEXT_PUBLIC_KRISTO_DEV_USER_ID || "").trim();
  const role = (process.env.NEXT_PUBLIC_KRISTO_DEV_ROLE || "").trim();
  const churchId = (process.env.NEXT_PUBLIC_KRISTO_DEV_CHURCH_ID || "").trim();

  const h: Record<string, string> = {};
  if (uid) h["x-kristo-user-id"] = uid;
  if (role) h["x-kristo-role"] = role;
  if (churchId) h["x-kristo-church-id"] = churchId;
  return h;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<ApiRes<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...devHeaders(),
        "Content-Type": "application/json",
      },
    });

    const json = await res.json();
    return json;
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error" };
  }
}
