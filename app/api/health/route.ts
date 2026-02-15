export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    now: new Date().toISOString(),
  });
}
