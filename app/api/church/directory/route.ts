import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getChurchById, upsertChurchProfile } from "@/app/api/_lib/churches";
import { addActiveMember } from "@/app/api/_lib/memberships";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const id = String(new URL(req.url).searchParams.get("id") || "").trim().toUpperCase();
  if (!id) return json({ ok: false, error: "id missing" }, { status: 400 });

  const church = await getChurchById(id);
  if (!church) return json({ ok: false, error: "Church not found" }, { status: 404 });

  return json({ ok: true, data: church });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.churchId || body?.id || "").trim().toUpperCase();
  const name = String(body?.name || "").trim();

  if (!id) return json({ ok: false, error: "churchId missing" }, { status: 400 });
  if (!name) return json({ ok: false, error: "name missing" }, { status: 400 });

  const saved = await upsertChurchProfile({
    id,
    name,
    phone: body?.phone,
    country: body?.country || body?.churchCountry,
    province: body?.province || body?.churchProvince,
    city: body?.city || body?.churchCity,
    address: [body?.city || body?.churchCity, body?.province || body?.churchProvince, body?.country || body?.churchCountry].filter(Boolean).join(" • "),
    pastorName: body?.pastorName,
  });

  const pastorId = String(body?.pastorId || "").trim();
  if (pastorId) {
    const r = await addActiveMember(id, pastorId, body?.pastorName || "Pastor", "Pastor");
    if (!r.ok) {
      if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
        console.warn("[church/directory] addActiveMember failed", {
          churchId: id,
          pastorId,
          error: r.error,
        });
      }
      return json({ ok: false, error: r.error }, { status: 409 });
    }
    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[church/directory] pastor membership created", {
        churchId: id,
        pastorId,
        membershipId: r.membership.id,
        role: r.membership.churchRole,
      });
    }
  }

  return json({ ok: true, data: saved });
}
