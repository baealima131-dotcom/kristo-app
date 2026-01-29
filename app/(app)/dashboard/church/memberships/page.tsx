"use client";

import { useEffect, useMemo, useState } from "react";

type MembershipStatus = "Requested" | "Active" | "Rejected" | "Banned" | "Left";

type ChurchMembership = {
  id: string;
  userId: string;
  churchId: string;
  status: MembershipStatus;
  churchRole: "Member" | "Leader" | "Church_Admin" | "Pastor";
  name?: string;
  createdAt: string;
  updatedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
};

type ApiOk<T> = { ok: true; churchId?: string; items?: T; membership?: any; data?: any };
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
  if (status === 401) return msg || "Unauthorized. Login (Clerk) kisha jaribu tena.";
  if (status === 403) return msg || "Forbidden. Unahitaji Pastor/Church_Admin.";
  return msg || "Request failed.";
}

function fmtIsoShort(iso?: string) {
  if (!iso) return "—";
  const s = String(iso);
  return s.slice(0, 19).replace("T", " ");
}

function statusPillStyle(s: MembershipStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
  };

  if (s === "Requested") return { ...base, borderColor: "rgba(212,175,55,0.55)", background: "rgba(212,175,55,0.10)" };
  if (s === "Active") return { ...base, borderColor: "rgba(80,255,140,0.45)", background: "rgba(80,255,140,0.10)" };
  if (s === "Rejected") return { ...base, borderColor: "rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" };
  if (s === "Banned") return { ...base, borderColor: "rgba(255,80,80,0.55)", background: "rgba(255,80,80,0.12)" };
  return { ...base, opacity: 0.85 }; // Left
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: active ? "rgba(212,175,55,0.12)" : "rgba(0,0,0,0.18)",
    color: "inherit",
    fontWeight: 950,
    opacity: active ? 1 : 0.78,
    boxShadow: active ? "0 10px 25px rgba(212,175,55,0.12)" : undefined,
  };
}

function pillBtnStyle(kind: "gold" | "danger" | "neutral" = "neutral"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    color: "inherit",
    fontWeight: 950,
    cursor: "pointer",
    transition: "transform 120ms ease, opacity 120ms ease",
  };
  if (kind === "gold") return { ...base, borderColor: "rgba(212,175,55,0.55)", background: "rgba(212,175,55,0.10)" };
  if (kind === "danger") return { ...base, borderColor: "rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.10)" };
  return base;
}

export default function ChurchMembershipsPage() {
  const [status, setStatus] = useState<MembershipStatus>("Requested");
  const [items, setItems] = useState<ChurchMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  // reject UI
  const [rejectingId, setRejectingId] = useState<string>("");
  const [rejectNote, setRejectNote] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/church/memberships?status=${encodeURIComponent(status)}`, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });

      const json = await readApi<ChurchMembership[]>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || "Failed to load memberships"));
        setItems([]);
        return;
      }

      const list = (json.items as any) ?? [];
      const arr = Array.isArray(list) ? (list as ChurchMembership[]) : [];
      // nice ordering: newest first
      arr.sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1));
      setItems(arr);
    } catch {
      setError("Network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((m) => {
      const hay = `${m.name ?? ""} ${m.userId ?? ""} ${m.id ?? ""} ${m.churchRole ?? ""} ${m.status ?? ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [items, q]);

  async function approve(id: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/church/memberships/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const json = await readApi<any>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || "Failed to approve"));
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function reject(id: string, note?: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/church/memberships/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ note: note?.trim() ? note.trim() : undefined }),
      });
      const json = await readApi<any>(res);
      if (!res.ok || !okJson(json)) {
        const msg = json && !okJson(json) ? (json as ApiErr).error : "";
        setError(explainAuthProblem(res.status, msg || "Failed to reject"));
        return;
      }
      setRejectingId("");
      setRejectNote("");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  const shellWrap: React.CSSProperties = { padding: 20, maxWidth: 1120 };
  const glass: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    background:
      "radial-gradient(900px 360px at 12% 0%, rgba(212,175,55,0.14), transparent 56%), rgba(0,0,0,0.14)",
    boxShadow: "0 18px 55px rgba(0,0,0,0.50)",
  };
  const input: React.CSSProperties = {
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    color: "inherit",
    outline: "none",
  };
  const chip: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.18)",
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.92,
  };

  return (
    <div style={shellWrap}>
      <div style={{ ...glass, padding: 18 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 20, fontWeight: 1000, letterSpacing: 0.2 }}>Membership Requests</div>
              <span style={{ ...chip, borderColor: "rgba(212,175,55,0.55)", background: "rgba(212,175,55,0.10)" }}>
                👑 VIP GOLD
              </span>
              {loading ? (
                <span style={{ ...chip, opacity: 0.8 }}>⏳ Working...</span>
              ) : null}
            </div>
            <div style={{ opacity: 0.78, fontSize: 13, marginTop: 6 }}>
              Approve / Reject church join requests. (MVP)
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <span style={chip}>📌 Status: <b style={{ marginLeft: 4 }}>{status}</b></span>
              <span style={chip}>📦 Total: <b style={{ marginLeft: 4 }}>{items.length}</b></span>
              <span style={chip}>🔎 Filtered: <b style={{ marginLeft: 4 }}>{filtered.length}</b></span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {(["Requested", "Active", "Rejected", "Left", "Banned"] as MembershipStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={tabStyle(status === s)}
                disabled={loading}
                title={`View ${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / userId / membershipId..."
            style={{ ...input, flex: "1 1 340px" }}
          />

          <button type="button" style={pillBtnStyle("gold")} onClick={() => load()} disabled={loading}>
            🔄 {loading ? "Loading..." : "Refresh"}
          </button>

          <div style={{ opacity: 0.75, fontSize: 12 }}>
            Tip: request endpoint = <code>/api/church/memberships/request</code>
          </div>
        </div>

        {/* Error */}
        {error ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid rgba(255,80,80,0.35)", background: "rgba(255,80,80,0.10)" }}>
            <b>⛔ {error}</b>
          </div>
        ) : null}

        {/* Table */}
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.85 }}>
                <th style={{ padding: "12px 10px" }}>Member</th>
                <th style={{ padding: "12px 10px" }}>Role</th>
                <th style={{ padding: "12px 10px" }}>Status</th>
                <th style={{ padding: "12px 10px" }}>Created</th>
                <th style={{ padding: "12px 10px" }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 18, opacity: 0.78 }}>
                    <div style={{ ...glass, padding: 16, borderRadius: 16, background: "rgba(0,0,0,0.10)" }}>
                      <div style={{ fontWeight: 1000, fontSize: 14 }}>No memberships found</div>
                      <div style={{ opacity: 0.78, fontSize: 12, marginTop: 6 }}>
                        Try another status tab, or clear search.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((m, idx) => {
                  const rowBg = idx % 2 === 0 ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.10)";
                  return (
                    <tr
                      key={m.id}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        background: rowBg,
                      }}
                    >
                      <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 1000 }}>{m.name || "Member"}</div>
                          <span style={{ ...chip, padding: "6px 10px", opacity: 0.85 }}>🪪 {m.churchRole}</span>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span>
                            userId: <b>{m.userId}</b>
                          </span>
                          <button type="button" style={{ ...pillBtnStyle("neutral"), padding: "6px 10px", fontWeight: 900 }} onClick={() => copy(m.userId)} disabled={loading}>
                            Copy
                          </button>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span>membershipId: <b>{m.id}</b></span>
                          <button type="button" style={{ ...pillBtnStyle("neutral"), padding: "6px 10px", fontWeight: 900 }} onClick={() => copy(m.id)} disabled={loading}>
                            Copy
                          </button>
                        </div>

                        {m.note ? (
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
                            📝 note: {m.note}
                          </div>
                        ) : null}
                      </td>

                      <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                        <span style={{ ...chip, padding: "6px 10px" }}>{m.churchRole}</span>
                      </td>

                      <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                        <span style={statusPillStyle(m.status)}>
                          {m.status === "Requested" ? "🟡" : m.status === "Active" ? "🟢" : m.status === "Rejected" ? "🔴" : m.status === "Banned" ? "⛔" : "⚪"}
                          {m.status}
                        </span>
                      </td>

                      <td style={{ padding: "14px 10px", verticalAlign: "top", fontSize: 12, opacity: 0.9 }}>
                        <div>{fmtIsoShort(m.createdAt)}</div>
                        {m.decidedAt ? (
                          <div style={{ marginTop: 6, opacity: 0.75 }}>
                            decided: {fmtIsoShort(m.decidedAt)}
                          </div>
                        ) : null}
                      </td>

                      <td style={{ padding: "14px 10px", verticalAlign: "top", minWidth: 260 }}>
                        {m.status === "Requested" ? (
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              style={pillBtnStyle("gold")}
                              onClick={() => approve(m.id)}
                              disabled={loading}
                              title="Approve membership"
                            >
                              ✅ Approve
                            </button>

                            <button
                              type="button"
                              style={pillBtnStyle("danger")}
                              onClick={() => {
                                setRejectingId(m.id);
                                setRejectNote("");
                              }}
                              disabled={loading}
                              title="Reject membership"
                            >
                              ❌ Reject
                            </button>

                            {rejectingId === m.id ? (
                              <div style={{ width: "100%", marginTop: 8 }}>
                                <div style={{ ...glass, padding: 12, borderRadius: 16, background: "rgba(0,0,0,0.10)" }}>
                                  <div style={{ fontWeight: 1000, fontSize: 13 }}>Reject reason (optional)</div>
                                  <input
                                    value={rejectNote}
                                    onChange={(e) => setRejectNote(e.target.value)}
                                    placeholder="Reason..."
                                    style={{ ...input, width: "100%", marginTop: 8 }}
                                  />

                                  <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                                    <button
                                      type="button"
                                      style={pillBtnStyle("danger")}
                                      onClick={() => reject(m.id, rejectNote)}
                                      disabled={loading}
                                    >
                                      Confirm Reject
                                    </button>
                                    <button
                                      type="button"
                                      style={pillBtnStyle("neutral")}
                                      onClick={() => {
                                        setRejectingId("");
                                        setRejectNote("");
                                      }}
                                      disabled={loading}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span style={{ opacity: 0.7, fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.78 }}>
          VIP Note: Hii page ni ya Pastor/Church_Admin kusimamia requests. Approval/rejection inatuma notification kwa user.
        </div>
      </div>
    </div>
  );
}
