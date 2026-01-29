// app/(app)/dashboard/courtship/discover/page.tsx
"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CourtshipTabs from "../_components/CourtshipTabs";
import { useCourtshipStore, type ApiProfile, type VerificationStatus } from "../_lib/courtshipStore";

/* =========================
   FILTER TYPES
   ========================= */

type GenderFilter = "Male" | "Female" | "All";
type FaithFilter = "All" | "New" | "Growing" | "Mature";
type RequestStatus = "Pending" | "Accepted" | "Declined";

/** Countries (UI only) */
type CountryCode =
  | "ALL"
  | "US"
  | "CA"
  | "MX"
  | "GB"
  | "FR"
  | "DE"
  | "IT"
  | "ES"
  | "NL"
  | "BE"
  | "CH"
  | "SE"
  | "NO"
  | "DK"
  | "IE"
  | "PT"
  | "GR"
  | "PL"
  | "CZ"
  | "AT"
  | "HU"
  | "RO"
  | "BG"
  | "RU"
  | "UA"
  | "TR"
  | "SA"
  | "AE"
  | "QA"
  | "KW"
  | "OM"
  | "IL"
  | "IN"
  | "PK"
  | "BD"
  | "LK"
  | "NP"
  | "CN"
  | "JP"
  | "KR"
  | "VN"
  | "TH"
  | "MY"
  | "SG"
  | "ID"
  | "PH"
  | "AU"
  | "NZ"
  | "BR"
  | "AR"
  | "CL"
  | "CO"
  | "PE"
  | "VE"
  | "ZA"
  | "NG"
  | "GH"
  | "CI"
  | "SN"
  | "CM"
  | "KE"
  | "UG"
  | "TZ"
  | "RW"
  | "BI"
  | "CD"
  | "CG"
  | "ZM"
  | "ZW"
  | "AO"
  | "MZ"
  | "ET"
  | "EG"
  | "MA"
  | "TN"
  | "DZ";

type CountryItem = { code: CountryCode; name: string; flag: string };

const COUNTRIES: CountryItem[] = [
  { code: "ALL", name: "All Countries", flag: "🌍" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "AO", name: "Angola", flag: "🇦🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "BG", name: "Bulgaria", flag: "🇧🇬" },
  { code: "BI", name: "Burundi", flag: "🇧🇮" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "CD", name: "DR Congo", flag: "🇨🇩" },
  { code: "CG", name: "Congo (Brazzaville)", flag: "🇨🇬" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "CI", name: "Côte d'Ivoire", flag: "🇨🇮" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "CM", name: "Cameroon", flag: "🇨🇲" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "CZ", name: "Czechia", flag: "🇨🇿" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "DZ", name: "Algeria", flag: "🇩🇿" },
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "GH", name: "Ghana", flag: "🇬🇭" },
  { code: "GR", name: "Greece", flag: "🇬🇷" },
  { code: "HU", name: "Hungary", flag: "🇭🇺" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "IL", name: "Israel", flag: "🇮🇱" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼" },
  { code: "LK", name: "Sri Lanka", flag: "🇱🇰" },
  { code: "MA", name: "Morocco", flag: "🇲🇦" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾" },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "NP", name: "Nepal", flag: "🇳🇵" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "OM", name: "Oman", flag: "🇴🇲" },
  { code: "PE", name: "Peru", flag: "🇵🇪" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "PK", name: "Pakistan", flag: "🇵🇰" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "QA", name: "Qatar", flag: "🇶🇦" },
  { code: "RO", name: "Romania", flag: "🇷🇴" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "RW", name: "Rwanda", flag: "🇷🇼" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "SN", name: "Senegal", flag: "🇸🇳" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "TN", name: "Tunisia", flag: "🇹🇳" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦" },
  { code: "UG", name: "Uganda", flag: "🇺🇬" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "VE", name: "Venezuela", flag: "🇻🇪" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "ZM", name: "Zambia", flag: "🇿🇲" },
  { code: "ZW", name: "Zimbabwe", flag: "🇿🇼" },
];

const COUNTRIES_AZ: CountryItem[] = (() => {
  const all = COUNTRIES.find((c) => c.code === "ALL")!;
  const rest = COUNTRIES.filter((c) => c.code !== "ALL").slice();
  rest.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return [all, ...rest];
})();

const COUNTRY_CODES_SET = new Set<CountryCode>(COUNTRIES_AZ.map((c) => c.code));
const COUNTRIES_BY_CODE = new Map<CountryCode, CountryItem>(COUNTRIES.map((c) => [c.code, c]));

// mapping full country names to ISO codes (common)
const COUNTRY_NAME_TO_CODE: Record<string, CountryCode> = {
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",

  "UNITED KINGDOM": "GB",
  UK: "GB",
  "GREAT BRITAIN": "GB",

  TANZANIA: "TZ",
  "UNITED REPUBLIC OF TANZANIA": "TZ",
  "TANZANIA, UNITED REPUBLIC OF": "TZ",

  "SOUTH KOREA": "KR",
  RUSSIA: "RU",
  "RUSSIAN FEDERATION": "RU",
  CHINA: "CN",
  "PEOPLE'S REPUBLIC OF CHINA": "CN",

  UAE: "AE",
  "UNITED ARAB EMIRATES": "AE",
  "SAUDI ARABIA": "SA",

  DRC: "CD",
  "DR CONGO": "CD",
  "CONGO-KINSHASA": "CD",
  "CONGO (KINSHASA)": "CD",

  "CONGO BRAZZAVILLE": "CG",
  "CONGO-BRAZZAVILLE": "CG",
  "CONGO (BRAZZAVILLE)": "CG",
  "CONGO REPUBLIC": "CG",

  "IVORY COAST": "CI",
  "COTE D'IVOIRE": "CI",
  "CÔTE D'IVOIRE": "CI",

  KENYA: "KE",
  UGANDA: "UG",
  RWANDA: "RW",
  BURUNDI: "BI",
};

function getCountry(codeOrName: string | undefined): CountryItem {
  if (!codeOrName) return COUNTRIES_BY_CODE.get("ALL")!;
  const raw = String(codeOrName).trim();
  if (!raw) return COUNTRIES_BY_CODE.get("ALL")!;
  const upper = raw.toUpperCase();

  if (COUNTRY_CODES_SET.has(upper as CountryCode)) {
    return COUNTRIES_BY_CODE.get(upper as CountryCode) || COUNTRIES_BY_CODE.get("ALL")!;
  }

  const mapped = COUNTRY_NAME_TO_CODE[upper];
  if (mapped && COUNTRY_CODES_SET.has(mapped)) {
    return COUNTRIES_BY_CODE.get(mapped) || COUNTRIES_BY_CODE.get("ALL")!;
  }

  const byName = COUNTRIES_AZ.find((c) => c.name.toUpperCase() === upper || c.name.toUpperCase().includes(upper));
  return byName || COUNTRIES_BY_CODE.get("ALL")!;
}

function normalizeCountryCode(country: any): CountryCode {
  if (!country) return "ALL";
  const str = String(country).trim().toUpperCase();
  if (!str) return "ALL";

  if (COUNTRY_CODES_SET.has(str as CountryCode)) return str as CountryCode;

  const mapped = COUNTRY_NAME_TO_CODE[str];
  if (mapped && COUNTRY_CODES_SET.has(mapped)) return mapped;

  const found = COUNTRIES_AZ.find((c) => c.name.toUpperCase() === str || c.name.toUpperCase().includes(str));
  return found?.code || "ALL";
}

function toGenderFilter(g?: ApiProfile["gender"]): GenderFilter | null {
  if (g === "male") return "Male";
  if (g === "female") return "Female";
  return null;
}

function getFaithFilterValue(f?: ApiProfile["faithLevel"]): FaithFilter {
  if (f === "new") return "New";
  if (f === "growing") return "Growing";
  if (f === "mature") return "Mature";
  return "All";
}

function prettyGender(g?: ApiProfile["gender"]) {
  if (g === "male") return "Male";
  if (g === "female") return "Female";
  return "—";
}

function prettyFaith(f?: ApiProfile["faithLevel"]) {
  if (f === "new") return "New";
  if (f === "growing") return "Growing";
  if (f === "mature") return "Mature";
  return "—";
}

function getProfileId(profile: ApiProfile): string {
  return String((profile as any).userId || (profile as any).id || "").trim();
}

function getVerificationBadge(status?: VerificationStatus) {
  const s = status || "None";
  if (s === "Verified") return { label: "✔ Verified", style: verifiedTiny };
  if (s === "Pending") return { label: "⏳ Pending", style: pendingTiny };
  if (s === "Rejected") return { label: "✖ Rejected", style: rejectedTiny };
  return { label: "— Unlinked", style: unlinkedTiny };
}

/* =========================
   COMPONENT
   ========================= */

export default function DiscoverPage() {
  const { mode, loading: storeLoading, sentRequests, fetchDiscover, sendInterest, refreshAll, setMode } =
    useCourtshipStore();

  const [minAge, setMinAge] = useState(22);
  const [maxAge, setMaxAge] = useState(35);
  const [gender, setGender] = useState<GenderFilter>("All");
  const [faith, setFaith] = useState<FaithFilter>("All");
  const [country, setCountry] = useState<CountryCode>("ALL");

  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  const [openProfileId, setOpenProfileId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<"profile" | "details">("details");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const isBusy = loading || storeLoading;

  const fetchDiscoverRef = useRef(fetchDiscover);
  useEffect(() => {
    fetchDiscoverRef.current = fetchDiscover;
  }, [fetchDiscover]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadProfiles = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchDiscoverRef.current(mode);

      if (!mountedRef.current) return;

      if (result?.profiles && Array.isArray(result.profiles)) {
        setProfiles(result.profiles);
      } else {
        setProfiles([]);
      }
    } catch (err: any) {
      if (!mountedRef.current) return;

      const msg = err?.message || "Failed to load profiles";
      if (String(msg).includes("Failed to fetch")) {
        setError("Unable to connect to server. Check your internet and try again.");
      } else {
        setError(msg);
      }
      setProfiles([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    loadProfiles();
  }, [mode, loadProfiles]);

  useEffect(() => {
    if (!openProfileId) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenProfileId(null);
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [openProfileId]);

  useEffect(() => {
    if (!countryOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCountryOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCountryOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [countryOpen]);

  const sentMap = useMemo(() => {
    const map = new Map<string, RequestStatus>();
    const rank: Record<RequestStatus, number> = { Accepted: 3, Pending: 2, Declined: 1 };

    (sentRequests || []).forEach((req: any) => {
      const targetId = String(
        req?.profileId ||
          req?.targetUserId ||
          req?.toUserId ||
          req?.receiverId ||
          req?.senderId ||
          req?.toProfileId ||
          req?.targetProfileId ||
          req?.toId ||
          req?.fromUserId ||
          req?.fromProfileId ||
          ""
      ).trim();

      if (!targetId) return;

      const status = String(req?.status || "").trim() as RequestStatus;
      if (!["Pending", "Accepted", "Declined"].includes(status)) return;

      const existing = map.get(targetId);
      if (!existing || rank[status] > rank[existing]) map.set(targetId, status);
    });

    return map;
  }, [sentRequests]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRIES_AZ;
    return COUNTRIES_AZ.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countrySearch]);

  const filteredProfiles = useMemo(() => {
    return profiles
      .filter((p) => {
        const discoverable = (p as any)?.discoverable ?? true;
        const complete = (p as any)?.isComplete ?? true;
        if (!discoverable || !complete) return false;

        const age = p.age ?? 0;
        if (age < minAge || age > maxAge) return false;

        if (gender !== "All") {
          const pg = toGenderFilter(p.gender);
          if (!pg || pg !== gender) return false;
        }

        const pf = getFaithFilterValue(p.faithLevel);
        if (faith !== "All" && pf !== faith) return false;

        if (country !== "ALL") {
          const pc = normalizeCountryCode(p.country);
          if (pc !== country) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const da = (a.age ?? 0) - (b.age ?? 0);
        if (da !== 0) return da;
        return (a.displayName || "").localeCompare(b.displayName || "");
      });
  }, [profiles, minAge, maxAge, gender, faith, country]);

  const selectedProfile = useMemo(() => {
    if (!openProfileId) return null;
    return profiles.find((p) => getProfileId(p) === openProfileId) || null;
  }, [openProfileId, profiles]);

  const selectedCountry = useMemo(() => getCountry(country === "ALL" ? undefined : country), [country]);

  const resetFilters = useCallback(() => {
    setMinAge(22);
    setMaxAge(35);
    setGender("All");
    setFaith("All");
    setCountry("ALL");
    setCountrySearch("");
    setCountryOpen(false);
  }, []);

  const getAvatarUrl = useCallback((profile: ApiProfile) => {
    if (profile.photos?.[0]?.url) return profile.photos[0].url;
    const initial = profile.displayName?.charAt(0) || "GP";
    return `https://dummyimage.com/120x120/111/fff.png&text=${encodeURIComponent(initial)}`;
  }, []);

  const handleSendInterest = useCallback(
    async (profileId: string) => {
      if (isBusy) return;

      if (mode !== "Sender") {
        alert("⛔ You cannot send interest as RECEIVER. Switch Demo Mode to SENDER.");
        return;
      }
      if (!profileId) {
        alert("❌ Invalid profile ID.");
        return;
      }

      const status = sentMap.get(profileId);
      if (status === "Pending") return alert("⏳ Interest already sent (pending).");
      if (status === "Accepted") return alert("✅ Already matched.");
      if (status === "Declined") return alert("❌ Interest was declined previously.");

      try {
        await sendInterest(profileId);

        // keep original behavior: refresh db + reload discover list
        await refreshAll();
        await loadProfiles();

        alert("✅ Interest sent successfully!");
      } catch (err: any) {
        alert(`Failed to send interest: ${err?.message || "Unknown error"}`);
      }
    },
    [isBusy, mode, sentMap, sendInterest, refreshAll, loadProfiles]
  );

  const renderProfileCard = useCallback(
    (profile: ApiProfile) => {
      const profileId = getProfileId(profile);
      if (!profileId) return null;

      const status = sentMap.get(profileId);
      const statusLabels: Record<RequestStatus, string> = {
        Pending: "⏳ Pending",
        Accepted: "✅ Accepted",
        Declined: "❌ Declined",
      };

      const isSendDisabled = isBusy || mode !== "Sender" || status === "Pending" || status === "Accepted";

      const countryInfo = getCountry(profile.country);
      const avatarUrl = getAvatarUrl(profile);
      const verificationInfo = getVerificationBadge(profile.verificationStatus);

      const profileLink = `/dashboard/courtship/profile?id=${encodeURIComponent(profileId)}`;
      const sendText =
        status === "Pending" ? "Interest Sent" : status === "Accepted" ? "Already Matched" : "Send Interest";

      return (
        <div
          key={profileId}
          style={card}
          onClick={() => {
            setOpenProfileId(profileId);
            setOpenTab("details");
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpenProfileId(profileId);
              setOpenTab("details");
            }
          }}
          aria-label={`View details for ${profile.displayName}`}
        >
          <div style={cardRow}>
{/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt={profile.displayName || "Profile"}
              style={avatar}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "https://dummyimage.com/120x120/111/fff.png&text=GP";
              }}
            />

            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={nameLine}>
                <span style={goldText}>{profile.displayName || "Anonymous"}</span>
                <span style={{ opacity: 0.8 }}>,</span>
                <span style={goldText}>{profile.age ?? "—"}</span>

                {status ? <span style={statusTiny}>{statusLabels[status]}</span> : null}
                <span style={verificationInfo.style}>{verificationInfo.label}</span>
              </div>

              <div style={meta}>
                {prettyGender(profile.gender)} • {(profile.city || "—")}, {(profile.country || "—")} •{" "}
                <span style={{ opacity: 0.92 }}>{prettyFaith(profile.faithLevel)}</span>
                <span style={countryTiny}>
                  {countryInfo.flag} {countryInfo.name}
                </span>
                {profile.churchName ? <span style={churchTiny}>⛪ {profile.churchName}</span> : null}
              </div>

              <div style={bio}>{profile.bio || "No biography available"}</div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {(profile.languages || []).slice(0, 6).map((lang) => (
                  <span key={lang} style={chip}>
                    {lang}
                  </span>
                ))}
              </div>
            </div>

            <div style={rightCol} onClick={(e) => e.stopPropagation()}>
              <div style={pillOpt}>Golden Pure{profile.churchName ? ` • ${profile.churchName}` : ""}</div>

              <button
                style={isSendDisabled ? btnGoldDisabled : btnGold}
                disabled={isSendDisabled}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSendInterest(profileId);
                }}
              >
                {sendText}
              </button>

              <Link href={profileLink} style={btnGhost as any} onClick={(e) => e.stopPropagation()}>
                View Profile
              </Link>

              <button
                type="button"
                style={btnGhost}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenProfileId(profileId);
                  setOpenTab("details");
                }}
              >
                Quick Details
              </button>
            </div>
          </div>
        </div>
      );
    },
    [sentMap, isBusy, mode, getAvatarUrl, handleSendInterest]
  );

  return (
    <div style={pageWrap}>
      <CourtshipTabs />

      <div style={topRow}>
        <div>
          <div style={pageTitle}>Discover</div>
          <div style={pageSub}>Find someone with values, ready for marriage (Golden Pure).</div>
          <div style={{ opacity: 0.8, fontSize: 12, marginTop: 6 }}>
            Mode: <b style={goldText}>{mode}</b> • Total: <b style={goldText}>{profiles.length}</b> • Sent:{" "}
            <b style={goldText}>{sentRequests?.length || 0}</b>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            💡 Backend can send ISO codes OR full country names — we normalize automatically.
          </div>
        </div>

        <div style={modeBox}>
          <div style={modeLabel}>Demo Mode</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={mode === "Sender" ? btnGold : btnGhost} onClick={() => setMode("Sender")}>
              Sender
            </button>
            <button style={mode === "Receiver" ? btnGold : btnGhost} onClick={() => setMode("Receiver")}>
              Receiver
            </button>
          </div>

          <div style={modeHint}>
            {mode === "Sender"
              ? "✅ Sender can send interest requests."
              : "✅ Receiver can view/respond to incoming requests."}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btnGhostSmall} onClick={loadProfiles} disabled={isBusy}>
              {isBusy ? (
                <>
                  <span style={spinner} /> Loading...
                </>
              ) : (
                "Refresh"
              )}
            </button>
            <button style={btnGhostSmall} onClick={resetFilters} disabled={isBusy}>
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      <div style={panel}>
        <div style={filtersRow}>
          <div style={filterBox}>
            <div style={filterLabel}>Min Age</div>
            <div style={filterValue}>{minAge}</div>
            <input
              style={range}
              type="range"
              min={18}
              max={45}
              value={minAge}
              onChange={(e) => setMinAge(Math.min(Number(e.target.value), maxAge))}
            />
          </div>

          <div style={filterBox}>
            <div style={filterLabel}>Max Age</div>
            <div style={filterValue}>{maxAge}</div>
            <input
              style={range}
              type="range"
              min={18}
              max={45}
              value={maxAge}
              onChange={(e) => setMaxAge(Math.max(Number(e.target.value), minAge))}
            />
          </div>

          <div style={filterBox} ref={dropdownRef}>
            <div style={filterLabel}>Country</div>

            <button
              type="button"
              style={countryBtn}
              onClick={() => setCountryOpen((s) => !s)}
              aria-expanded={countryOpen}
              aria-label="Select country"
            >
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 18 }}>{selectedCountry.flag}</span>
                <span style={{ fontWeight: 950, ...goldText }}>
                  {country === "ALL" ? "All Countries" : selectedCountry.name}
                </span>
              </span>
              <span style={{ opacity: 0.75 }}>▾</span>
            </button>

            {countryOpen ? (
              <div style={countryDropdown}>
                <input
                  style={countrySearchInput}
                  placeholder="Search country..."
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  autoFocus
                  aria-label="Search country"
                />

                <div className="country-scroll-area" style={countryList} role="listbox" aria-label="Countries">
                  {filteredCountries.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      style={item.code === country ? countryItemActive : countryItem}
                      onClick={() => {
                        setCountry(item.code);
                        setCountryOpen(false);
                        setCountrySearch("");
                      }}
                      role="option"
                      aria-selected={item.code === country}
                    >
                      <span style={{ width: 26, textAlign: "center", fontSize: 16 }}>{item.flag}</span>
                      <span style={{ fontWeight: 950, ...(item.code === country ? goldText : {}) }}>{item.name}</span>
                      <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 12 }}>{item.code}</span>
                    </button>
                  ))}
                </div>

                <div style={countryHint}>✅ We normalize ISO codes + common full country names.</div>
              </div>
            ) : null}
          </div>

          <div style={filterBox}>
            <div style={filterLabel}>Faith Level</div>
            <select style={select} value={faith} onChange={(e) => setFaith(e.target.value as FaithFilter)}>
              <option value="All">All</option>
              <option value="New">New</option>
              <option value="Growing">Growing</option>
              <option value="Mature">Mature</option>
            </select>
          </div>

          <div style={filterBox}>
            <div style={filterLabel}>Gender</div>
            <select style={select} value={gender} onChange={(e) => setGender(e.target.value as GenderFilter)}>
              <option value="All">All</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </div>

          <div style={resultsBox}>
            <div style={filterLabel}>Results</div>
            <div style={resultsValue}>{filteredProfiles.length}</div>
            <button style={btnGhostSmall} onClick={resetFilters} disabled={isBusy}>
              Reset
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ ...emptyCard, borderColor: "rgba(239, 68, 68, 0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>❌</span>
              <span style={goldText}>{error}</span>
            </div>
            <button style={{ ...btnGhostSmall, marginTop: 10 }} onClick={loadProfiles} disabled={isBusy}>
              Try Again
            </button>
          </div>
        ) : null}

        {isBusy ? (
          <div style={emptyCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={spinner} />
              <span style={goldText}>Loading profiles...</span>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {!isBusy && !error && filteredProfiles.length === 0 ? (
            <div style={emptyCard}>
              No profiles match your current filters.
              <div style={{ marginTop: 10 }}>
                <button style={btnGhostSmall} onClick={resetFilters}>
                  Reset All Filters
                </button>
              </div>
            </div>
          ) : (
            filteredProfiles.map((p) => renderProfileCard(p))
          )}
        </div>

        <div style={ruleBar}>
          ✅ Golden Pure Principle: Partners don’t need to be from the same church — only one pastor’s approval is
          required for verification.
        </div>
      </div>

      {selectedProfile ? (
        <div style={modalOverlay} onClick={() => setOpenProfileId(null)}>
          <div className="modal-scroll-area" style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalTop}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 18, ...goldText }}>
                  {selectedProfile.displayName}, {selectedProfile.age ?? "—"}
                </div>
                <div style={{ opacity: 0.8, marginTop: 2 }}>
                  {prettyGender(selectedProfile.gender)} • {(selectedProfile.city || "—")},{" "}
                  {(selectedProfile.country || "—")} • {prettyFaith(selectedProfile.faithLevel)}
                  {selectedProfile.churchName ? ` • ⛪ ${selectedProfile.churchName}` : ""}
                </div>
              </div>

              <button style={btnGhost} onClick={() => setOpenProfileId(null)}>
                Close
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button style={openTab === "profile" ? btnGold : btnGhost} onClick={() => setOpenTab("profile")}>
                Profile
              </button>
              <button style={openTab === "details" ? btnGold : btnGhost} onClick={() => setOpenTab("details")}>
                Details
              </button>
            </div>

            <div style={modalContent}>
              {openTab === "profile" ? (
                <>
                  <div style={{ lineHeight: 1.5, color: "rgba(255,255,255,0.92)" }}>
                    {selectedProfile.bio || "No biography provided."}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
                    {(selectedProfile.languages || []).map((lang, i) => (
                      <span key={`${lang}-${i}`} style={chip}>
                        {lang}
                      </span>
                    ))}
                  </div>

                  <div style={modalHint}>✅ Golden Pure requires pastor verification, not church matching.</div>
                </>
              ) : (
                (() => {
                  const c = getCountry(selectedProfile.country);
                  return (
                    <>
                      <table style={detailTable}>
                        <tbody>
                          <tr>
                            <td style={detailTableTdFirst}>Age</td>
                            <td style={detailTableTd}>{selectedProfile.age ?? "—"}</td>
                          </tr>
                          <tr>
                            <td style={detailTableTdFirst}>Gender</td>
                            <td style={detailTableTd}>{prettyGender(selectedProfile.gender)}</td>
                          </tr>
                          <tr>
                            <td style={detailTableTdFirst}>Faith Level</td>
                            <td style={detailTableTd}>{prettyFaith(selectedProfile.faithLevel)}</td>
                          </tr>
                          <tr>
                            <td style={detailTableTdFirst}>Country</td>
                            <td style={detailTableTd}>
                              {c.flag} {c.name}
                            </td>
                          </tr>
                          <tr>
                            <td style={detailTableTdFirst}>City</td>
                            <td style={detailTableTd}>{selectedProfile.city || "—"}</td>
                          </tr>
                          <tr>
                            <td style={detailTableTdFirst}>Church</td>
                            <td style={detailTableTd}>{selectedProfile.churchName || "—"}</td>
                          </tr>
                          <tr>
                            <td style={detailTableTdFirst}>Verification</td>
                            <td style={detailTableTd}>{getVerificationBadge(selectedProfile.verificationStatus).label}</td>
                          </tr>
                        </tbody>
                      </table>

                      <div style={modalHint}>✅ Backend should respect discoverable & isComplete flags.</div>
                    </>
                  );
                })()
              )}
            </div>

            {mode === "Sender" ? (
              <div style={{ marginTop: 20 }}>
                {(() => {
                  const pid = getProfileId(selectedProfile);
                  const status = sentMap.get(pid);
                  const disabled = !pid || status === "Pending" || status === "Accepted" || isBusy;

                  return (
                    <button
                      style={disabled ? btnGoldDisabled : btnGold}
                      disabled={disabled}
                      onClick={() => {
                        if (!pid) return;
                        handleSendInterest(pid);
                        setOpenProfileId(null);
                      }}
                    >
                      Send Interest
                    </button>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        input[type="range"] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: rgba(212, 175, 55, 0.9);
          cursor: pointer;
          border: 2px solid rgba(255, 236, 190, 0.5);
          box-shadow: 0 0 10px rgba(212, 175, 55, 0.3);
          margin-top: -6px;
        }
        input[type="range"]::-webkit-slider-runnable-track {
          background: rgba(255, 255, 255, 0.08);
          height: 6px;
          border-radius: 3px;
        }

        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: rgba(212, 175, 55, 0.9);
          cursor: pointer;
          border: 2px solid rgba(255, 236, 190, 0.5);
          box-shadow: 0 0 10px rgba(212, 175, 55, 0.3);
        }
        input[type="range"]::-moz-range-track {
          background: rgba(255, 255, 255, 0.08);
          height: 6px;
          border-radius: 3px;
        }

        .country-scroll-area::-webkit-scrollbar,
        .modal-scroll-area::-webkit-scrollbar {
          width: 8px;
        }
        .country-scroll-area::-webkit-scrollbar-track,
        .modal-scroll-area::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        .country-scroll-area::-webkit-scrollbar-thumb,
        .modal-scroll-area::-webkit-scrollbar-thumb {
          background: rgba(212, 175, 55, 0.3);
          border-radius: 4px;
        }
        .country-scroll-area::-webkit-scrollbar-thumb:hover,
        .modal-scroll-area::-webkit-scrollbar-thumb:hover {
          background: rgba(212, 175, 55, 0.5);
        }
      `}</style>
    </div>
  );
}

/* =========================
   STYLES
   ========================= */

const pageWrap: CSSProperties = {
  width: "100%",
  maxWidth: "none",
  paddingBottom: 30,
};

const goldText: CSSProperties = { color: "rgba(255,236,190,0.98)" };

const topRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  flexWrap: "wrap",
  gap: 20,
  marginBottom: 20,
};

const pageTitle: CSSProperties = {
  fontSize: 26,
  fontWeight: 950,
  color: "rgba(255,236,190,0.98)",
  marginBottom: 6,
};

const pageSub: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.86)",
  lineHeight: 1.6,
};

const modeBox: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(700px 260px at 15% 0%, rgba(212,175,55,0.10), transparent 60%), rgba(0,0,0,0.18)",
  padding: "16px 20px",
  minWidth: 280,
  boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
};

const modeLabel: CSSProperties = {
  fontWeight: 950,
  fontSize: 14,
  marginBottom: 8,
  color: "rgba(255,236,190,0.98)",
};

const modeHint: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.86)",
  marginTop: 8,
  lineHeight: 1.4,
};

const panel: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.40)",
};

const filtersRow: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 };
const filterBox: CSSProperties = { position: "relative", minWidth: 140, flex: 1 };

const filterLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(255,255,255,0.85)",
  marginBottom: 4,
};

const filterValue: CSSProperties = {
  fontSize: 16,
  fontWeight: 950,
  color: "rgba(255,236,190,0.98)",
  marginBottom: 4,
};

const range: CSSProperties = {
  width: "100%",
  height: 6,
  borderRadius: 3,
  backgroundColor: "rgba(255,255,255,0.08)",
  outline: "none",
  cursor: "pointer",
  appearance: "none",
};

const countryBtn: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  backgroundColor: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  color: "rgba(255,255,255,0.92)",
  outline: "none",
};

const countryDropdown: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  backgroundColor: "rgba(20,20,25,0.95)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  marginTop: 4,
  zIndex: 1000,
  boxShadow: "0 16px 40px rgba(0,0,0,0.60)",
  padding: 8,
  backdropFilter: "blur(10px)",
};

const countrySearchInput: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  fontSize: 14,
  outline: "none",
  marginBottom: 8,
  backgroundColor: "rgba(0,0,0,0.25)",
  color: "rgba(255,255,255,0.92)",
};

const countryList: CSSProperties = {
  maxHeight: 240,
  overflowY: "auto",
  marginBottom: 8,
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(212,175,55,0.3) transparent",
};

const countryItem: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "none",
  backgroundColor: "transparent",
  display: "flex",
  alignItems: "center",
  gap: 12,
  cursor: "pointer",
  fontSize: 14,
  textAlign: "left",
  borderRadius: 4,
  outline: "none",
  color: "rgba(255,255,255,0.85)",
};

const countryItemActive: CSSProperties = {
  ...countryItem,
  backgroundColor: "rgba(212,175,55,0.15)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 700,
};

const countryHint: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.7)",
  padding: "4px 8px",
  backgroundColor: "rgba(0,0,0,0.25)",
  borderRadius: 4,
  textAlign: "center",
};

const select: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  backgroundColor: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  color: "rgba(255,255,255,0.92)",
  outline: "none",
  cursor: "pointer",
  appearance: "none",
};

const resultsBox: CSSProperties = {
  minWidth: 140,
  flex: 1,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
};

const resultsValue: CSSProperties = {
  fontSize: 24,
  fontWeight: 950,
  color: "rgba(255,236,190,0.98)",
  marginBottom: 8,
};

const btnGhostSmall: CSSProperties = {
  padding: "6px 12px",
  backgroundColor: "transparent",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  color: "rgba(255,255,255,0.85)",
  cursor: "pointer",
  outline: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  textDecoration: "none",
};

const btnGhost: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "transparent",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  color: "rgba(255,255,255,0.85)",
  cursor: "pointer",
  outline: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  textDecoration: "none",
  justifyContent: "center",
};

const btnGold: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "rgba(212,175,55,0.15)",
  border: "1px solid rgba(212,175,55,0.28)",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  color: "rgba(255,236,190,0.98)",
  cursor: "pointer",
  outline: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  textDecoration: "none",
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
  justifyContent: "center",
};

const btnGoldDisabled: CSSProperties = { ...btnGold, opacity: 0.5, cursor: "not-allowed" };

const card: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(520px 220px at 15% 0%, rgba(212,175,55,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  padding: 12,
  cursor: "pointer",
  transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
  boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
};

const cardRow: CSSProperties = { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" };

const avatar: CSSProperties = {
  width: 120,
  height: 120,
  borderRadius: 12,
  objectFit: "cover",
  backgroundColor: "rgba(255,255,255,0.08)",
  flexShrink: 0,
  border: "1px solid rgba(255,255,255,0.08)",
};

const nameLine: CSSProperties = {
  fontSize: 18,
  fontWeight: 950,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 6,
};

const meta: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.75)",
  marginBottom: 8,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const bio: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.86)",
  lineHeight: 1.5,
  marginBottom: 12,
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const chip: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.86)",
  padding: "4px 12px",
  borderRadius: 20,
  fontSize: 13,
  fontWeight: 500,
  display: "inline-block",
  border: "1px solid rgba(255,255,255,0.08)",
};

const rightCol: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, minWidth: 140, flexShrink: 0 };

const pillOpt: CSSProperties = {
  backgroundColor: "rgba(212,175,55,0.12)",
  color: "rgba(255,236,190,0.98)",
  padding: "6px 12px",
  borderRadius: 20,
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center",
  marginBottom: 8,
  border: "1px solid rgba(212,175,55,0.20)",
};

const statusTiny: CSSProperties = {
  backgroundColor: "rgba(59,130,246,0.15)",
  color: "rgba(191,219,254,0.95)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  border: "1px solid rgba(59,130,246,0.20)",
};

const countryTiny: CSSProperties = {
  backgroundColor: "rgba(34,197,94,0.15)",
  color: "rgba(187,247,208,0.95)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  marginLeft: 8,
  border: "1px solid rgba(34,197,94,0.20)",
};

const churchTiny: CSSProperties = {
  backgroundColor: "rgba(239,68,68,0.15)",
  color: "rgba(254,226,226,0.95)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  marginLeft: 8,
  border: "1px solid rgba(239,68,68,0.20)",
};

const verifiedTiny: CSSProperties = {
  backgroundColor: "rgba(34,197,94,0.15)",
  color: "rgba(187,247,208,0.95)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  marginLeft: 8,
  border: "1px solid rgba(34,197,94,0.20)",
};

const pendingTiny: CSSProperties = {
  backgroundColor: "rgba(212,175,55,0.15)",
  color: "rgba(255,236,190,0.95)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  marginLeft: 8,
  border: "1px solid rgba(212,175,55,0.20)",
};

const rejectedTiny: CSSProperties = {
  backgroundColor: "rgba(239,68,68,0.15)",
  color: "rgba(254,226,226,0.95)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  marginLeft: 8,
  border: "1px solid rgba(239,68,68,0.20)",
};

const unlinkedTiny: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.75)",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  display: "inline-block",
  marginLeft: 8,
  border: "1px solid rgba(255,255,255,0.12)",
};

const emptyCard: CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(700px 260px at 15% 0%, rgba(212,175,55,0.10), transparent 60%), rgba(0,0,0,0.18)",
  padding: 40,
  textAlign: "center",
  color: "rgba(255,255,255,0.86)",
  fontSize: 14,
  boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
};

const ruleBar: CSSProperties = {
  backgroundColor: "rgba(34,197,94,0.10)",
  border: "1px solid rgba(34,197,94,0.22)",
  borderRadius: 14,
  padding: "12px 16px",
  marginTop: 20,
  fontSize: 13,
  color: "rgba(187,247,208,0.95)",
  textAlign: "center",
  lineHeight: 1.6,
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
};

const modalOverlay: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
  padding: 20,
  backdropFilter: "blur(4px)",
};

const modal: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.15), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.04))",
  padding: 24,
  maxWidth: 520,
  width: "100%",
  maxHeight: "80vh",
  overflowY: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.60)",
  backdropFilter: "blur(10px)",
};

const modalTop: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 16,
};

const modalContent: CSSProperties = { marginTop: 20, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.12)" };

const modalHint: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.75)",
  backgroundColor: "rgba(0,0,0,0.25)",
  padding: "8px 12px",
  borderRadius: 6,
  marginTop: 20,
};

const detailTable: CSSProperties = { width: "100%", borderCollapse: "collapse" };

const detailTableTd: CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  fontSize: 14,
  color: "rgba(255,255,255,0.86)",
};

const detailTableTdFirst: CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  fontSize: 14,
  fontWeight: 600,
  color: "rgba(255,236,190,0.98)",
  width: "40%",
};

const spinner: CSSProperties = {
  display: "inline-block",
  width: 12,
  height: 12,
  border: "2px solid rgba(212,175,55,0.5)",
  borderTopColor: "transparent",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};
