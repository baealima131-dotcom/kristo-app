// A first pass for text submissions. Reports and human review remain necessary for
// images, context-dependent abuse, and attempts to evade phrase matching.
const OBJECTIONABLE = [
  /\bkill\s+(?:yourself|you)\b/i,
  /\b(?:child|minor)\s+(?:porn|sexual|nudes?)\b/i,
  /\b(?:rape|lynch)\s+(?:you|them|her|him)\b/i,
  /\b(?:send|share)\s+(?:your\s+)?(?:password|verification\s+code|one.time\s+code)\b/i,
];

export function assertSokoContentAllowed(...fields: unknown[]) {
  const text = fields.map((field) => String(field || "")).join(" ");
  if (OBJECTIONABLE.some((pattern) => pattern.test(text))) {
    throw Object.assign(new Error("This content cannot be posted. Edit it and try again."), { status: 400 });
  }
}
