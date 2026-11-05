import { NextResponse } from "next/server";
import { ChurchApplicationError } from "@/app/api/_lib/churchApplications";

export function caJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function caError(error: unknown, source: string) {
  if (error instanceof ChurchApplicationError) {
    return caJson({ ok: false, error: error.code, message: error.message, details: error.details }, error.status);
  }
  console.error("KRISTO_CHURCH_APPLICATION_ERROR", { source, error: String((error as any)?.message || error) });
  return caJson({ ok: false, error: "server_error", message: "Something went wrong. Please try again." }, 500);
}
