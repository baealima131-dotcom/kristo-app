"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMeChurch } from "../_components/useMeChurch";

const DEV_USER_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_USER_ID || "";
const DEV_ROLE = process.env.NEXT_PUBLIC_KRISTO_DEV_ROLE || "";
const DEV_CHURCH_ID = process.env.NEXT_PUBLIC_KRISTO_DEV_CHURCH_ID || "";

type OverviewData = {
  churchId: string;
  viewer?: {
    userId?: string;
    name?: string;
    role?: string;
  };
  stats?: {
    activeMembers?: number;
    ministries?: number;
    ministryMembers?: number;
    unreadNotifications?: number;
  };
  generatedAt?: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: unknown };
type ApiRes<T> = ApiOk<T> | ApiErr;

function explainAuthProblem(status: number, msg: string) {
  if (status === 401) {
    return (
      msg ||
      "Unauthorized. Kwa dev tumia KRISTO_DEV_AUTO_LOGIN=1 kwenye .env.local kisha restart dev server. Uki-test kwa headers, weka KRISTO_DEV_HEADER_AUTH=1 na utume x-kristo-user-id, x-kristo-role, x-kristo-church-id."
    );
  }
  if (status === 403) {
    return (
      msg ||
      "Forbidden. Role/church scope haikuruhusu. Hakikisha role ni Pastor, Church_Admin, Leader, au System_Admin."
    );
  }
  return msg || "Request failed.";
}

async function readApi<T>(res: Response): Promise<ApiRes<T> | null> {
  try {
    return (await res.json()) as ApiRes<T>;
  } catch {
    return null;
  }
}

function okJson<T>(x: ApiRes<T> | null): x is ApiOk<T> {
  return !!x && (x as any).ok === true;
}

function devHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const enabled = String(localStorage.getItem("kristo_dev_header_auth") || "").trim();
    if (enabled !== "1") return {};

    const uid = String(localStorage.getItem("kristo_dev_user_id") || "").trim();
    const role = String(localStorage.getItem("kristo_dev_role") || "").trim();
    const cid = String(localStorage.getItem("kristo_dev_church_id") || "").trim();

    const h: Record<string, string> = {};
    if (uid) h["x-kristo-user-id"] = uid;
    if (role) h["x-kristo-role"] = role;
    if (cid) h["x-kristo-church-id"] = cid;
    return h;
  } catch {
    return {};
  }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontSize: 13, opacity: 0.72 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export default function ChurchOverviewPage() {
  const sp = useSearchParams();
  const { loading, role, membershipStatus } = useMeChurch();

  const canReadAdminStuff =
    membershipStatus === "Active" &&
    ["Pastor", "Church_Admin", "Leader", "System_Admin"].includes(role);

  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = String(sp.get("devHeaderAuth") || "").trim();
      if (v === "1" || v === "0") localStorage.setItem("kristo_dev_header_auth", v);
    } catch {}
  }, [sp]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!localStorage.getItem("kristo_dev_header_auth")) localStorage.setItem("kristo_dev_header_auth", "0");
      if (DEV_USER_ID && !localStorage.getItem("kristo_dev_user_id")) localStorage.setItem("kristo_dev_user_id", DEV_USER_ID);
      if (DEV_ROLE && !localStorage.getItem("kristo_dev_role")) localStorage.setItem("kristo_dev_role", DEV_ROLE);
      if (DEV_CHURCH_ID && !localStorage.getItem("kristo_dev_church_id")) localStorage.setItem("kristo_dev_church_id", DEV_CHURCH_ID);
    } catch {}
  }, []);

  useEffect(() => {
    if (!canReadAdminStuff) return;

    async function load() {
      setError("");
      try {
        const res = await fetch("/api/church/overview", {
          cache: "no-store",
          credentials: "include",
          headers: { ...devHeaders(), accept: "application/json" },
        });

        const json = await readApi<OverviewData>(res);

        if (!res.ok || !okJson(json)) {
          const msg = json && !okJson(json) ? (json as ApiErr).error : "";
          setError(explainAuthProblem(res.status, msg || `Failed to load overview data (HTTP ${res.status})`));
          setData(null);
          return;
        }

        setData(json.data);
      } catch {
        setError("Failed to load overview data");
        setData(null);
      }
    }

    load();
  }, [canReadAdminStuff]);

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;

  if (membershipStatus !== "Active") {
    return (
      <div style={{ padding: 16 }}>
        <h2>Church Overview</h2>
        <p>
          You must be an <b>Active</b> church member to view this page.
        </p>
      </div>
    );
  }

  if (!canReadAdminStuff) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Church Overview</h2>
        <p>
          <b>Forbidden (role)</b>
          <br />
          Your role: <b>{role}</b>
          <br />
          Required: Pastor / Church_Admin / Leader / System_Admin
        </p>
      </div>
    );
  }

  const stats = data?.stats || {};
  const viewer = data?.viewer || {};

  return (
    <div style={{ padding: 16 }}>
      <h2>Church Overview</h2>

      <div style={{ opacity: 0.76, marginBottom: 14 }}>
        API: <b>/api/church/overview</b>
      </div>

      {error && <div style={{ color: "red", marginBottom: 12 }}>{error}</div>}

      {!data ? (
        <div>Loading overview data…</div>
      ) : (
        <>
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 16,
              background: "rgba(255,255,255,0.03)",
              marginBottom: 16,
            }}
          >
            <div><b>Church ID:</b> {data.churchId || "—"}</div>
            <div><b>Viewer:</b> {viewer.name || viewer.userId || "—"}</div>
            <div><b>Role:</b> {viewer.role || role || "—"}</div>
            <div><b>Generated:</b> {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"}</div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <StatCard label="Active Members" value={stats.activeMembers ?? 0} />
            <StatCard label="Ministries" value={stats.ministries ?? 0} />
            <StatCard label="Ministry Members" value={stats.ministryMembers ?? 0} />
            <StatCard label="Unread Notifications" value={stats.unreadNotifications ?? 0} />
          </div>
        </>
      )}
    </div>
  );
}
