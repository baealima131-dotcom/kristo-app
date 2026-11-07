import { churchNotActiveResponse } from "@/app/api/_lib/churchActivationGate";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getChurchById, isChurchOpen, upsertChurchProfile } from "@/app/api/_lib/churches";
import { addActiveMember, getActiveMembership, isApproverForChurch } from "@/app/api/_lib/memberships";
import { resolveVerifiedUserId } from "@/app/api/_lib/verifiedChurchActor";
import { getChurchStoreDiagnostics, isChurchDatabaseError } from "@/app/api/_lib/store/churchDb";

const CHURCH_APPLICATION_UPDATE_MESSAGE =
  "Kristo App now reviews every new church before it opens. Please update Kristo App to the latest version, then apply for your church from the Church tab.";

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
  // Registering a church makes the caller its Pastor, and updating one rewrites its public
  // profile: verified session only. Previously anyone could overwrite any church or make any
  // pastorId the Pastor of it.
  const userIdOrRes = await resolveVerifiedUserId(req);
  if (userIdOrRes instanceof NextResponse) return userIdOrRes;
  const userId = userIdOrRes;
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.churchId || body?.id || "").trim().toUpperCase();
    const name = String(body?.name || "").trim();

    if (!id) return json({ ok: false, error: "churchId missing" }, { status: 400 });
    if (!name) return json({ ok: false, error: "name missing" }, { status: 400 });

    const claimedPastorId = String(body?.pastorId || "").trim();
    if (claimedPastorId && claimedPastorId !== userId) {
      console.log("KRISTO_CHURCH_DIRECTORY_DENIED", { userId, churchId: id, reason: "pastor_mismatch" });
      return json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // An existing church may only be updated by its Pastor / Church_Admin; a new one is
    // registered for a caller who is not already an active member somewhere.
    const existing = await getChurchById(id);
    if (existing) {
      // A church waiting for activation keeps the details it was approved with.
      if (!isChurchOpen(existing)) return churchNotActiveResponse(String(existing.activationStatus || "pending"));
      if (!(await isApproverForChurch(userId, id))) {
        console.log("KRISTO_CHURCH_DIRECTORY_DENIED", { userId, churchId: id, reason: "not_church_admin" });
        return json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    } else {
      // New churches are created only through a church application approved by a System Admin
      // (POST /api/church/applications); this route only updates existing churches.
      console.log("KRISTO_CHURCH_DIRECTORY_DENIED", { userId, churchId: id, reason: "church_application_required" });
      // Older app versions show `error` as-is after "Server registration failed", so it is a
      // plain sentence; current apps never call this for new churches and read `code`.
      return json(
        {
          ok: false,
          error: CHURCH_APPLICATION_UPDATE_MESSAGE,
          message: CHURCH_APPLICATION_UPDATE_MESSAGE,
          code: "church_application_required",
          updateRequired: true,
        },
        { status: 403 }
      );
    }

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

    const pastorId = existing ? "" : userId;
    let membership: any = null;
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
      membership = r.membership;
      if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
        console.log("[church/directory] pastor membership created", {
          churchId: id,
          pastorId,
          membershipId: r.membership.id,
          role: r.membership.churchRole,
        });
      }
    }

    const store = await getChurchStoreDiagnostics({ userId: pastorId, churchId: id });

    return json({
      ok: true,
      data: saved,
      membership,
      storeMode: store.storeMode,
    });
  } catch (error: any) {
    if (isChurchDatabaseError(error)) {
      return json({ ok: false, error: "Church database not configured", reason: "missing_db" }, { status: 503 });
    }
    console.error("[church/directory] POST failed", error);
    return json({ ok: false, error: String(error?.message || error || "Create failed") }, { status: 500 });
  }
}
