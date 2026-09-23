import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

function cleanHeader(value: string | null) {
  return String(value || "").trim();
}

function sameHex(a: string, b: string) {
  if (
    !/^[0-9a-f]+$/i.test(a) ||
    !/^[0-9a-f]+$/i.test(b) ||
    a.length !== b.length
  ) {
    return false;
  }

  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  return (
    left.length === right.length &&
    left.length > 0 &&
    timingSafeEqual(left, right)
  );
}

/**
 * Cash App Pay webhook signatures currently use these
 * canonical request headers.
 *
 * X-Signed-Headers must declare all four. We fail closed
 * if Cash App sends a signing shape we do not understand.
 */
const CANONICAL_HEADER_NAMES = [
  "accept",
  "authorization",
  "content-type",
  "host",
] as const;

function parseSignedHeaderNames(value: string) {
  const names = new Set<string>();

  for (const part of value.split(",")) {
    const separator = part.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    const name = part
      .slice(0, separator)
      .trim()
      .toLowerCase();

    if (name) {
      names.add(name);
    }
  }

  return names;
}

export function verifyCashAppWebhookSignature(args: {
  method: string;
  path: string;
  rawBody: string;
  headers: Headers;
}) {
  const secret = String(
    process.env.CASH_APP_WEBHOOK_API_SECRET || ""
  ).trim();

  if (!secret) {
    return {
      ok: false as const,
      reason: "missing_secret" as const,
    };
  }

  const signatureHeader = cleanHeader(
    args.headers.get("x-signature")
  );

  const [version, receivedSignature] =
    signatureHeader.split(/\s+/, 2);

  if (
    version !== "V1" ||
    !receivedSignature
  ) {
    return {
      ok: false as const,
      reason:
        "missing_or_invalid_signature" as const,
    };
  }

  const signedHeadersValue = cleanHeader(
    args.headers.get("x-signed-headers")
  );

  if (!signedHeadersValue) {
    return {
      ok: false as const,
      reason:
        "missing_signed_headers" as const,
    };
  }

  const signedHeaderNames =
    parseSignedHeaderNames(
      signedHeadersValue
    );

  /*
   * Require the exact Cash App webhook signing set
   * that this verifier knows how to reconstruct.
   *
   * If Cash App changes the signing contract later,
   * reject safely until we update the verifier.
   */
  if (
    signedHeaderNames.size !==
      CANONICAL_HEADER_NAMES.length ||
    !CANONICAL_HEADER_NAMES.every(
      (name) =>
        signedHeaderNames.has(name)
    )
  ) {
    return {
      ok: false as const,
      reason:
        "unsupported_signed_headers" as const,
    };
  }

  const canonicalHeaderLines: string[] = [];

  for (
    const name of CANONICAL_HEADER_NAMES
  ) {
    const value = args.headers.get(name);

    if (value === null) {
      return {
        ok: false as const,
        reason:
          "missing_canonical_header" as const,
      };
    }

    canonicalHeaderLines.push(
      `${name}:${value.trim()}`
    );
  }

  /*
   * Important:
   * no trailing newline is placed inside
   * canonicalHeaders itself.
   *
   * The canonical request adds exactly one newline
   * between the headers block and body digest.
   */
  const canonicalHeaders =
    canonicalHeaderLines.join("\n");

  const bodyDigest = createHash("sha256")
    .update(
      Buffer.from(args.rawBody, "utf8")
    )
    .digest("hex")
    .toLowerCase();

  const method = String(
    args.method || "POST"
  )
    .trim()
    .toUpperCase();

  const path = args.path || "/";

  const canonical =
    `${method}\n` +
    `${path}\n` +
    `${canonicalHeaders}\n` +
    `${bodyDigest}`;

  const expectedSignature = createHmac(
    "sha256",
    secret
  )
    .update(canonical)
    .digest("hex")
    .toLowerCase();

  const ok = sameHex(
    receivedSignature.toLowerCase(),
    expectedSignature
  );

  return ok
    ? {
        ok: true as const,
      }
    : {
        ok: false as const,
        reason:
          "signature_mismatch" as const,
      };
}
