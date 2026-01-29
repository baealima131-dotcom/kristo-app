"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Church = {
  id: string;
  name: string;
  country: string;
  city: string;
  bio?: string;
  followersCount: number;
  pastorName?: string;
  coverImage?: string;
  logo?: string;
};

const MOCK_CHURCHES: Church[] = [
  {
    id: "church_demo_1",
    name: "Kristo Church Central",
    country: "USA",
    city: "Dallas",
    bio: "Ibada • Mafundisho • Udugu wa waamini. Karibu — tunajenga jamii ya Kristo iliyo imara.",
    followersCount: 1240,
    pastorName: "Mch. David Kalonda",
  },
  {
    id: "church_demo_2",
    name: "New Hope Ministry",
    country: "USA",
    city: "Houston",
    bio: "Hope • Healing • Prayer. Tunakaribisha watu wote wanaotafuta Yesu na uponyaji.",
    followersCount: 860,
    pastorName: "Mch. Sarah N.",
  },
  {
    id: "church_demo_3",
    name: "Jesus Saves Church",
    country: "Burundi",
    city: "Bujumbura",
    bio: "Youth • Evangelism • Worship. Ibada zetu ni za nguvu na ushuhuda.",
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

export default function ChurchProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const church = useMemo(() => {
    return MOCK_CHURCHES.find((c) => c.id === id) ?? null;
  }, [id]);

  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setFollowed(loadFollowed());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const isFollowed = !!(id && followed[id]);

  function toggleFollow() {
    if (!id) return;
    setFollowed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      saveFollowed(next);
      return next;
    });
  }

  if (!id) {
    return (
      <div className="postCard">
        <div className="postName">Invalid church id</div>
        <div className="postType">Rudi kwenye list</div>
        <div style={{ marginTop: 10 }}>
          <Link className="action" href="/churches" style={{ padding: "10px 12px" }}>
            Back →
          </Link>
        </div>
      </div>
    );
  }

  if (!church) {
    return (
      <div>
        <h1 className="pageTitle">Church</h1>
        <p className="pageSub">Haijapatikana (MVP mock)</p>

        <div className="postCard">
          <div className="postName">Church not found</div>
          <div className="postType">Hakuna church yenye ID: {id}</div>

          <div style={{ marginTop: 12 }}>
            <Link className="action" href="/churches" style={{ padding: "10px 12px" }}>
              Back to Churches →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="topline" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="pageTitle">{church.name}</h1>
          <p className="pageSub">
            {church.city}, {church.country} • {church.followersCount.toLocaleString()} followers
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={toggleFollow}
            className="pill"
            style={{
              border: "1px solid rgba(255,255,255,0.18)",
              padding: "10px 12px",
              borderRadius: 999,
              background: isFollowed ? "rgba(255,215,0,0.12)" : "transparent",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {isFollowed ? "Following ✓" : "Follow +"}
          </button>

          <Link className="action" href="/churches" style={{ padding: "10px 12px" }}>
            Back →
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="statTitle">
          <span>About</span>
          <span>⛪️</span>
        </div>
        <div className="postBody" style={{ marginTop: 10 }}>
          {church.bio ?? "No bio yet."}
        </div>
        <div className="statSub" style={{ marginTop: 10 }}>
          Pastor: <b>{church.pastorName ?? "Not set"}</b>
        </div>
      </div>

      <div className="sectionTitle">Actions</div>
      <div className="grid4" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Link href={`/church/${church.id}/join`} className="card">
          <div className="statTitle">
            <span>Request to Join</span>
            <span>✅</span>
          </div>
          <div className="statSub">Membership request (MVP)</div>
        </Link>

        <Link href={`/church/${church.id}/admin`} className="card">
          <div className="statTitle">
            <span>Admin</span>
            <span>👑</span>
          </div>
          <div className="statSub">Pastor/Admin dashboard (MVP mock)</div>
        </Link>

        {/* ✅ TUSIWEKE /events na /live kama hazipo — tuiweke placeholders safe */}
        <Link href="/dashboard" className="card">
          <div className="statTitle">
            <span>Events</span>
            <span>📅</span>
          </div>
          <div className="statSub">Coming soon</div>
        </Link>

        <Link href="/dashboard" className="card">
          <div className="statTitle">
            <span>Live</span>
            <span>🔴</span>
          </div>
          <div className="statSub">Coming soon</div>
        </Link>
      </div>

      <div className="footerNote" style={{ marginTop: 14 }}>
        MVP note: profile/follow bado ni mock + localStorage. Baadaye tutatumia DB: churches, follows, memberships + notifications.
      </div>
    </div>
  );
}
