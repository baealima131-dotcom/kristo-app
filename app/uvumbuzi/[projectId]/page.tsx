"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "next/navigation";

type Project = { id: string; name: string; description?: string; role: "owner" | "leader" | "member" };
type Activity = { seq?: number; action: string; createdAt?: string; detail?: string };
type Proposal = { id: string; title: string; summary: string; status: string; createdAt?: string; proposerSubject?: string };
type Task = { id: string; title: string; status: string };
type Member = { subject?: string; role?: string };
type History = {
  role: "owner" | "leader" | "member";
  projectId: string;
  activity?: Activity[];
  proposals?: Proposal[];
  tasks?: Task[];
  members?: Member[];
};
type Viewer = { kristoId?: string | null; projects?: Project[] };
const outer: CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: "28px 16px 70px" };
const card: CSSProperties = { background: "#141c29", border: "1px solid #344051", borderRadius: 16, padding: 22 };
const input: CSSProperties = { width: "100%", border: "1px solid #5a6679", borderRadius: 9, background: "#0b101a", color: "#f1f2f4", padding: "12px", fontSize: 15 };
const gold: CSSProperties = { color: "#161613", background: "#e7c16b", border: "1px solid #e7c16b", borderRadius: 9, padding: "11px 17px", cursor: "pointer", fontWeight: 800 };
const outline: CSSProperties = { ...gold, color: "#edd69c", background: "transparent", borderColor: "#74633f" };
const label: CSSProperties = { display: "block", fontSize: 13, color: "#c7d0dc", marginBottom: 7 };
const muted: CSSProperties = { color: "#b9c2d0", fontSize: 14 };
function issue(e: unknown) { return e instanceof Error ? e.message : "Ombi halijakamilika."; }

async function request(path: string, payload?: object): Promise<unknown> {
  const response = await fetch(`/api/uvumbuzi/lab/${path}`, {
    method: payload ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = json && typeof json === "object" && "error" in json && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    throw new Error(response.status === 401 ? "Login haijatambuliwa. Ingia tena kwenye Kristo Preview hii." : msg);
  }
  return json;
}

function validId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(raw) && !/^\.+$/.test(raw);
}

export default function ProjectRoom() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteId, setInviteId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!validId(projectId)) throw new Error("Kitambulisho cha mradi si sahihi.");
    const raw = await request("me") as Viewer;
    const owned = (raw.projects || []).find((p) => p.id === projectId);
    if (!owned) throw new Error("Huna ruhusa ya kufungua mradi huu.");
    const data = await request(`projects/${encodeURIComponent(projectId)}/history`) as History;
    if (!data || data.projectId !== projectId) throw new Error("Historia ya mradi haijatambuliwa.");
    setViewer(raw);
    setProject(owned);
    setHistory(data);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void load().catch((e: unknown) => { if (active) setError(issue(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  async function action(fn: () => Promise<unknown>, ok: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      await load();
      setNotice(ok);
    } catch (e) {
      setError(issue(e));
      // Refresh may help after a successful write with an interrupted response.
      try { await load(); } catch { /* Keep original error */ }
    } finally { setBusy(false); }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = inviteId.trim().toUpperCase();
    if (!/^KR[0-9A-Z]?-[0-9A-Z]{3,20}$/.test(id)) { setError("Tumia Kristo ID sahihi, mfano KR7-12345AB."); return; }
    void action(async () => {
      await request(`projects/${encodeURIComponent(projectId)}/members`, { kristoId: id });
      setInviteId("");
    }, "Mwaliko umehifadhiwa. Mwanachama anaweza kuona mradi kwa Kristo ID yake.");
  }

  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !summary.trim()) { setError("Jaza jina na maelezo ya pendekezo."); return; }
    void action(async () => {
      await request(`projects/${encodeURIComponent(projectId)}/proposals`, { title: title.trim(), summary: summary.trim() });
      setTitle(""); setSummary("");
    }, "Pendekezo limehifadhiwa. Halijabadilisha michoro wala simulator.");
  }

  function decide(proposal: Proposal, decision: "approved" | "rejected") {
    if (decision === "rejected" && !reason.trim()) { setError("Andika sababu kabla ya kukataa pendekezo."); return; }
    void action(() => request(`proposals/${encodeURIComponent(proposal.id)}/decision`,
      { decision, reason: reason.trim() }), "Uamuzi umehifadhiwa. Hakuna mabadiliko ya UPC yaliyotumika moja kwa moja.");
  }

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(120deg,#080f1b,#131e2d)", color: "#f3f3f6" }}>
      <div style={outer}>
        <header style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 15, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={{ color: "#edc66e", letterSpacing: 2, fontSize: 12, fontWeight: 800 }}>KRISTO × UVUMBUZI LAB · PREVIEW</div>
            <h1 style={{ fontSize: "clamp(27px, 4vw, 38px)", margin: "9px 0" }}>Chumba cha Ushirikiano</h1>
            <p style={muted}>Umiliki, ushirikiano, mapendekezo na historia ya mradi.</p>
          </div>
          <a href="/uvumbuzi" style={{ ...outline, textDecoration: "none" }}>← Miradi yangu</a>
        </header>
        {loading ? <section style={card}>Ninasoma ruhusa za mradi…</section> : null}
        {error ? <section role="alert" style={{ ...card, borderColor: "#bd6464", color: "#ffcbcb", marginBottom: 16 }}>
          {error} {error.includes("Login") ? <a href="/sign-in" style={{ color: "#edc66e", marginLeft: 12 }}>Ingia tena</a> : null}
        </section> : null}
        {notice ? <section role="status" style={{ ...card, borderColor: "#4b8264", color: "#dcf6e4", marginBottom: 16 }}>{notice}</section> : null}
        {history && project ? <>
          <section style={{ ...card, marginBottom: 18 }}>
            <h2 style={{ fontSize: 25, margin: "0 0 8px" }}>{project.name}</h2>
            <p style={muted}>{project.description || "Mradi wa Uvumbuzi Lab"}</p>
            <p style={{ color: "#edc66e", fontSize: 14, marginBottom: 0 }}>Kristo ID: {viewer?.kristoId || "Haijapatikana"} · Ruhusa: {history.role}</p>
          </section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,370px),1fr))", gap: 18 }}>
            <section style={card}>
              <h2 style={{ marginTop: 0 }}>Pendekeza mabadiliko</h2>
              <p style={muted}>Pendekezo ni kumbukumbu tu. Kukubaliwa hakubadilishi UPC wala simulator.</p>
              <form onSubmit={propose} style={{ display: "grid", gap: 12 }}>
                <div><label htmlFor="prop-title" style={label}>Jina la pendekezo</label><input id="prop-title" maxLength={200} required value={title} onChange={e=>setTitle(e.target.value)} style={input} placeholder="Mfano: Boresha koili ya sumaku" /></div>
                <div><label htmlFor="prop-summary" style={label}>Maelezo</label><textarea id="prop-summary" rows={4} maxLength={5000} required value={summary} onChange={e=>setSummary(e.target.value)} style={input} placeholder="Eleza wazo, sababu na matokeo yanayotarajiwa." /></div>
                <button type="submit" disabled={busy} style={{ ...gold, opacity: busy ? .55 : 1 }}>{busy ? "Inahifadhi…" : "Hifadhi pendekezo"}</button>
              </form>
            </section>
            <section style={card}>
              <h2 style={{ marginTop: 0 }}>Washiriki na ruhusa</h2>
              <p style={muted}>Washiriki: {history.members?.length ?? 0} · Ni mmiliki pekee anayeweza kualika mwanachama.</p>
              {history.role === "owner" ? (
                <form onSubmit={invite} style={{ display: "grid", gap: 12 }}>
                  <div><label style={label} htmlFor="invite-id">Kristo ID ya mshiriki</label><input id="invite-id" style={input} value={inviteId} onChange={e=>setInviteId(e.target.value)} required maxLength={24} placeholder="KR7-12345AB" autoComplete="off" /></div>
                  <button type="submit" disabled={busy} style={outline}>Ongeza mshiriki (member)</button>
                </form>
              ) : <p style={muted}>Waombe wamiliki wakuongezee washiriki.</p>}
              <hr style={{ border: 0, borderTop: "1px solid #3b4656", margin: "20px 0" }}/>
              <h3 style={{ marginTop: 0 }}>Kazi za mradi</h3>
              {Array.isArray(history.tasks) && history.tasks.length > 0
                ? <ul>{history.tasks.map(t=><li key={t.id} style={{ marginBottom: 8 }}>{t.title} — {t.status}</li>)}</ul>
                : <p style={muted}>Hakuna kazi zilizogawiwa bado.</p>}
              <p style={{ ...muted, fontSize: 12 }}>Ugawaji wa kazi kupitia Kristo ID utaongezwa baada ya kukamilisha uthibitishaji wa ruhusa zake.</p>
            </section>
          </div>
          <section style={{ ...card, marginTop: 18 }}>
            <h2 style={{ marginTop: 0 }}>Mapendekezo ya mradi</h2>
            {Array.isArray(history.proposals) && history.proposals.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {history.proposals.map(p=>(
                  <div key={p.id} style={{ border: "1px solid #39475a", borderRadius: 12, padding: 15 }}>
                    <strong>{p.title}</strong><span style={{ color: "#edc66e" }}> · {p.status}</span>
                    <p style={muted}>{p.summary}</p>
                    {history.role === "owner" && p.status === "pending" ? <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
                      <input aria-label="Sababu ya uamuzi" style={{ ...input, flex: "1 1 220px", width: "auto" }} maxLength={2000} placeholder="Sababu (lazima kwa kukataa)" value={reason} onChange={e=>setReason(e.target.value)} />
                      <button type="button" style={gold} disabled={busy} onClick={()=>decide(p,"approved")}>Kubali</button>
                      <button type="button" style={outline} disabled={busy} onClick={()=>decide(p,"rejected")}>Kataa</button>
                    </div> : null}
                  </div>
                ))}
              </div>
            ) : <p style={muted}>Bado hakuna mapendekezo.</p>}
          </section>
          <section style={{ ...card, marginTop: 18 }}>
            <h2 style={{ marginTop: 0 }}>Historia</h2>
            {Array.isArray(history.activity) && history.activity.length > 0 ? (
              <ol style={{ color: "#cbd4df", display: "grid", gap: 11, paddingLeft: 23 }}>
                {history.activity.slice(-40).reverse().map((event, index) => (
                  <li key={event.seq ?? index}><strong>{event.action}</strong>{event.createdAt ? ` · ${new Date(event.createdAt).toLocaleString("sw-TZ")}` : ""}</li>
                ))}
              </ol>
            ) : <p style={muted}>Bado hakuna matukio.</p>}
            <button type="button" style={outline} disabled={busy} onClick={() => { setError(""); void load().catch((e: unknown)=>setError(issue(e))); }}>Sasisha historia</button>
          </section>
          <p style={{ ...muted, fontSize: 12, marginTop: 23 }}>Studio 2D/3D, UPC na simulator ziko kwenye Lab ya ndani kwa sasa. API za majaribio zitaongezwa hapa tu baada ya kuwa na uthibitishaji wa ruhusa kwa kila mradi.</p>
        </> : !loading && !error ? <section style={card}>Mradi haujapatikana.</section> : null}
      </div>
    </main>
  );
}
