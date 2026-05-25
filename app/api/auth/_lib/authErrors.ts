import { NextResponse } from "next/server";
import { isAuthDatabaseError } from "@/app/api/_lib/store/authDb";

export function authDatabaseErrorResponse(error: unknown) {
  if (!isAuthDatabaseError(error)) return null;
  return NextResponse.json(
    {
      ok: false,
      error: "Auth database not configured",
      reason: "auth_db_not_configured",
    },
    { status: 503 }
  );
}
