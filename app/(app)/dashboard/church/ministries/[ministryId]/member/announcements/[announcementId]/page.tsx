"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: any };
type ApiRes<T> = ApiOk<T> | ApiErr;

type Announcement = {
  id: string;
  churchId: string;
  ministryId: string;
  title: string;
  body?: string;
  createdAt: string;
  createdByUserId?: string;
};

function fmtAgo(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function MemberAnnouncementDetailPage() {
  const router = useRouter();
  const params = useParams() as { ministryId?: string; announcementId?: string };

  const ministryId = String(params?.ministryId || "").trim();
  const announcementId = String(params?.announcementId || "").trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [item, setItem] = useState<Announcement | null>(null);

  const headerAuth = useMemo(() => {
    return {
      "content-type": "application/json",
      "x-kristo-user-id": "u-demo-3",
      "x-kristo-role": "Member",
      "x-kristo-church-id": "c-demo-1",
    } as Record<string, string>;
  }, []);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!ministryId || !announcementId) {
        setErr("Missing ministryId/announcementId in route.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr("");

      try {
        // We try to reuse existing list endpoint: GET /api/church/ministry-announcements?ministryId=...&all=1
        // Then pick the announcement by id.
        const url = `/api/church/ministry-announcements?ministryId=${encodeURIComponent(
          ministryId
        )}&all=1`;

        const r = await fetch(url, { headers: headerAuth });
        const j: ApiRes<Announcement[]> = await r
          .json()
          .catch(() => ({ ok: false, error: "Bad JSON" } as any));

        if (!alive) return;

        if (!j || j.ok !== true) {
          const msg = (j as any)?.error || `Request failed (${r.status})`;
          setErr(msg);
          setItem(null);
          setLoading(false);
          return;
        }

        const found = (j.data || []).find((a) => a.id === announcementId) || null;
        if (!found) {
          setErr("Announcement not found.");
          setItem(null);
          setLoading(false);
          return;
        }

        setItem(found);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Request failed");
        setItem(null);
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [ministryId, announcementId, headerAuth]);

  const wrap: CSSProperties = { padding: 16, maxWidth: 980, margin: "0 auto" };
  const card: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    padding: 16,
  };
  const title: CSSProperties = { fontSize: 22, fontWeight: 950, letterSpacing: -0.2, margin: 0 };
  const meta: CSSProperties = { opacity: 0.75, fontSize: 13, marginTop: 6 };
  const msg: CSSProperties = { whiteSpace: "pre-wrap", lineHeight: 1.5, marginTop: 14, opacity: 0.95 };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <button
          onClick={() => router.back()}
          style={{
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.14)",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.22)",
            color: "inherit",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          ← Back
        </button>

        <Link
          href={`/dashboard/church/ministries/${encodeURIComponent(ministryId)}/member/announcements`}
          style={{ opacity: 0.85, textDecoration: "none" }}
        >
          All announcements
        </Link>
      </div>

      {loading ? (
        <div style={{ opacity: 0.85 }}>Loading…</div>
      ) : err ? (
        <div style={{ color: "#ffb4b4" }}>{err}</div>
      ) : !item ? (
        <div style={{ opacity: 0.85 }}>No data.</div>
      ) : (
        <div style={card}>
          <h1 style={title}>{item.title || "Announcement"}</h1>
          <div style={meta}>
            <span>Posted {fmtAgo(item.createdAt)} ago</span>
            <span style={{ margin: "0 10px", opacity: 0.35 }}>|</span>
            <span>ID: {item.id}</span>
          </div>

          {item.body ? <div style={msg}>{item.body}</div> : <div style={msg}>(No body)</div>}
        </div>
      )}
    </div>
  );
}
