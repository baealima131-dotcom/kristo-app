import { handleLogin } from "@/app/api/auth/_lib/loginHandler";

export const runtime = "nodejs";

// Backward-compatible alias for old endpoint.
export async function POST(req: Request) {
  return handleLogin(req);
}
