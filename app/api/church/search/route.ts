import { NextResponse } from "next/server";
import { searchChurches } from "@/app/api/_lib/churches";

export const runtime = "nodejs";

function num(value: string | null) {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();
    const city = String(url.searchParams.get("city") || "").trim();
    const country = String(url.searchParams.get("country") || "").trim();
    const language = String(url.searchParams.get("language") || "").trim();
    const lat = num(url.searchParams.get("lat"));
    const lng = num(url.searchParams.get("lng"));
    const limit = num(url.searchParams.get("limit"));

    const churches = await searchChurches({
      q: q || undefined,
      city: city || undefined,
      country: country || undefined,
      language: language || undefined,
      lat,
      lng,
      limit,
    });

    return NextResponse.json({
      ok: true,
      churches,
      total: churches.length,
      query: { q, city, country, language, lat, lng, limit: limit || 25 },
    });
  } catch (error: any) {
    const message = String(error?.message || error || "Church search failed.");
    console.error("[KRISTO CHURCH SEARCH ERROR]", message, error?.stack || error);
    return NextResponse.json({ ok: false, error: message, reason: "church_search_failed" }, { status: 500 });
  }
}
