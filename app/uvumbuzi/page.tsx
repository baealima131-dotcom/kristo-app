"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Project = {
  id: string;
  name: string;
  description?: string;
  role: "owner" | "leader" | "member";
};
type Viewer = { kristoId?: string | null; projects?: Project[] };
type Activity = { seq?: number; action: string; targetType?: string; detail?: string; createdAt?: string };
type History = {
  role: string;
  projectId: string;
  linked?: boolean;
  tasks?: unknown[];
  members?: unknown[];
  proposals?: unknown[];
  activity?: Activity[];
};

const panel: React.CSSProperties = {
  background: "#151c29",
  border: "1px solid #343d4b",
  borderRadius: 15,
  padding: 22,
};
const field: React.CSSProperties = {
  width: "100%",
  background: "#0b101b",
  color: "#f8f1de",
  border: "1px solid #526071",
  borderRadius: 9,
  padding: "11px 12px",
  fontSize: 15,
};
const label: React.CSSProperties = {
  display: "block",
  color: "#cdd3dc",
  fontSize: 13,
  marginBottom: 7,
};
const button: React.CSSProperties = {
  background: "#e5be65",
  border: "1px solid #e5be65",
  borderRadius: 9,
  color: "#1d1a12",
  fontWeight: 800,
  padding: "11px 17px",
  cursor: "pointer",
};
const secondary: React.CSSProperties = {
  ...button,
  background: "transparent",
  color: "#ead69e",
  borderColor: "#786943",
};

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/uvumbuzi/lab/${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Server haijarudisha JSON inayotambulika.");
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${response.status}`;
    throw new Error(response.status === 401 ? "Session ya Kristo haijatambuliwa. Ingia tena." : detail);
  }
  return body;
}

function validProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is Project =>
      x != null && typeof x === "object" && typeof x.id === "string" && typeof x.name === "string"
  );
}

export default function UvumbuziPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [name, setName] = useState("Mradi wangu wa kwanza");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("electricity");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const refresh = useCallback(async () => {
    const raw = await api("me");
    if (!raw || typeof raw !== "object" || !("projects" in raw)) throw new Error("Jibu la miradi halijatambulika.");
    const record = raw as Viewer;
    setViewer({ kristoId: record.kristoId, projects: validProjects(record.projects) });
  }, []);

  useEffect(() => {
    let active = true;
    void api("me")
      .then((raw) => {
        if (!active) return;
        const info = raw as Viewer;
        setViewer({ kristoId: info.kristoId, projects: validProjects(info.projects) });
      })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Hitilafu ya kuingia."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setError("");
    setNotice("");
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 200) { setError("Jina la mradi liwe na herufi 1 hadi 200."); return; }
    setCreating(true);
    try {
      const created = await api("projects", {
        method: "POST",
        body: JSON.stringify({ name: cleanName, description: description.trim(), domain }),
      }) as Project;
      if (!created || typeof created.id !== "string") throw new Error("Mradi umejibiwa bila kitambulisho.");
      await refresh();
      setSelected(created.id);
      setHistory(null);
      setName("");
      setDescription("");
      setNotice("Mradi umehifadhiwa kwenye Uvumbuzi Lab na kuhusishwa na Kristo ID yako.");
      await openHistory(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Imeshindikana kuunda mradi.");
      // If server committed before a network error, refresh to avoid creating a duplicate on retry.
      try { await refresh(); } catch { /* Retain the original error. */ }
    } finally {
      setCreating(false);
    }
  }

  async function openHistory(projectId: string) {
    setSelected(projectId);
    setHistory(null);
    setHistoryLoading(true);
    setError("");
    try {
      const raw = await api(`projects/${encodeURIComponent(projectId)}/history`);
      setHistory(raw as History);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Historia haipatikani.");
    } finally {
      setHistoryLoading(false);
    }
  }

  const projects = viewer?.projects ?? [];
  const active = projects.find((p) => p.id === selected);

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg,#090e18,#131d2b 55%,#10151f)", color: "#f4f3ef", padding: "30px 16px 70px" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 28 }}>
          <div>
            <div style={{ color: "#e5be65", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>KRISTO APP × UVUMBUZI LAB</div>
            <h1 style={{ fontSize: "clamp(26px,4vw,40px)", margin: "8px 0" }}>Chumba cha Miradi</h1>
            <p style={{ color: "#b6bfcb", margin: 0 }}>Tengeneza mradi, tunza umiliki wako na uone historia ya kazi.</p>
          </div>
          <a href="/dashboard" style={{ ...secondary, textDecoration: "none", display: "inline-block" }}>← Rudi Kristo</a>
        </header>

        {loading ? <section style={panel}>Ninakagua Kristo session yako…</section> : null}
        {error ? <div role="alert" style={{ ...panel, borderColor: "#a96060", color: "#ffd0d0", marginBottom: 16 }}>
          {error} {error.includes("Ingia tena") ? <a href="/sign-in" style={{ color: "#f4cb72", marginLeft: 9 }}>Fungua login</a> : null}
        </div> : null}
        {notice ? <div role="status" style={{ ...panel, borderColor: "#547b66", color: "#d7f4db", marginBottom: 16 }}>{notice}</div> : null}

        {viewer ? (
          <>
            <div style={{ ...panel, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ color: "#b6bfcb", fontSize: 13 }}>Kristo ID iliyothibitishwa</div>
                <strong style={{ color: "#e5be65", letterSpacing: 1 }}>{viewer.kristoId || "Haijaonyeshwa"}</strong>
              </div>
              <div style={{ color: "#c7d0df" }}>Miradi yako: <strong>{projects.length}</strong></div>
              <button type="button" onClick={() => { void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : "Hitilafu.")); }} style={secondary}>Sasisha miradi</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,330px),1fr))", gap: 18 }}>
              <section style={panel}>
                <h2 style={{ marginTop: 0, fontSize: 21 }}>Unda mradi mpya</h2>
                <p style={{ color: "#b6bfcb", fontSize: 14 }}>Mradi utahifadhiwa kwenye Lab baada ya kubonyeza Unda mradi. Hakuna mradi unaoundwa moja kwa moja.</p>
                <form onSubmit={(e) => { void createProject(e); }} style={{ display: "grid", gap: 16 }}>
                  <div><label htmlFor="lab-name" style={label}>Jina la mradi</label><input id="lab-name" style={field} maxLength={200} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mfano: Mfumo wa umeme wa sumaku" /></div>
                  <div><label htmlFor="lab-domain" style={label}>Fani ya mradi</label>
                    <select id="lab-domain" style={field} value={domain} onChange={(e) => setDomain(e.target.value)}>
                      <option value="electricity">Umeme</option><option value="electromagnetism">Sumaku na umeme</option>
                    </select>
                  </div>
                  <div><label htmlFor="lab-description" style={label}>Maelezo (si lazima)</label>
                    <textarea id="lab-description" rows={4} maxLength={5000} style={{ ...field, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mradi unalenga kutatua tatizo gani?" />
                  </div>
                  <button type="submit" style={{ ...button, opacity: creating ? 0.65 : 1 }} disabled={creating}>{creating ? "Ninahifadhi…" : "Unda mradi kwenye Lab"}</button>
                </form>
              </section>

              <section style={panel}>
                <h2 style={{ marginTop: 0, fontSize: 21 }}>Miradi iliyohifadhiwa</h2>
                {projects.length === 0 ? <p style={{ color: "#b6bfcb" }}>Huna mradi uliounganishwa bado. Tumia fomu ya kushoto kuanzisha mradi wako wa kwanza.</p> : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {projects.map((project) => (
                      <div key={project.id} style={{ border: project.id === selected ? "1px solid #e5be65" : "1px solid #394458", background: "#0d1420", padding: 15, borderRadius: 11 }}>
                        <strong style={{ display: "block", marginBottom: 6 }}>{project.name}</strong>
                        {project.description ? <p style={{ fontSize: 13, color: "#b6bfcb" }}>{project.description}</p> : null}
                        <div style={{ color: "#b6bfcb", fontSize: 12, marginBottom: 12 }}>Ruhusa: {project.role}</div>
                        <button type="button" style={secondary} disabled={historyLoading} onClick={() => { void openHistory(project.id); }}>Fungua historia</button>
                        <a href={`/uvumbuzi/${encodeURIComponent(project.id)}`} style={{ ...secondary, textDecoration: "none", display: "inline-block", marginLeft: 8 }}>Fungua ushirikiano</a>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {selected ? <section style={{ ...panel, marginTop: 20 }} aria-live="polite">
              <h2 style={{ marginTop: 0, fontSize: 21 }}>Historia ya mradi {active ? `— ${active.name}` : ""}</h2>
              {historyLoading ? <p>Ninafungua historia…</p> : history ? (
                <>
                  <p style={{ color: "#c8d2db" }}>Ruhusa: <strong>{history.role}</strong> · Washiriki: {history.members?.length ?? 0} · Kazi: {history.tasks?.length ?? 0} · Mapendekezo: {history.proposals?.length ?? 0}</p>
                  {Array.isArray(history.activity) && history.activity.length > 0 ?
                    <ol style={{ paddingLeft: 20, color: "#cdd5dc", display: "grid", gap: 12 }}>{history.activity.slice(-30).reverse().map((item, i) =>
                      <li key={item.seq ?? i}><strong>{item.action}</strong>{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString("sw-TZ")}` : ""}{item.detail ? ` · ${item.detail}` : ""}</li>)}</ol>
                    : <p style={{ color: "#b6bfcb" }}>Bado hakuna matukio mengine ya mradi.</p>}
                </>
              ) : <p style={{ color: "#b6bfcb" }}>Chagua mradi kufungua historia.</p>}
            </section> : null}

            <p style={{ marginTop: 24, color: "#aeb8c6", fontSize: 13 }}>Hii ni Kristo × Lab Preview. Studio ya ndani ya Lab (2D/3D, UPC na simulator) haijafunguliwa kwa umma bado; hapa tunajaribu utambulisho, umiliki na historia ya miradi.</p>
          </>
        ) : !loading && !error ? <div style={panel}>Ingia Kristo App ili kuona miradi yako.</div> : null}
      </div>
    </main>
  );
}
