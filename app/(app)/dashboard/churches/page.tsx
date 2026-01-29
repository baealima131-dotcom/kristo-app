"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ChurchPick = {
  id: string;
  name: string;
  country?: string;
  city?: string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ChurchesPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const churches: ChurchPick[] = useMemo(
    () => [
      { id: "church_dev_default", name: "Kristo Church (Dev Default)", country: "USA", city: "Dallas" },
      { id: "church_demo_2", name: "New Hope Ministry", country: "USA", city: "Houston" },
      { id: "church_demo_3", name: "Jesus Saves Church", country: "Burundi", city: "Bujumbura" },
    ],
    []
  );

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return churches;
    return churches.filter((c) => (`${c.name} ${c.city ?? ""} ${c.country ?? ""}`).toLowerCase().includes(s));
  }, [q, churches]);

  async function requestJoin() {
    setMsg("");
    if (!selected) return setMsg("Chagua church kwanza.");

    try {
      setBusy(true);
      const res = await fetch("/api/church/memberships/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ churchId: selected }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setMsg(data?.error || "Request haijafanikiwa. Jaribu tena.");
        return;
      }

      setMsg("Request sent ✅ Subiri pastor / admin akuthibitishe.");
    } catch (e: any) {
      setMsg(e?.message || "Kuna tatizo. Jaribu tena.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border bg-black/5 p-6 sm:p-8 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Churches</h1>
              <p className="text-sm opacity-80 mt-2">
                Tafuta kanisa kisha tuma request ya ku-join. Pastor/Admin ataku-approve au atakataa.
              </p>
            </div>

            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm hover:bg-black/5"
              onClick={() => router.replace("/dashboard")}
            >
              Back to dashboard
            </button>
          </div>

          {msg ? (
            <div className="mt-5 rounded-lg border px-4 py-3 text-sm bg-white/60">
              {msg}
            </div>
          ) : null}

          <div className="mt-6">
            <label className="text-sm font-medium">Search</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 bg-white/80"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Mfano: Dallas / Kristo / Burundi"
            />
          </div>

          <div className="mt-4 space-y-2">
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                className={cn(
                  "w-full text-left rounded-md border px-3 py-3 transition",
                  selected === c.id ? "border-black bg-black/5" : "hover:bg-black/5"
                )}
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-xs opacity-70">
                  {(c.city ?? "") + (c.country ? `, ${c.country}` : "")}
                </div>
                <div className="mt-1 text-[11px] opacity-70">churchId: {c.id}</div>
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-md px-4 py-2 text-sm font-medium text-white bg-black hover:opacity-90 disabled:opacity-60"
              onClick={requestJoin}
              disabled={busy || !selected}
            >
              {busy ? "Sending..." : "Request to join"}
            </button>
          </div>

          <p className="mt-4 text-xs opacity-70">
            MVP note: churches list bado ni mock. Baadaye tutaunganisha DB (churches table) + real search.
          </p>
        </div>
      </div>
    </div>
  );
}
