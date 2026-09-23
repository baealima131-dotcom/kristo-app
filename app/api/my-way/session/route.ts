import { verifySessionToken } from "@/app/api/auth/_lib/sessionToken";
import { getUserById } from "@/app/api/auth/_lib/session";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const token = (req.headers.get("x-kristo-session-token") || "").trim();
  const claimedUserId = (req.headers.get("x-kristo-user-id") || "").trim();

  if (!token || token.length > 4096) {
    return json({ ok: false, error: "Ingia kwenye Kristo App kwanza." }, 401);
  }

  // Do not accept tokens signed with the public development fallback.
  const hasSecret = Boolean(
    process.env.KRISTO_SESSION_SECRET?.trim() ||
    process.env.KRISTO_OTP_SECRET?.trim() ||
    process.env.RESEND_API_KEY?.trim()
  );
  if (!hasSecret) {
    return json({
      ok: false,
      error: "Server haijawekewa secret ya kuthibitisha session.",
    }, 503);
  }

  try {
    const verified = verifySessionToken(token, claimedUserId || undefined);
    if (!verified.ok || !verified.userId) {
      return json({
        ok: false,
        error: "Session si halali au imeisha. Ingia tena.",
      }, 401);
    }

    const user = await getUserById(verified.userId);
    if (!user) {
      return json({ ok: false, error: "Akaunti haipatikani." }, 401);
    }

    return json({
      ok: true,
      user: { userId: user.id },
    });
  } catch {
    return json({
      ok: false,
      error: "Uthibitishaji haujakamilika. Jaribu tena.",
    }, 503);
  }
}
