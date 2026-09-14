export const INCOMPLETE_EMAIL_MESSAGE =
  "Please enter the full email address, including @gmail.com.";

export function looksLikePhoneInput(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const compact = trimmed.replace(/\s/g, "");
  return digits.length / Math.max(compact.length, 1) >= 0.7;
}

export function getLoginIdentifierValidationError(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.includes("@") || looksLikePhoneInput(trimmed)) {
    return null;
  }

  // Values like "baealima131.com" are treated as phone server-side and fail lookup.
  if (trimmed.includes(".") || /[a-zA-Z]/.test(trimmed)) {
    return INCOMPLETE_EMAIL_MESSAGE;
  }

  return null;
}

export function getLoginPasswordValidationError(value: string): string | null {
  if (!String(value || "")) return "Enter your password.";
  return null;
}

export function getKristoLoginValidationError(
  identifier: string,
  password: string
): string | null {
  const trimmed = String(identifier || "").trim();
  if (!trimmed) return "Enter your email or phone number.";
  const identifierError = getLoginIdentifierValidationError(trimmed);
  if (identifierError) return identifierError;
  return getLoginPasswordValidationError(password);
}

export function supportedKristoLoginIdentifierType(
  identifier: string
): "email" | "phone" | "invalid" {
  const trimmed = String(identifier || "").trim();
  if (!trimmed || getLoginIdentifierValidationError(trimmed)) return "invalid";
  if (trimmed.includes("@")) return "email";
  if (looksLikePhoneInput(trimmed)) return "phone";
  return "invalid";
}
