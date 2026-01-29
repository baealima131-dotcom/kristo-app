"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Gender = "MALE" | "FEMALE";

type ChurchPick = {
  id: string;
  name: string;
  country?: string;
  city?: string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function OnboardingPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(""); // read-only display (from /me)
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<Gender>("MALE");
  const [dob, setDob] = useState("");

  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");

  const [joinChurch, setJoinChurch] = useState(false);
  const [churchQuery, setChurchQuery] = useState("");
  const [churchResults, setChurchResults] = useState<ChurchPick[]>([]);
  const [selectedChurchId, setSelectedChurchId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const mockChurches: ChurchPick[] = useMemo(
    () => [
      { id: "church_dev_default", name: "Kristo Church (Dev Default)", country: "USA", city: "Dallas" },
      { id: "church_demo_2", name: "New Hope Ministry", country: "USA", city: "Houston" },
      { id: "church_demo_3", name: "Jesus Saves Church", country: "Burundi", city: "Bujumbura" },
    ],
    []
  );

  // Load viewer + profile from VIP /me
  useEffect(() => {
    (async () => {
      setError("");
      try {
        setLoading(true);
        const resp = await fetch("/api/auth/me", { method: "GET" });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok || data?.ok === false) {
          router.replace("/sign-in?next=/onboarding");
          return;
        }

        setEmail(String(data?.viewer?.email || ""));

        const p = data?.profile || null;
        if (p) {
          // Prefill from profile draft (Sign-up enters automatically)
          setFullName(String(p.fullName || ""));
          setPhone(String(p.phone || ""));
          setGender(p.gender === "FEMALE" ? "FEMALE" : "MALE");
          setDob(String(p.dob || ""));
          setCountry(String(p.country || ""));
          setCity(String(p.city || ""));

          // Only skip onboarding if profile is Active
          if (String(p.profileStatus || "") === "Active") {
            router.replace("/dashboard");
            return;
          }
        }
      } catch (e: any) {
        router.replace("/sign-in?next=/onboarding");
        return;
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!joinChurch) {
      setChurchQuery("");
      setChurchResults([]);
      setSelectedChurchId("");
      return;
    }

    const q = churchQuery.trim().toLowerCase();
    if (!q) {
      setChurchResults([]);
      return;
    }

    const results = mockChurches.filter((c) => {
      const hay = `${c.name} ${c.city ?? ""} ${c.country ?? ""}`.toLowerCase();
      return hay.includes(q);
    });

    setChurchResults(results);
  }, [joinChurch, churchQuery, mockChurches]);

  function validate() {
    const n = fullName.trim();
    const ctry = country.trim();
    const cty = city.trim();

    if (!n) return "Tafadhali andika majina yako (Full name).";
    if (gender !== "MALE" && gender !== "FEMALE") return "Gender ni MALE au FEMALE tu.";
    if (!dob.trim()) return "Tafadhali weka DOB.";
    if (!phone.trim()) return "Tafadhali weka phone.";
    if (!ctry) return "Tafadhali andika country.";
    if (!cty) return "Tafadhali andika city.";
    if (joinChurch && !selectedChurchId) {
      return "Umechagua ku-join church — tafadhali chagua church moja kwenye list.";
    }
    return "";
  }

  async function handleSave() {
    setError("");
    const v = validate();
    if (v) return setError(v);

    try {
      setSaving(true);

      // Save VIP profile
      const resp = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          gender,
          dob: dob.trim(),
          phone: phone.trim(),
          country: country.trim(),
          city: city.trim(),
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) {
        setError(String(data?.error || "Kuna tatizo wakati wa kuhifadhi. Jaribu tena."));
        return;
      }

      // If user chose a church, send a real membership request (Pastor/Admin will approve/reject)
      if (joinChurch && selectedChurchId) {
        const r2 = await fetch("/api/church/memberships/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ churchId: selectedChurchId, name: fullName.trim() }),
        });
        const d2 = await r2.json().catch(() => ({}));
        if (!r2.ok || d2?.ok === false) {
          throw new Error(d2?.error || "Failed to send membership request");
        }
      }

      if (joinChurch && selectedChurchId) {
        router.replace("/dashboard/churches");
      } else {
        router.replace("/dashboard");
      }
    } catch (e: any) {
      setError(e?.message ?? "Kuna tatizo wakati wa kuhifadhi. Jaribu tena.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/80">
        Loading...
      </div>
    );
  }

  return (
    <div className="vip-root min-h-screen px-4 py-10 flex items-center justify-center">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <div className="w-full max-w-3xl relative">
        <div className="vip-card">
          <div className="vip-card-inner">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="vip-kicker">Kristo App</div>
                <h1 className="vip-title">Onboarding</h1>
                <p className="vip-subtitle">Jaza taarifa zako muhimu.</p>
              </div>
            </div>

            {error ? (
              <div className="vip-alert mt-6">
                <div className="vip-alert-title">Kuna tatizo</div>
                <div className="vip-alert-body">{error}</div>
              </div>
            ) : null}

            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="vip-label">Full name (Majina)</label>
                <input
                  className="vip-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Mfano: Prince Fariji"
                  autoComplete="name"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="vip-label">Email</label>
                <input className="vip-input" value={email} readOnly />
                <div className="vip-dim mt-1">Email inatoka kwenye account uliyosign-up nayo.</div>
              </div>

              <div>
                <label className="vip-label">Phone</label>
                <input
                  className="vip-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Mfano: +1 214..."
                  autoComplete="tel"
                />
              </div>

              <div>
                <label className="vip-label">Gender</label>
                <select className="vip-input" value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                  <option value="MALE">MALE</option>
                  <option value="FEMALE">FEMALE</option>
                </select>
              </div>

              <div>
                <label className="vip-label">DOB</label>
                <input
                  className="vip-input"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  type="date"
                />
              </div>

              <div>
                <label className="vip-label">Country</label>
                <input
                  className="vip-input"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Mfano: USA"
                />
              </div>

              <div>
                <label className="vip-label">City</label>
                <input
                  className="vip-input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Mfano: Dallas"
                />
              </div>

              <div className="sm:col-span-2 vip-divider" />

              <div className="sm:col-span-2">
                <label className="vip-row">
                  <input
                    type="checkbox"
                    checked={joinChurch}
                    onChange={(e) => setJoinChurch(e.target.checked)}
                  />
                  <span>Unataka ku-join church sasa?</span>
                </label>
              </div>

              {joinChurch ? (
                <div className="sm:col-span-2">
                  <label className="vip-label">Tafuta church</label>
                  <input
                    className="vip-input"
                    value={churchQuery}
                    onChange={(e) => setChurchQuery(e.target.value)}
                    placeholder="Andika jina au mji..."
                  />

                  {churchResults.length ? (
                    <div className="vip-list mt-2">
                      {churchResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={cn("vip-pick", selectedChurchId === c.id && "is-active")}
                          onClick={() => setSelectedChurchId(c.id)}
                        >
                          <div className="vip-pick-title">{c.name}</div>
                          <div className="vip-pick-sub">{c.city}, {c.country}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="vip-dim mt-2">Andika juu ili kuona list.</div>
                  )}
                </div>
              ) : null}

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={cn("vip-btn", saving && "is-loading")}
                >
                  {saving ? "Saving..." : "Save & Continue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .vip-root {
          color: rgba(255, 255, 255, 0.92);
          background: radial-gradient(1200px 600px at 20% 10%, rgba(255, 215, 130, 0.14), transparent 60%),
            radial-gradient(900px 500px at 80% 20%, rgba(255, 190, 80, 0.10), transparent 55%),
            radial-gradient(900px 700px at 60% 90%, rgba(120, 180, 255, 0.08), transparent 60%),
            linear-gradient(180deg, #07070b 0%, #0b0b12 40%, #07070b 100%);
          position: relative;
          overflow: hidden;
        }
        .vip-ambient {
          position: absolute;
          inset: -40%;
          background:
            radial-gradient(circle at 30% 20%, rgba(255, 216, 140, 0.18), transparent 35%),
            radial-gradient(circle at 70% 30%, rgba(255, 180, 80, 0.14), transparent 40%),
            radial-gradient(circle at 50% 80%, rgba(120, 200, 255, 0.10), transparent 45%);
          filter: blur(40px);
          animation: vipFloat 10s ease-in-out infinite;
          pointer-events: none;
        }
        .vip-grain {
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E");
          mix-blend-mode: overlay;
          opacity: 0.10;
          pointer-events: none;
        }
        @keyframes vipFloat {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(0, -10px, 0) scale(1.02); }
        }
        .vip-card {
          border-radius: 18px;
          padding: 16px;
          background: rgba(12, 12, 18, 0.78);
          border: 1px solid rgba(255, 220, 140, 0.14);
          box-shadow: 0 20px 80px rgba(0,0,0,0.65);
          backdrop-filter: blur(10px);
        }
        .vip-card-inner { padding: 6px; }
        .vip-kicker { font-size:12px; letter-spacing:.18em; text-transform:uppercase; color: rgba(255, 215, 130, 0.85); }
        .vip-title {
          margin-top: 8px;
          font-size: 30px;
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: -0.02em;
          background: linear-gradient(90deg, rgba(255, 240, 190, 0.95), rgba(255, 190, 80, 0.90));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .vip-subtitle { margin-top:8px; font-size:13px; color: rgba(255,255,255,0.78); }
        .vip-alert { border: 1px solid rgba(255,120,120,0.25); background: rgba(255,80,80,0.08); border-radius: 14px; padding: 12px; }
        .vip-alert-title { font-weight: 900; margin-bottom: 4px; }
        .vip-alert-body { opacity: .9; font-size: 13px; }
        .vip-label { font-size: 12px; font-weight: 900; letter-spacing: .02em; color: rgba(255,236,190,0.92); }
        .vip-input {
          width: 100%;
          border-radius: 14px;
          padding: 12px 12px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.92);
          outline: none;
        }
        .vip-btn {
          margin-top: 8px;
          width: 100%;
          border-radius: 14px;
          padding: 12px 12px;
          border: 1px solid rgba(255,215,0,0.25);
          background: linear-gradient(90deg, rgba(255,240,190,0.95), rgba(255,190,80,0.90));
          color: #09090f;
          font-weight: 900;
          cursor: pointer;
        }
        .vip-btn.is-loading { opacity: .8; cursor: progress; }
        .vip-dim { opacity: .7; font-size: 12px; }
        .vip-divider { height: 1px; background: rgba(255,255,255,0.10); margin: 8px 0; }
        .vip-row { display:flex; align-items:center; gap:10px; font-size: 13px; }
        .vip-list { display:grid; gap:10px; }
        .vip-pick {
          text-align:left;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.92);
          cursor: pointer;
        }
        .vip-pick.is-active { border-color: rgba(255,215,130,0.5); }
        .vip-pick-title { font-weight: 900; }
        .vip-pick-sub { opacity: .75; font-size: 12px; margin-top: 2px; }
      `}</style>
    </div>
  );
}
