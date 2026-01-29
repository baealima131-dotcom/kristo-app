"use client";

import { useEffect, useMemo, useState } from "react";

type AuditRow = {
  id: string;
  churchId: string;
  createdAt: string;

  action: string;
  message?: string;

  actorUserId?: string;
  actorName?: string;

  targetType?: string;
  targetId?: string;

  meta?: any;
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; details?: unknown };
type ApiRes<T> = ApiOk<T> | ApiErr;

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
function explainAuthProblem(status: number, msg: string) {
  if (status === 401) return msg || "Unauthorized. Login (Clerk) au tumia KRISTO_DEV_* kisha restart.";
  if (status === 403) return msg || "Forbidden. Role/church scope haikuruhusu (Pastor/Church_Admin/Leader).";
  return msg || "Request failed.";
}

export default function ChurchAuditPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [limit, setLimit] = useState(200);

  // details drawer
  const [openId, setOpenId] = useState<string | null>(null);

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const x of items) if (x.action) set.add(x.action);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const qs = q.trim().toLowerCase();
    let data = items;

    if (action) data = data.filter((x) => x.action === action);

    if (qs) {
      data = data.filter((x) => {
        const a = (x.message || "").toLowerCase();
        const b = (x.actorName || "").toLowerCase();
        const c = (x.actorUserId || "").toLowerCase();
        const d = (x.targetId || "").toLowerCase();
        const e = (x.targetType || "").toLowerCase();
        const f = (x.action || "").toLowerCase();
        return a.includes(qs) || b.includes(qs) || c.includes(qs) || d.includes(qs) || e.includes(qs) || f.includes(qs);
      });
    }

    return data;
  }, [items, q, action]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/church/audit", window.location.origin);
      url.searchParams.set("limit", String(Math.max(1, Math.min(1000, Number(limit) || 200))));
      if (action) url.searchParams.set("action", action);
      if (q.trim()) url.searchParams.set("q", q.trim());

      const res = await fetch(url.toString(), {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });

      const json = await readApi<AuditRow[]>(res);

      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || "Failed to load audit logs"));
        setItems([]);
        return;
      }

      const list = Array.isArray(json.data) ? json.data : [];
      setItems(list);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shellWrap: React.CSSProperties = { padding: 20, maxWidth: 1150 };
  const glass: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 16,
    background:
      "radial-gradient(800px 300px at 12% 0%, rgba(212,175,55,0.14), transparent 55%), rgba(0,0,0,0.15)",
    boxShadow: "0 18px 45px rgba(0,0,0,0.45)",
  };
  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    color: "inherit",
    fontWeight: 900,
    cursor: "pointer",
  };
  const btnGold: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(212,175,55,0.34)",
    background: "rgba(212,175,55,0.10)",
    color: "rgba(255,236,190,0.98)",
    fontWeight: 950,
    cursor: "pointer",
  };
  const input: React.CSSProperties = {
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.2)",
    color: "inherit",
    fontWeight: 850,
    width: "100%",
  };
  const select: React.CSSProperties = { ...input, cursor: "pointer" };

  return (
    <div style={shellWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>🧾 Audit Logs</h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            API: <b>/api/church/audit</b>
          </div>
          <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
            Hapa unaona kila action (nani, nini, lini). Inasaidia sana kwa Pastor/Admin ku-track shughuli.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={load} disabled={loading} style={btnGold}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, color: "salmon", fontWeight: 900, whiteSpace: "pre-wrap" }}>⛔ {error}</div>
      ) : null}

      {/* Filters */}
      <div style={{ ...glass, marginTop: 16, padding: 14 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 260px 140px 160px" }}>
          <input
            style={input}
            placeholder="Search (message, actor, target, action...)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select style={select} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <input
            style={input}
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value || 200))}
            placeholder="Limit"
          />

          <div style={{ display: "flex", gap: 10 }}>
            <button
              style={btn}
              onClick={() => {
                setQ("");
                setAction("");
                setOpenId(null);
              }}
              disabled={loading}
            >
              Clear
            </button>
            <button style={btnGold} onClick={load} disabled={loading}>
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 10 }}>List ({filtered.length})</h3>

        {filtered.length === 0 ? (
          <div style={{ opacity: 0.8 }}>{loading ? "Loading..." : "No audit logs yet."}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((x) => {
              const isOpen = openId === x.id;
              const when = x.createdAt ? new Date(x.createdAt).toLocaleString() : "—";
              const actor = x.actorName || x.actorUserId || "—";
              const target = x.targetType ? `${x.targetType}${x.targetId ? `:${x.targetId}` : ""}` : "—";

              return (
                <div key={x.id} style={{ ...glass, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 320 }}>
                      <div style={{ fontWeight: 950, fontSize: 14 }}>{x.action}</div>
                      <div style={{ opacity: 0.85, marginTop: 6 }}>{x.message || "—"}</div>
                      <div style={{ opacity: 0.7, marginTop: 8, fontSize: 12 }}>
                        <b>{when}</b> • actor: <b>{actor}</b> • target: <b>{target}</b>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button style={isOpen ? btnGold : btn} onClick={() => setOpenId(isOpen ? null : x.id)}>
                        {isOpen ? "Hide details" : "View details"}
                      </button>
                    </div>
                  </div>

                  <div style={{ opacity: 0.55, fontSize: 12, marginTop: 10 }}>ID: {x.id}</div>

                  {isOpen ? (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ fontWeight: 950, marginBottom: 8 }}>Details</div>
                      <div style={{ display: "grid", gap: 8, fontSize: 12, opacity: 0.9 }}>
                        <div>
                          <b>actorUserId:</b> {x.actorUserId || "—"}
                        </div>
                        <div>
                          <b>actorName:</b> {x.actorName || "—"}
                        </div>
                        <div>
                          <b>targetType:</b> {x.targetType || "—"}
                        </div>
                        <div>
                          <b>targetId:</b> {x.targetId || "—"}
                        </div>
                        <div>
                          <b>meta:</b>
                          <pre
                            style={{
                              marginTop: 8,
                              padding: 12,
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.12)",
                              background: "rgba(0,0,0,0.18)",
                              overflow: "auto",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {JSON.stringify(x.meta ?? null, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
