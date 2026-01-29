"use client";

import Link from "next/link";
import { useMemo, useState, useCallback } from "react";

function useCourtshipStore() {
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState(() => [
    { id: "m-1", profileId: "p-1", approved: false },
    { id: "m-2", profileId: "p-2", approved: true, pastorName: "Pastor John", approvedAt: Date.now() },
  ]);
  const profiles: Record<string, any> = useMemo(() => ({
    "p-1": { id: "p-1", name: "Jane Doe", age: 28, gender: "Female", city: "Nairobi", state: "Kenya", avatarUrl: "" },
    "p-2": { id: "p-2", name: "John Smith", age: 30, gender: "Male", city: "Mombasa", state: "Kenya", avatarUrl: "" },
  }), []);

  const refreshAll = useCallback(() => {
    setLoading(true);
    setTimeout(() => setLoading(false), 300);
  }, []);

  const resetAll = useCallback(() => {
    setMatches([]);
  }, []);

  const getProfile = useCallback((id: string) => profiles[id] || null, [profiles]);

  return { matches, loading, refreshAll, resetAll, getProfile };
}

export default function MatchesPage() {
  const store = useCourtshipStore();

  const total = store.matches.length;
  const approved = store.matches.filter((m) => m.approved).length;
  const waiting = total - approved;

  const items = useMemo(() => {
    // sort: waiting first, then approved
    return [...store.matches].sort((a, b) => {
      const aw = a.approved ? 1 : 0;
      const bw = b.approved ? 1 : 0;
      return aw - bw;
    });
  }, [store.matches]);

  const shell =
    "min-h-[70vh] w-full rounded-2xl border border-yellow-500/15 bg-zinc-950/40 shadow-[0_0_0_1px_rgba(234,179,8,0.08)] p-5 md:p-6";
  const card =
    "rounded-2xl border border-yellow-500/15 bg-gradient-to-b from-zinc-950/70 to-zinc-950/30 p-5";
  const title = "text-yellow-50 text-2xl md:text-3xl font-semibold tracking-tight";
  const sub = "text-sm text-zinc-300/80";
  const pill =
    "inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-zinc-950/60 px-3 py-1 text-xs text-yellow-100";
  const btn =
    "inline-flex items-center justify-center rounded-xl border border-yellow-500/25 bg-zinc-950/60 px-4 py-2 text-sm text-yellow-50 hover:bg-zinc-900/60 active:scale-[0.99]";
  const btnGold =
    "inline-flex items-center justify-center rounded-xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-50 hover:bg-yellow-500/15 active:scale-[0.99]";
  const badgeWaiting =
    "inline-flex items-center rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-100";
  const badgeApproved =
    "inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100";

  return (
    <div className={shell + " space-y-5"}>
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className={title}>Matches</div>
          <div className={sub}>Mutual matches zitaonekana hapa (demo: interest → match).</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className={pill}>
              <span className="font-semibold">Total:</span> {total}
            </div>
            <div className={pill}>
              <span className="font-semibold">Approved:</span> {approved}
            </div>
            <div className={pill}>
              <span className="font-semibold">Waiting:</span> {waiting}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => store.refreshAll()} disabled={store.loading}>
            Refresh
          </button>

          <button className={btnGold} onClick={() => store.resetAll()} disabled={store.loading}>
            Reset All
          </button>
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className={card}>
          <div className="text-yellow-50 font-semibold text-lg">No matches yet</div>
          <div className={sub + " mt-1"}>
            Nenda kwenye <b>Discover</b> utume interest, kisha Receiver a-accept ili match iundwe.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard/courtship/discover" className={btnGold}>
              Go to Discover
            </Link>
            <Link href="/dashboard/courtship/requests" className={btn}>
              Go to Requests
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((m) => {
            const p = store.getProfile(m.profileId);
            const status = m.approved ? "Approved" : "Waiting Pastor";

            return (
              <div key={m.id} className={card}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  {/* Left: profile */}
                  <div className="flex items-start gap-4">
                    <div className="h-14 w-14 rounded-2xl overflow-hidden border border-yellow-500/15 bg-zinc-950/50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p?.avatarUrl || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop"}
                        alt={p?.name || m.profileId}
                        className="h-full w-full object-cover"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-yellow-50 font-semibold">
                        {m.id} <span className="text-zinc-400 font-normal">(profile: {m.profileId})</span>
                      </div>

                      <div className="text-yellow-50">
                        {p ? (
                          <>
                            <span className="font-semibold">{p.name}</span>, {p.age}
                          </>
                        ) : (
                          <span className="text-zinc-300/80">Profile not found</span>
                        )}
                      </div>

                      <div className={sub}>
                        {p ? (
                          <>
                            {p.gender} • {p.city}, {p.state}
                          </>
                        ) : (
                          "—"
                        )}
                      </div>

                      <div className="mt-2">
                        {m.approved ? <span className={badgeApproved}>✅ Approved</span> : <span className={badgeWaiting}>⏳ Waiting Pastor</span>}
                      </div>

                      {m.approved && m.pastorName ? (
                        <div className="text-xs text-zinc-400 mt-1">
                          Approved by <span className="text-yellow-100">{m.pastorName}</span>
                          {m.approvedAt ? ` • ${new Date(m.approvedAt).toLocaleString()}` : ""}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {/* ✅ IMPORTANT: include matchId */}
                    <Link href={`/dashboard/courtship/couple?matchId=${m.id}`} className={btnGold}>
                      Open Couple Dashboard
                    </Link>

                    <Link href={`/dashboard/courtship/pastor?matchId=${m.id}`} className={btn}>
                      Pastor Approval
                    </Link>
                  </div>
                </div>

                {/* Status line */}
                <div className="mt-4 rounded-xl border border-yellow-500/10 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-300/80">
                  Status: <span className="text-yellow-100">{status}</span>
                  {!m.approved ? (
                    <span className="ml-2 text-zinc-400">
                      • Complete steps 1–3 then pastor approves
                    </span>
                  ) : (
                    <span className="ml-2 text-zinc-400">• Engagement Mode ready</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
