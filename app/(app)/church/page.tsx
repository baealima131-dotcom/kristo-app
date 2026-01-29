"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Church = {
  id: string;
  name: string;
  country: string;
  city: string;
  bio?: string;
  followersCount: number;
  pastorName?: string;
};

const MOCK_CHURCHES: Church[] = [
  {
    id: "church_demo_1",
    name: "Kristo Church Central",
    country: "USA",
    city: "Dallas",
    bio: "Ibada • Mafundisho • Udugu wa waamini",
    followersCount: 1240,
    pastorName: "Mch. David Kalonda",
  },
  {
    id: "church_demo_2",
    name: "New Hope Ministry",
    country: "USA",
    city: "Houston",
    bio: "Hope • Healing • Prayer",
    followersCount: 860,
    pastorName: "Mch. Sarah N.",
  },
  {
    id: "church_demo_3",
    name: "Jesus Saves Church",
    country: "Burundi",
    city: "Bujumbura",
    bio: "Youth • Evangelism • Worship",
    followersCount: 430,
    pastorName: "Mch. Jean P.",
  },
];

function loadFollowed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("kristo.followedChurches");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveFollowed(map: Record<string, boolean>) {
  try {
    localStorage.setItem("kristo.followedChurches", JSON.stringify(map));
  } catch {}
}

export default function ChurchesPage() {
  const [q, setQ] = useState("");
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setFollowed(loadFollowed());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return MOCK_CHURCHES;

    return MOCK_CHURCHES.filter((c) => {
      const hay = `${c.name} ${c.city} ${c.country} ${c.bio ?? ""} ${c.pastorName ?? ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [q]);

  function toggleFollow(churchId: string) {
    setFollowed((prev) => {
      const next = { ...prev, [churchId]: !prev[churchId] };
      if (!next[churchId]) delete next[churchId];
      saveFollowed(next);
      return next;
    });
  }

  return (
    <div>
      <div className="topline" style={{ marginBottom: 12 }}>
        <div className="brand">
          <div className="brandDot" />
          <div>
            <h1 className="pageTitle">Churches</h1>
            <p className="pageSub">Browse • Search • Follow • Join (MVP)</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Link className="action" href="/dashboard" style={{ padding: "10px 12px" }}>
            Dashboard →
          </Link>

          {/* ✅ Church hub ya user (iweke baadae) */}
          <Link className="action" href="/dashboard/church" style={{ padding: "10px 12px" }}>
            Church Home →
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="statTitle">
          <span>Search</span>
          <span>🔎</span>
        </div>
        <div className="statSub">Tafuta kwa jina, city, country, au pastor</div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mfano: Dallas, Burundi, Kristo..."
          style={{
            marginTop: 10,
            width: "100%",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent",
            borderRadius: 12,
            padding: "12px 12px",
            outline: "none",
          }}
        />
      </div>

      <div className="sectionTitle">Available Churches</div>

      <div className="postStack">
        {filtered.map((c) => {
          const isFollowed = !!followed[c.id];

          return (
            <div key={c.id} className="postCard">
              <div className="postHead" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div className="avatar" />
                  <div>
                    <div className="postName">{c.name}</div>
                    <div className="postType">
                      {c.city}, {c.country} • {c.followersCount.toLocaleString()} followers
                      {c.pastorName ? ` • ${c.pastorName}` : ""}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => toggleFollow(c.id)}
                  className="pill"
                  style={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    padding: "8px 10px",
                    borderRadius: 999,
                    background: isFollowed ? "rgba(255,215,0,0.12)" : "transparent",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {isFollowed ? "Following ✓" : "Follow +"}
                </button>
              </div>

              {c.bio && (
                <div className="postBody" style={{ marginTop: 10 }}>
                  {c.bio}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <Link className="action" href={`/church/${c.id}`} style={{ padding: "10px 12px" }}>
                  View profile →
                </Link>

                <Link className="action" href={`/church/${c.id}/join`} style={{ padding: "10px 12px", opacity: 0.9 }}>
                  Request to join →
                </Link>
              </div>

              <div className="footerNote" style={{ marginTop: 10 }}>
                MVP: follow ina-save local. Baadaye: follows table + membership requests + pastor approval.
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="postCard">
            <div className="postName">No results</div>
            <div className="postType">Jaribu keyword nyingine</div>
          </div>
        )}
      </div>
    </div>
  );
}
