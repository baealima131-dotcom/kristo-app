import worldCountries from "world-countries";

export type KristoCountry = {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  dialCode: string;
  flag: string;
};

function isoToFlag(iso2: string): string {
  const iso = iso2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return "🏳️";
  const base = 0x1f1e6;
  return String.fromCodePoint(iso.charCodeAt(0) - 65 + base, iso.charCodeAt(1) - 65 + base);
}

function formatDialCode(idd?: { root?: string; suffixes?: string[] }): string {
  const root = String(idd?.root || "").trim();
  if (!root) return "";

  const normalized = root.startsWith("+") ? root : `+${root}`;
  const suffixes = (idd?.suffixes || []).map((s) => String(s).trim()).filter(Boolean);
  if (!suffixes.length) return normalized;

  // NANP and similar: many area-code suffixes — country code is the root only (+1).
  if (suffixes.length > 5) return normalized;

  const primary = suffixes[0];
  if (!primary) return normalized;

  const rootDigits = normalized.replace(/\D/g, "");
  return `+${rootDigits}${primary}`;
}

function buildKristoCountries(): KristoCountry[] {
  const rows: KristoCountry[] = [];

  for (const entry of worldCountries) {
    const code = String(entry.cca2 || "").trim().toUpperCase();
    const name = String(entry.name?.common || "").trim();
    if (!code || !name) continue;

    rows.push({
      code,
      name,
      dialCode: formatDialCode(entry.idd),
      flag: isoToFlag(code),
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export const KRISTO_COUNTRIES: KristoCountry[] = buildKristoCountries();

export const DEFAULT_KRISTO_COUNTRY: KristoCountry =
  KRISTO_COUNTRIES.find((c) => c.code === "US") ?? KRISTO_COUNTRIES[0];

export function findKristoCountryByCode(code: string): KristoCountry | undefined {
  const iso = String(code || "").trim().toUpperCase();
  if (!iso) return undefined;
  return KRISTO_COUNTRIES.find((c) => c.code === iso);
}

export function filterKristoCountries(query: string): KristoCountry[] {
  const raw = query.trim();
  if (!raw) return KRISTO_COUNTRIES;

  const q = raw.toLowerCase();
  const dialQ = raw.replace(/[\s-]/g, "");

  return KRISTO_COUNTRIES.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.code.toLowerCase().includes(q)) return true;

    const dial = c.dialCode.replace(/[\s-]/g, "");
    if (!dial) return false;

    if (dial.toLowerCase().includes(dialQ.toLowerCase())) return true;
    if (dialQ.startsWith("+") && dial.includes(dialQ)) return true;

    const dialDigits = dial.replace(/\D/g, "");
    const queryDigits = dialQ.replace(/\D/g, "");
    if (queryDigits && dialDigits.includes(queryDigits)) return true;

    return false;
  });
}
