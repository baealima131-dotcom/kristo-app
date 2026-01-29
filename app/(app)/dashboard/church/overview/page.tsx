"use client";

import { useEffect, useState } from "react";
import { useMeChurch } from "../_components/useMeChurch";

export default function ChurchOverviewPage() {
  const { loading, role, membershipStatus } = useMeChurch();

  // ✅ Allow Leader to read overview (read-only)
  const canReadAdminStuff =
    membershipStatus === "Active" &&
    ["Pastor", "Church_Admin", "Leader", "System_Admin"].includes(role);

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!canReadAdminStuff) return;

    async function load() {
      try {
        const res = await fetch("/api/church/overview", { cache: "no-store" });

        if (!res.ok) {
          setError(`Failed to load overview data (HTTP ${res.status})`);
          return;
        }

        const json = await res.json().catch(() => null);
        if (!json) {
          setError("Failed to load overview data (invalid JSON)");
          return;
        }

        setData(json);
      } catch {
        setError("Failed to load overview data");
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

  return (
    <div style={{ padding: 16 }}>
      <h2>Church Overview</h2>

      {error && <div style={{ color: "red" }}>{error}</div>}

      {!data ? <div>Loading overview data…</div> : <pre style={{ opacity: 0.8 }}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
