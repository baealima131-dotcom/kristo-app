const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse YYYY-MM-DD as a local calendar day — never UTC midnight via `new Date("YYYY-MM-DD")`. */
export function parseLocalIsoDateOnlyParts(raw: string) {
  const text = String(raw || "").trim();
  const dateOnly = text.split("T")[0];
  const match = ISO_DATE_ONLY_RE.exec(dateOnly);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return null;
  }

  return { year, monthIndex, day };
}

/** Locale labels like "Jul 04, 2026" — never pass YYYY-MM-DD through `new Date(iso)`. */
export function parseLocaleDisplayDateLabel(raw: string) {
  const text = String(raw || "").trim();
  if (!text || parseLocalIsoDateOnlyParts(text)) return null;

  const d = new Date(text);
  if (!Number.isFinite(d.getTime())) return null;

  return { year: d.getFullYear(), monthIndex: d.getMonth(), day: d.getDate() };
}

export function localMsFromCalendarParts(
  parts: { year: number; monthIndex: number; day: number },
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
) {
  return new Date(parts.year, parts.monthIndex, parts.day, hour, minute, second, ms).getTime();
}

/** Resolve a calendar date string to local epoch ms; ISO date-only strings stay on that local day. */
export function parseLocalCalendarDateMs(
  rawDate: string,
  opts?: { hour?: number; minute?: number; second?: number; ms?: number }
) {
  const isoParts = parseLocalIsoDateOnlyParts(rawDate);
  if (isoParts) {
    return localMsFromCalendarParts(
      isoParts,
      opts?.hour ?? 0,
      opts?.minute ?? 0,
      opts?.second ?? 0,
      opts?.ms ?? 0
    );
  }

  const localeParts = parseLocaleDisplayDateLabel(String(rawDate || "").trim());
  if (localeParts) {
    return localMsFromCalendarParts(
      localeParts,
      opts?.hour ?? 0,
      opts?.minute ?? 0,
      opts?.second ?? 0,
      opts?.ms ?? 0
    );
  }

  const base = new Date(String(rawDate || "").trim());
  if (!Number.isFinite(base.getTime())) return 0;

  return localMsFromCalendarParts(
    { year: base.getFullYear(), monthIndex: base.getMonth(), day: base.getDate() },
    opts?.hour ?? base.getHours(),
    opts?.minute ?? base.getMinutes(),
    opts?.second ?? base.getSeconds(),
    opts?.ms ?? base.getMilliseconds()
  );
}

/** Local calendar midnight for meridiem clock parsing — safe for YYYY-MM-DD strings. */
export function localCalendarDateFromString(rawDate: string): Date | null {
  const isoParts = parseLocalIsoDateOnlyParts(rawDate);
  if (isoParts) {
    return new Date(isoParts.year, isoParts.monthIndex, isoParts.day, 0, 0, 0, 0);
  }

  const localeParts = parseLocaleDisplayDateLabel(String(rawDate || "").trim());
  if (localeParts) {
    return new Date(localeParts.year, localeParts.monthIndex, localeParts.day, 0, 0, 0, 0);
  }

  const base = new Date(String(rawDate || "").trim());
  if (!Number.isFinite(base.getTime())) return null;

  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
}

export function formatLocalIsoDateFromMs(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
