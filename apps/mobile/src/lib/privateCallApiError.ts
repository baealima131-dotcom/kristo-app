const CALL_UNAVAILABLE_MESSAGE =
  "Call service is not available right now. Please try again.";

function looksLikeHtml(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  return (
    /^<!doctype html/i.test(text) ||
    /^<html[\s>]/i.test(text) ||
    text.includes("</html>") ||
    text.includes("<body")
  );
}

export function isPrivateCallApiUnavailable(res: unknown, status?: number): boolean {
  const body = (res || {}) as Record<string, unknown>;
  const httpStatus = Number(status || body.status || 0);
  const reason = String(body.reason || "").trim();
  const error = String(body.error || body.message || "").trim();

  if (httpStatus === 404) return true;
  if (reason === "html_response" || reason === "invalid_json") return true;
  if (reason === "network_error") return true;
  if (looksLikeHtml(error)) return true;
  return false;
}

export function sanitizePrivateCallApiFailure(
  res: unknown,
  path: string
): { code: string; message: string } {
  const body = (res || {}) as Record<string, unknown>;
  const status = Number(body.status || 0) || undefined;
  const rawError = String(body.error || body.message || "").trim();

  if (isPrivateCallApiUnavailable(res, status)) {
    console.log("KRISTO_PRIVATE_CALL_API_UNAVAILABLE", {
      status: status || null,
      path,
      safeError: "api_unavailable",
      reason: String(body.reason || (looksLikeHtml(rawError) ? "html_response" : "http_error")),
    });
    return { code: "api_unavailable", message: CALL_UNAVAILABLE_MESSAGE };
  }

  if (rawError === "self_call_blocked") {
    return {
      code: "self_call_blocked",
      message: "You are the church pastor. Use MY WAY to reach members another way.",
    };
  }

  if (rawError === "pastor_unavailable") {
    return {
      code: "pastor_unavailable",
      message:
        String(body.message || "").trim() ||
        "Your church pastor is not available for calling right now.",
    };
  }

  if (rawError && !looksLikeHtml(rawError)) {
    return { code: rawError, message: rawError };
  }

  return { code: "create_failed", message: CALL_UNAVAILABLE_MESSAGE };
}

export { CALL_UNAVAILABLE_MESSAGE };
