import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import {
  getSokoPaymentProof,
  getSokoPaymentProofAtPosition,
  getSokoPaymentProofCount,
  saveSokoPaymentProof,
  saveSokoPaymentProofAtPosition,
} from "@/app/api/_lib/store/sokoOrdersDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function detectImage(bytes: Buffer) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return "";
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;

    /*
     * KRISTO_SOKO_MULTI_PROOF_ROUTE_V1
     *
     * Backward compatibility:
     *   no index  -> legacy first screenshot
     *   ?index=0 -> first screenshot
     *   ?index=1..4 -> additional screenshots
     *   ?meta=1 -> authenticated screenshot count
     */
    if (req.nextUrl.searchParams.get("meta") === "1") {
      const paymentProofCount =
        await getSokoPaymentProofCount({
          userId: auth.viewer.userId,
          orderId: id,
        });

      return reply({
        ok: true,
        paymentProofCount,
      });
    }

    const rawIndex =
      req.nextUrl.searchParams.get("index");

    let proof;

    if (rawIndex === null) {
      proof = await getSokoPaymentProof({
        userId: auth.viewer.userId,
        orderId: id,
      });
    } else {
      const position = Number(rawIndex);

      if (
        !Number.isInteger(position) ||
        position < 0 ||
        position > 4
      ) {
        return reply(
          {
            ok: false,
            error:
              "Payment screenshot index must be between 0 and 4.",
          },
          400
        );
      }

      proof = await getSokoPaymentProofAtPosition({
        userId: auth.viewer.userId,
        orderId: id,
        position,
      });
    }

    return new NextResponse(new Uint8Array(proof.bytes), {
      headers: {
        "Content-Type": proof.mime,
        "Content-Length": String(proof.bytes.length),
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="payment-proof"',
      },
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load payment proof.",
      },
      403
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const contentType = req.headers.get("content-type") || "";

    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      return reply({ ok: false, error: "Expected multipart/form-data." }, 400);
    }

    if (!req.body) {
      return reply({ ok: false, error: "Screenshot is required." }, 400);
    }

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;

        total += part.value.byteLength;

        if (total > MAX_REQUEST_BYTES) {
          await reader.cancel();
          return reply(
            { ok: false, error: "Payment screenshot is too large. Maximum is 6 MB per image." },
            413
          );
        }

        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }

    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": contentType },
    }).formData();

    const files = form.getAll("file");

    if (files.length !== 1 || !(files[0] instanceof File)) {
      return reply(
        { ok: false, error: "Send exactly one screenshot." },
        400
      );
    }

    const image = files[0];

    if (image.size < 1 || image.size > MAX_IMAGE_BYTES) {
      return reply(
        { ok: false, error: "Screenshot must be 6 MB or smaller." },
        413
      );
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    const mime = detectImage(bytes);

    if (!mime) {
      return reply(
        { ok: false, error: "Use a JPEG, PNG or WebP screenshot." },
        415
      );
    }

    const { id } = await context.params;

    const rawIndex =
      req.nextUrl.searchParams.get("index");

    let order;

    /*
     * Old clients do not send index. Keep their exact
     * historical single-screenshot behavior untouched.
     */
    if (rawIndex === null) {
      order = await saveSokoPaymentProof({
        userId: auth.viewer.userId,
        orderId: id,
        bytes,
        mime,
      });
    } else {
      const position = Number(rawIndex);

      if (
        !Number.isInteger(position) ||
        position < 0 ||
        position > 4
      ) {
        return reply(
          {
            ok: false,
            error:
              "Payment screenshot index must be between 0 and 4.",
          },
          400
        );
      }

      const reset =
        req.nextUrl.searchParams.get("reset") ===
        "1";

      order = await saveSokoPaymentProofAtPosition({
        userId: auth.viewer.userId,
        orderId: id,
        bytes,
        mime,
        position,
        reset,
      });
    }

    return reply({ ok: true, order }, 201);
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not upload payment proof.",
      },
      400
    );
  }
}
