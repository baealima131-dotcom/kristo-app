"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

import { getCountries, getCountryCallingCode } from "libphonenumber-js";

isoCountries.registerLocale(enLocale);

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type Gender = "MALE" | "FEMALE";

function flagEmoji(iso2: string) {
  const code = iso2.toUpperCase();
  if (code.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  const first = code.charCodeAt(0) - 65 + A;
  const second = code.charCodeAt(1) - 65 + A;
  return String.fromCodePoint(first, second);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function makeUserCode() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return `KA-${s}`;
}

export default function Page() {
  const router = useRouter();

  // account creds
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  // profile fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<Gender>("MALE");

  // UserID Number (app code)
  const [userCode, setUserCode] = useState<string>("");

  // DOB setup
  const now = new Date();
  const currentYear = now.getFullYear();
  const maxYear = currentYear - 13;
  const minYear = 1950;

  const [dobYear, setDobYear] = useState<number | "">("");
  const [dobMonth, setDobMonth] = useState<number | "">("");
  const [dobDay, setDobDay] = useState<number | "">("");

  const dob = useMemo(() => {
    if (!dobYear || !dobMonth || !dobDay) return "";
    return `${dobYear}-${pad2(dobMonth)}-${pad2(dobDay)}`;
  }, [dobYear, dobMonth, dobDay]);

  const months = useMemo(
    () => [
      { v: 1, n: "Jan" },
      { v: 2, n: "Feb" },
      { v: 3, n: "Mar" },
      { v: 4, n: "Apr" },
      { v: 5, n: "May" },
      { v: 6, n: "Jun" },
      { v: 7, n: "Jul" },
      { v: 8, n: "Aug" },
      { v: 9, n: "Sep" },
      { v: 10, n: "Oct" },
      { v: 11, n: "Nov" },
      { v: 12, n: "Dec" },
    ],
    []
  );

  const dobMaxDay = useMemo(() => {
    if (!dobYear || !dobMonth) return 31;
    return daysInMonth(dobYear as number, dobMonth as number);
  }, [dobYear, dobMonth]);

  const days = useMemo(() => {
    const d = dobMaxDay || 31;
    return Array.from({ length: d }, (_, i) => i + 1);
  }, [dobMaxDay]);

  useEffect(() => {
    if (!dobDay) return;
    if (dobDay > dobMaxDay) setDobDay(dobMaxDay);
  }, [dobMaxDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const years = useMemo(() => {
    const xs: number[] = [];
    for (let y = maxYear; y >= minYear; y--) xs.push(y);
    return xs;
  }, [maxYear]);

  // DOB pickers (Month/Day/Year) — all as popovers
  const [monthOpen, setMonthOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);

  const [monthQuery, setMonthQuery] = useState("");
  const [dayQuery, setDayQuery] = useState("");
  const [yearQuery, setYearQuery] = useState("");

  const monthWrapRef = useRef<HTMLDivElement | null>(null);
  const dayWrapRef = useRef<HTMLDivElement | null>(null);
  const yearWrapRef = useRef<HTMLDivElement | null>(null);

  const filteredMonths = useMemo(() => {
    const q = monthQuery.trim().toLowerCase();
    if (!q) return months;
    return months.filter((m) => m.n.toLowerCase().includes(q) || String(m.v).includes(q));
  }, [months, monthQuery]);

  const filteredDays = useMemo(() => {
    const q = dayQuery.trim();
    if (!q) return days;
    return days.filter((d) => String(d).includes(q));
  }, [days, dayQuery]);

  const filteredYears = useMemo(() => {
    const q = yearQuery.trim();
    if (!q) return years;
    return years.filter((y) => String(y).includes(q));
  }, [years, yearQuery]);

  const selectedMonthLabel = useMemo(() => {
    if (!dobMonth) return "Month";
    return months.find((m) => m.v === dobMonth)?.n || "Month";
  }, [dobMonth, months]);

  // country
  const [countryIso, setCountryIso] = useState("US");
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const countryWrapRef = useRef<HTMLDivElement | null>(null);

  const [stateOrCity, setStateOrCity] = useState("");
  const [city, setCity] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");

  // join church (VIP card)
  const [joinChurch, setJoinChurch] = useState(false);
  const [churchId, setChurchId] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // ✅ Fix hydration: generate/load userCode on client only
  useEffect(() => {
    try {
      const existing = localStorage.getItem("kristo_user_code") || "";
      if (existing) {
        setUserCode(existing);
        return;
      }
      const fresh = makeUserCode();
      localStorage.setItem("kristo_user_code", fresh);
      setUserCode(fresh);
    } catch {
      setUserCode(makeUserCode());
    }
  }, []);

  const countries = useMemo(() => {
    const codes = getCountries();
    return codes
      .map((c) => ({
        iso2: c,
        name: String(isoCountries.getName(c, "en") || c),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }, []);

  const selectedCountry = useMemo(() => {
    const hit = countries.find((c) => c.iso2 === countryIso);
    return hit || { iso2: countryIso, name: countryIso };
  }, [countries, countryIso]);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => {
      const name = String(c.name || "").toLowerCase();
      return c.iso2.toLowerCase().includes(q) || name.includes(q);
    });
  }, [countries, countryQuery]);

  const dialCode = useMemo(() => {
    try {
      return "+" + getCountryCallingCode(countryIso as any);
    } catch {
      return "+";
    }
  }, [countryIso]);

  // close any open popover on outside click + ESC
  useEffect(() => {
    if (!countryOpen && !monthOpen && !dayOpen && !yearOpen) return;

    function closeAll() {
      if (countryOpen) {
        setCountryOpen(false);
        setCountryQuery("");
      }
      if (monthOpen) {
        setMonthOpen(false);
        setMonthQuery("");
      }
      if (dayOpen) {
        setDayOpen(false);
        setDayQuery("");
      }
      if (yearOpen) {
        setYearOpen(false);
        setYearQuery("");
      }
    }

    function onPointerDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node | null;
      if (!t) return;

      const inCountry = countryWrapRef.current?.contains(t) ?? false;
      const inMonth = monthWrapRef.current?.contains(t) ?? false;
      const inDay = dayWrapRef.current?.contains(t) ?? false;
      const inYear = yearWrapRef.current?.contains(t) ?? false;

      if (!inCountry && !inMonth && !inDay && !inYear) closeAll();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAll();
    }

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [countryOpen, monthOpen, dayOpen, yearOpen]);

  function validate() {
    if (!userCode) return "Subiri kidogo (UserID inajiandaa).";
    if (!userCode) return "Subiri kidogo... UserID inatengenezwa.";
    if (!firstName.trim()) return "Andika First name.";
    if (!lastName.trim()) return "Andika Last name.";
    if (!dob.trim()) return "Weka DOB (month/day/year).";
    if (!countryIso) return "Chagua country.";
    if (!city.trim()) return "Andika city.";
    if (!phoneLocal.trim()) return "Weka phone number.";
    if (!email.trim()) return "Weka email.";
    if (!password || password.length < 8) return "Password iwe angalau characters 8.";
    if (password !== password2) return "Password hazifanani. Hakiki tena.";
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");

    const v = validate();
    if (v) return setErr(v);

    try {
      setSaving(true);

      const r1 = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), phone: `${dialCode}${phoneLocal.trim()}`, password }),
      });
      const d1 = await r1.json().catch(() => ({}));
      if (!r1.ok || d1?.ok === false) {
        setErr(String(d1?.error || "Imeshindikana ku-sign up. Jaribu tena."));
        return;
      }

      try {
        if (userCode) localStorage.setItem("kristo_user_code", userCode);
        if (joinChurch) localStorage.setItem("kristo_join_intent", "1");
        else localStorage.removeItem("kristo_join_intent");

        const cid = churchId.trim();
        if (joinChurch && cid) localStorage.setItem("kristo_join_church_id", cid);
        else localStorage.removeItem("kristo_join_church_id");
      } catch {}

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const r2 = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName,
          gender,
          dob: dob.trim(),
          phone: `${dialCode}${phoneLocal.trim()}`,
          country: countryIso,
          city: city.trim(),
          state: stateOrCity.trim(),
          userCode,
        }),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok || d2?.ok === false) {
        setErr(String(d2?.error || "Kuna tatizo wakati wa kuhifadhi profile. Jaribu tena."));
        return;
      }

      // keep your existing flow: joinChurch -> /dashboard/vip
      if (joinChurch) router.replace("/dashboard/vip");
      else router.replace("/dashboard");
    } catch (e: any) {
      setErr(e?.message || "Imeshindikana ku-sign up. Jaribu tena.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="vip-auth">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <div className="vip-wrap">
        <div className="vip-head vip-head-spaced">
          <div>
            <div className="vip-kicker">Kristo App</div>
            <h1 className="vip-title">Create your account</h1>
            <p className="vip-subtitle">Karibu. Then: Onboarding (profile).</p>
          </div>

          <Link className="vip-link" href="/sign-in">
            Already have an account? <span>Sign in</span>
          </Link>
        </div>

        <div className="vip-card vip-card-spaced">
          {err ? (
            <div className="vip-alert">
              <div className="vip-alert-title">Kuna tatizo</div>
              <div className="vip-alert-body">{err}</div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="vip-form">
            <div className="vip-section">
              <div className="vip-section-title">Personal</div>

              <div className="vip-grid2">
                <div>
                  <label className="vip-label">First name</label>
                  <input className="vip-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="vip-label">Last name</label>
                  <input className="vip-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>

              <div className="vip-grid2">
                <div>
                  <label className="vip-label">DOB</label>

                  <div className="vip-dob">
                    {/* MONTH */}
                    <div ref={monthWrapRef} className="vip-pick-wrap">
                      <button
                        type="button"
                        className={cn("vip-pick-btn", monthOpen && "is-open")}
                        onClick={() => {
                          setDayOpen(false);
                          setYearOpen(false);
                          setMonthOpen((v) => !v);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={monthOpen}
                      >
                        <span className="vip-pick-label">{selectedMonthLabel}</span>
                        <span className="vip-caret">▾</span>
                      </button>

                      {monthOpen ? (
                        <div className="vip-pick-pop" role="dialog" aria-label="Choose month">
                          <div className="vip-pick-search">
                            <input
                              className="vip-input vip-pick-search-input"
                              value={monthQuery}
                              onChange={(e) => setMonthQuery(e.target.value)}
                              placeholder="Search month…"
                              autoFocus
                            />
                          </div>

                          <div className="vip-pick-list" role="listbox" aria-label="Months">
                            {filteredMonths.map((m) => (
                              <button
                                key={m.v}
                                type="button"
                                className={cn("vip-pick-item", m.v === dobMonth && "is-active")}
                                onClick={() => {
                                  setDobMonth(m.v);
                                  setMonthOpen(false);
                                  setMonthQuery("");
                                }}
                                role="option"
                                aria-selected={m.v === dobMonth}
                              >
                                <span>{m.n}</span>
                                {m.v === dobMonth ? <span className="vip-check">✓</span> : null}
                              </button>
                            ))}
                            {filteredMonths.length === 0 ? <div className="vip-pick-empty">No results</div> : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* DAY */}
                    <div ref={dayWrapRef} className="vip-pick-wrap">
                      <button
                        type="button"
                        className={cn("vip-pick-btn", dayOpen && "is-open")}
                        onClick={() => {
                          setMonthOpen(false);
                          setYearOpen(false);
                          setDayOpen((v) => !v);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={dayOpen}
                      >
                        <span className="vip-pick-label">{dobDay ? String(dobDay) : "Day"}</span>
                        <span className="vip-caret">▾</span>
                      </button>

                      {dayOpen ? (
                        <div className="vip-pick-pop" role="dialog" aria-label="Choose day">
                          <div className="vip-pick-search">
                            <input
                              className="vip-input vip-pick-search-input"
                              value={dayQuery}
                              onChange={(e) => setDayQuery(e.target.value)}
                              placeholder="Search day… (e.g. 14)"
                              autoFocus
                              inputMode="numeric"
                            />
                          </div>

                          <div className="vip-pick-list" role="listbox" aria-label="Days">
                            {filteredDays.map((d) => (
                              <button
                                key={d}
                                type="button"
                                className={cn("vip-pick-item", d === dobDay && "is-active")}
                                onClick={() => {
                                  setDobDay(d);
                                  setDayOpen(false);
                                  setDayQuery("");
                                }}
                                role="option"
                                aria-selected={d === dobDay}
                              >
                                <span>{d}</span>
                                {d === dobDay ? <span className="vip-check">✓</span> : null}
                              </button>
                            ))}
                            {filteredDays.length === 0 ? <div className="vip-pick-empty">No results</div> : null}
                          </div>

                          <div className="vip-pick-note">
                            {dobMonth && dobYear ? `Siku za mwezi huu: 1–${dobMaxDay}` : "Tip: Month+Year zikiwepo, Feb 28/29 itakuwa sahihi."}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* YEAR */}
                    <div ref={yearWrapRef} className="vip-pick-wrap">
                      <button
                        type="button"
                        className={cn("vip-pick-btn", yearOpen && "is-open")}
                        onClick={() => {
                          setMonthOpen(false);
                          setDayOpen(false);
                          setYearOpen((v) => !v);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={yearOpen}
                      >
                        <span className="vip-pick-label">{dobYear ? String(dobYear) : "Year"}</span>
                        <span className="vip-caret">▾</span>
                      </button>

                      {yearOpen ? (
                        <div className="vip-pick-pop" role="dialog" aria-label="Choose year">
                          <div className="vip-pick-search">
                            <input
                              className="vip-input vip-pick-search-input"
                              value={yearQuery}
                              onChange={(e) => setYearQuery(e.target.value)}
                              placeholder="Search year… (e.g. 1998)"
                              autoFocus
                              inputMode="numeric"
                            />
                          </div>

                          <div className="vip-pick-list" role="listbox" aria-label="Years">
                            {filteredYears.map((y) => (
                              <button
                                key={y}
                                type="button"
                                className={cn("vip-pick-item", y === dobYear && "is-active")}
                                onClick={() => {
                                  setDobYear(y);
                                  setYearOpen(false);
                                  setYearQuery("");
                                }}
                                role="option"
                                aria-selected={y === dobYear}
                              >
                                <span>{y}</span>
                                {y === dobYear ? <span className="vip-check">✓</span> : null}
                              </button>
                            ))}
                            {filteredYears.length === 0 ? <div className="vip-pick-empty">No results</div> : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="vip-hint">Unaweza kuanza na Day/Month/Year yoyote.</div>
                </div>

                {/* ✅ Gender (no overflow) */}
                <div className="vip-field">
                  <label className="vip-label">Gender</label>

                  <div className="vip-gender" role="group" aria-label="Gender">
                    <button
                      type="button"
                      className={cn("vip-gender-btn", gender === "MALE" && "is-active")}
                      onClick={() => setGender("MALE")}
                      aria-pressed={gender === "MALE"}
                    >
                      MALE
                    </button>
                    <button
                      type="button"
                      className={cn("vip-gender-btn", gender === "FEMALE" && "is-active")}
                      onClick={() => setGender("FEMALE")}
                      aria-pressed={gender === "FEMALE"}
                    >
                      FEMALE
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="vip-divider" />

            <div className="vip-section">
              <div className="vip-section-title">Location</div>

              <label className="vip-label">Country</label>

              <div ref={countryWrapRef} className="vip-country-wrap">
                <button
                  type="button"
                  className={cn("vip-country-btn", countryOpen && "is-open")}
                  onClick={() => setCountryOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={countryOpen}
                >
                  <span className="vip-country-left">
                    <span className="vip-flag">{flagEmoji(selectedCountry.iso2)}</span>
                    <span className="vip-country-name">{selectedCountry.name}</span>
                  </span>
                  <span className="vip-caret">▾</span>
                </button>

                {countryOpen ? (
                  <div className="vip-country-pop" role="dialog" aria-label="Choose country">
                    <div className="vip-country-search">
                      <input
                        className="vip-input vip-country-search-input"
                        value={countryQuery}
                        onChange={(e) => setCountryQuery(e.target.value)}
                        placeholder="Type to search… (e.g. canada, tanzania)"
                        autoFocus
                      />
                    </div>

                    <div className="vip-country-list" role="listbox" aria-label="Countries">
                      {filteredCountries.map((c) => (
                        <button
                          key={c.iso2}
                          type="button"
                          className={cn("vip-country-item", c.iso2 === countryIso && "is-active")}
                          onClick={() => {
                            setCountryIso(c.iso2);
                            setCountryOpen(false);
                            setCountryQuery("");
                          }}
                          role="option"
                          aria-selected={c.iso2 === countryIso}
                        >
                          <span className="vip-country-item-left">
                            <span className="vip-flag">{flagEmoji(c.iso2)}</span>
                            <span className="vip-country-name">{c.name}</span>
                          </span>
                          {c.iso2 === countryIso ? <span className="vip-check">✓</span> : null}
                        </button>
                      ))}

                      {filteredCountries.length === 0 ? <div className="vip-country-empty">No results</div> : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="vip-grid2">
                <div>
                  <label className="vip-label">State (optional)</label>
                  <input className="vip-input" value={stateOrCity} onChange={(e) => setStateOrCity(e.target.value)} placeholder="Mfano: Texas" />
                </div>
                <div>
                  <label className="vip-label">City</label>
                  <input className="vip-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mfano: Dallas" />
                </div>
              </div>

              <label className="vip-label">Phone number</label>
              <div className="vip-phone">
                <div className="vip-code">{dialCode}</div>
                <input
                  className="vip-input vip-phone-input"
                  value={phoneLocal}
                  onChange={(e) => setPhoneLocal(String(e.target.value || "").replace(/[^0-9]/g, "").slice(0, 15))}
                  placeholder="2148741432"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </div>
              <div className="vip-phone-note">Code ya nchi iko tayari: <b>{dialCode}</b>. Andika namba tu (mfano: 2148741432).</div>
            </div>

            <div className="vip-divider" />

            <div className="vip-section">
              <div className="vip-section-title">Account</div>

              <div className="vip-usercode">
                <div className="vip-usercode-label">Your UserID</div>
                <div className="vip-usercode-code">{userCode || "..."}</div>
              </div>

              <label className="vip-label">Email</label>
              <input className="vip-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email" />

              <label className="vip-label mt">Password</label>
              <div className="vip-password">
                <input
                  className="vip-input vip-password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  type={showPw1 ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button type="button" className="vip-eye" onClick={() => setShowPw1((v) => !v)} aria-label={showPw1 ? "Hide password" : "Show password"}>
                  {showPw1 ? "🙈" : "👁️"}
                </button>
              </div>

              <label className="vip-label mt">Confirm password</label>
              <div className="vip-password">
                <input
                  className="vip-input vip-password-input"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Re-type password"
                  type={showPw2 ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button type="button" className="vip-eye" onClick={() => setShowPw2((v) => !v)} aria-label={showPw2 ? "Hide password" : "Show password"}>
                  {showPw2 ? "🙈" : "👁️"}
                </button>
              </div>

              {/* ✅ VIP Join card (short, clean) */}
              <div className="vip-join-card">
                <label className="vip-join-head">
                  <input
                    type="checkbox"
                    checked={joinChurch}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setJoinChurch(on);
                      if (!on) setChurchId("");
                    }}
                  />
                  <span>Join a church</span>
                </label>

                {joinChurch ? (
                  <div className="vip-join-body">
                    <label className="vip-label">ChurchID (optional)</label>
                    <input
                      className="vip-input"
                      value={churchId}
                      onChange={(e) => setChurchId(e.target.value.toUpperCase())}
                      placeholder="CH-ABCD12"
                      autoCapitalize="characters"
                    />
                    <div className="vip-join-note">Uki-skip: uta-join Dashboard.</div>
                  </div>
                ) : null}
              </div>
            </div>

            <button className={cn("vip-btn", saving && "is-loading")} disabled={saving}>
              {saving ? "Signing up..." : "Sign up"}
            </button>

            <div className="vip-foot">
              <Link className="vip-soft" href="/">
                ← Back home
              </Link>
              <span className="vip-dim">Then: Onboarding (profile)</span>
            </div>
          </form>
        </div>
      </div>

      <style jsx global>{`
        /* hard safety: prevent overflow */
        .vip-card,
        .vip-form,
        .vip-section,
        .vip-grid2,
        .vip-dob,
        .vip-field,
        .vip-input,
        .vip-select,
        .vip-country-btn,
        .vip-pick-btn,
        .vip-usercode {
          box-sizing: border-box;
          max-width: 100%;
          min-width: 0;
        }

        /* spacing so titles + card do not “banane” */
        .vip-head-spaced {
          margin-bottom: 14px;
        }
        .vip-card-spaced {
          margin-top: 6px;
        }

        .vip-grid2 {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 12px;
        }
        @media (max-width: 640px) {
          .vip-grid2 {
            grid-template-columns: 1fr;
          }
        }

        .vip-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 10px 0;
        }

        .vip-section {
          display: grid;
          gap: 12px;
          padding: 2px 0;
        }

        .vip-section-title {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(255, 215, 130, 0.82);
          opacity: 0.95;
          margin-bottom: 6px;
          line-height: 1.35;
        }

        .vip-label {
          display: block;
          line-height: 1.25;
        }

        .vip-card {
          overflow: visible;
        }

        .vip-input {
          width: 100%;
          display: block;
          min-width: 0;
        }

        /* DOB */
        .vip-dob {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
          gap: 12px;
          align-items: start;
        }
        @media (max-width: 640px) {
          .vip-dob {
            grid-template-columns: 1fr;
          }
        }
        .vip-hint {
          font-size: 12px;
          opacity: 0.72;
          margin-top: 6px;
          line-height: 1.25;
        }

        /* picker */
        .vip-pick-wrap {
          position: relative;
          min-width: 0;
        }
        .vip-pick-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-radius: 14px;
          padding: 12px 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
          min-height: 46px;
        }
        .vip-pick-label {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          padding-right: 6px;
        }
        .vip-caret {
          flex: 0 0 auto;
          opacity: 0.85;
          font-weight: 900;
        }
        .vip-pick-pop {
          position: absolute;
          z-index: 80;
          left: 0;
          right: 0;
          margin-top: 8px;
          border-radius: 16px;
          border: 1px solid rgba(255, 220, 140, 0.18);
          background: rgba(10, 10, 16, 0.96);
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(12px);
          overflow: hidden;
        }
        .vip-pick-search {
          padding: 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .vip-pick-search-input {
          background: rgba(255, 255, 255, 0.08);
        }
        .vip-pick-list {
          max-height: 240px;
          overflow: auto;
          padding: 6px;
        }
        .vip-pick-item {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 10px;
          border-radius: 12px;
          border: 1px solid transparent;
          background: transparent;
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
        }
        .vip-pick-item.is-active {
          background: rgba(255, 215, 130, 0.12);
          border-color: rgba(255, 215, 130, 0.2);
        }
        .vip-pick-empty {
          padding: 14px;
          opacity: 0.75;
          font-size: 13px;
          text-align: center;
        }
        .vip-check {
          font-weight: 900;
          color: rgba(255, 215, 130, 0.95);
        }
        .vip-pick-note {
          padding: 10px 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 12px;
          opacity: 0.72;
          line-height: 1.2;
        }

        /* phone */
        .vip-phone {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
        }
        .vip-code {
          border-radius: 14px;
          padding: 12px 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.92);
          min-width: 90px;
          text-align: center;
          font-weight: 900;
          flex: 0 0 auto;
        }
        .vip-phone-input {
          flex: 1;
          min-width: 0;
        }

        .vip-phone-note {
          margin-top: 8px;
          font-size: 12px;
          opacity: 0.72;
          line-height: 1.25;
        }

        /* user code */
        .vip-usercode {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 10px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.14);
          min-width: 0;
        }
        .vip-usercode-label {
          font-size: 12px;
          opacity: 0.72;
          letter-spacing: 0.02em;
          font-weight: 900;
        }
        .vip-usercode-code {
          font-weight: 900;
          letter-spacing: 0.08em;
          color: rgba(255, 215, 130, 0.95);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* password */
        .vip-password {
          position: relative;
        }
        .vip-password-input {
          padding-right: 44px;
        }
        .vip-eye {
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(0, 0, 0, 0.2);
          color: rgba(255, 255, 255, 0.92);
          border-radius: 12px;
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        /* country */
        .vip-country-wrap {
          position: relative;
          min-width: 0;
        }
        .vip-country-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-radius: 14px;
          padding: 12px 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
          min-height: 46px;
          min-width: 0;
        }
        .vip-country-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .vip-flag {
          width: 22px;
          display: inline-flex;
          justify-content: center;
          flex: 0 0 auto;
        }
        .vip-country-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .vip-country-pop {
          position: absolute;
          z-index: 50;
          left: 0;
          right: 0;
          margin-top: 8px;
          border-radius: 16px;
          border: 1px solid rgba(255, 220, 140, 0.18);
          background: rgba(10, 10, 16, 0.96);
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(12px);
          overflow: hidden;
        }
        .vip-country-search {
          padding: 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .vip-country-search-input {
          background: rgba(255, 255, 255, 0.08);
        }
        .vip-country-list {
          max-height: 260px;
          overflow: auto;
          padding: 6px;
        }
        .vip-country-item {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 10px;
          border-radius: 12px;
          border: 1px solid transparent;
          background: transparent;
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
          min-width: 0;
        }
        .vip-country-item-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .vip-country-item.is-active {
          background: rgba(255, 215, 130, 0.12);
          border-color: rgba(255, 215, 130, 0.2);
        }
        .vip-country-empty {
          padding: 14px;
          opacity: 0.75;
          font-size: 13px;
          text-align: center;
        }

        /* ✅ gender segmented buttons */
        .vip-gender {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
          width: 100%;
          min-width: 0;
        }
        .vip-gender-btn {
          width: 100%;
          border-radius: 14px;
          padding: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.85);
          font-weight: 800;
          letter-spacing: 0.02em;
          cursor: pointer;
          min-height: 46px;
        }
        .vip-gender-btn.is-active {
          background: rgba(255, 215, 130, 0.18);
          border-color: rgba(255, 215, 130, 0.45);
          color: rgba(255, 215, 130, 0.95);
        }

        /* ✅ join church VIP card */
        .vip-join-card {
          margin-top: 6px;
          padding: 12px;
          border-radius: 16px;
          border: 1px dashed rgba(255, 215, 130, 0.35);
          background: rgba(255, 215, 130, 0.06);
        }
        .vip-join-head {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 900;
          cursor: pointer;
          user-select: none;
        }
        .vip-join-head input {
          transform: scale(1.1);
        }
        .vip-join-body {
          margin-top: 10px;
          display: grid;
          gap: 8px;
        }
        .vip-join-note {
          font-size: 12px;
          opacity: 0.75;
          line-height: 1.2;
        }
      

        /* === Overflow safety (prevents inputs spilling outside card) === */
        .vip-grid2 > div,
        .vip-dob > div,
        .vip-field { min-width: 0; }

        .vip-input,
        .vip-select { width: 100%; max-width: 100%; display: block; }

        /* === Gender (VIP toggle) === */
        .vip-gender{
          display: grid;
          grid-template-columns: minmax(0,1fr) minmax(0,1fr);
          gap: 10px;
          min-width: 0;
        }
        .vip-gender-btn{
          width: 100%;
          min-width: 0;
          border-radius: 14px;
          padding: 12px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.86);
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: transform .12s ease, background .12s ease, border-color .12s ease;
        }
        .vip-gender-btn:active{ transform: scale(0.99); }
        .vip-gender-btn.is-active{
          background: rgba(255,215,130,0.18);
          border-color: rgba(255,215,130,0.45);
          color: rgba(255,215,130,0.98);
        }

        /* === Join church (VIP small card) === */
        .vip-join-card{
          margin-top: 10px;
          padding: 14px;
          border-radius: 16px;
          border: 1px dashed rgba(255,215,130,0.35);
          background: rgba(255,215,130,0.06);
          min-width: 0;
        }
        .vip-join-head{
          display:flex;
          align-items:center;
          gap: 10px;
          font-weight: 900;
          min-width: 0;
        }
        .vip-join-head input{ transform: scale(1.05); }
        .vip-join-body{
          margin-top: 10px;
          display: grid;
          gap: 8px;
          min-width: 0;
        }
        .vip-join-note{
          font-size: 12px;
          opacity: 0.72;
          line-height: 1.25;
        }
`}</style>
    </main>
  );
}
