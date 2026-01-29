"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ChurchPick = { id: string; name: string; country?: string; city?: string; state?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function VipChurchPickPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [me, setMe] = useState<{ country?: string; city?: string; state?: string } | null>(null);
  const [q, setQ] = useState("");

  const mockChurches: ChurchPick[] = useMemo(
    () => [
      { id: "church_dev_default", name: "Kristo Church (Dev Default)", country: "US", state: "Texas", city: "Dallas" },
      { id: "church_demo_2", name: "New Hope Ministry", country: "US", state: "Texas", city: "Houston" },
      { id: "church_demo_3", name: "Jesus Saves Church", country: "BI", state: "", city: "Bujumbura" },
    ],
    []
  );

  useEffect(() => {
    (async () => {
      setErr("");
      try {
        setLoading(true);
        const r = await fetch("/api/auth/me");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) {
          router.replace("/sign-in?next=/dashboard/vip");
          return;
        }
        const p = d?.profile || null;
        setMe(p ? { country: p.country, city: p.city, state: p.state } : null);
      } catch (e: any) {
        setErr(e?.message || "Failed to load.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const nearCity = (me?.city || "").toLowerCase();
    const nearState = (me?.state || "").toLowerCase();
    const nearCountry = (me?.country || "").toLowerCase();

    return mockChurches
      .filter((c) => {
        const hay = `${c.name} ${c.city ?? ""} ${c.state ?? ""} ${c.country ?? ""}`.toLowerCase();
        const matchQuery = !qq || hay.includes(qq);

        // "nearby" simple rule: same country + (same city OR same state)
        const cCountry = (c.country || "").toLowerCase();
        const cCity = (c.city || "").toLowerCase();
        const cState = (c.state || "").toLowerCase();

        const near =
          nearCountry && cCountry === nearCountry && ((nearCity && cCity === nearCity) || (nearState && cState === nearState));

        return matchQuery && (near || qq); // if user types query, show matches even if not near
      })
      .slice(0, 12);
  }, [q, me, mockChurches]);

  async function requestJoin(churchId: string) {
    setErr("");
    try {
      const r = await fetch("/api/church/memberships/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ churchId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) throw new Error(d?.error || "Failed to request join");
      router.replace("/dashboard/churches");
    } catch (e: any) {
      setErr(e?.message || "Failed.");
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-white/80">Loading...</div>;

  return (
    <div className="min-h-screen px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <div className="text-xs tracking-[.18em] uppercase text-[#ffd782]/90">Kristo App</div>
        <h1 className="mt-2 text-3xl font-black">Dashboard VIP</h1>
        <p className="mt-2 text-white/70 text-sm">
          Chagua kanisa la karibu (kwa sasa: city/state/country). Baadaye tutaongeza address + GPS.
        </p>

        {err ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{err}</div>
        ) : null}

        <div className="mt-6">
          <label className="text-xs font-black text-[#ffecbe]/90">Search / Select</label>
          <input
            className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-3 outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Andika jina la kanisa au mji..."
          />
          <div className="mt-2 text-xs text-white/60">
            Profile: {me?.city || "?"}, {me?.state || "?"}, {me?.country || "?"}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => requestJoin(c.id)}
              className={cn(
                "text-left rounded-xl border border-white/15 bg-white/5 p-4 hover:bg-white/10",
              )}
            >
              <div className="font-black">{c.name}</div>
              <div className="text-xs text-white/70 mt-1">{c.city}{c.state ? `, ${c.state}` : ""} • {c.country}</div>
              <div className="text-xs text-[#ffd782]/90 mt-2 font-black">Request to Join</div>
            </button>
          ))}

          {!results.length ? (
            <div className="text-sm text-white/60">Hakuna results. Jaribu ku-search tofauti.</div>
          ) : null}
        </div>

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={() => router.replace("/dashboard")}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
          >
            Skip (Dashboard)
          </button>
        </div>
      </div>
    </div>
  );
}
