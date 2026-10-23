"use client";
import { useEffect,useState,type FormEvent,type CSSProperties } from "react";
type Project={id:string;name:string;role:string};
type Task={id:string;title:string;details?:string;status:string;dueDate?:string|null;reports?:{note:string;createdAt:string}[]};
type History={projectId:string;role:string;tasks:Task[]};
type Viewer={projects?:Project[],kristoId?:string};
const panel:CSSProperties={border:"1px solid #38628b",borderRadius:15,padding:19,background:"#0b2239"};
const inp:CSSProperties={width:"100%",border:"1px solid #477ba5",borderRadius:9,padding:11,background:"#061626",color:"#f2f8ff"};
const gold:CSSProperties={border:0,borderRadius:9,padding:"11px 16px",color:"#1a2030",background:"#f2c878",fontWeight:800,cursor:"pointer"};
async function api(path:string,body?:object){
  const res=await fetch("/api/uvumbuzi/lab/"+path,{credentials:"same-origin",cache:"no-store",method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
  const v=await res.json().catch(()=>({}));if(!res.ok)throw Error(res.status===401?"Ingia Kristo kwanza.":String(v?.error||"Ombi limekataliwa."));
  return v;
}
export default function AgentDesk(){
  const [projects,setProjects]=useState<Project[]>([]);
  const [projectId,setProjectId]=useState("");
  const [history,setHistory]=useState<History|null>(null);
  const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const [note,setNote]=useState("");const [url,setUrl]=useState("");const [taskId,setTaskId]=useState("");
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  async function load(selected?:string){
    const me=await api("me") as Viewer;
    const all=me.projects||[];setProjects(all);
    const id=selected&&all.some(p=>p.id===selected)?selected:all[0]?.id||"";
    setProjectId(id);
    setHistory(id?await api("projects/"+encodeURIComponent(id)+"/history"):null);
  }
  useEffect(()=>{void load().catch(e=>setError(String(e))).finally(()=>setLoading(false));},[]);
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||!taskId||!note.trim())return;
    setError("");setNotice("");setBusy(true);
    try {
      const u=url.trim();
      if(u){const parsed=new URL(u);if(parsed.protocol!=="https:")throw Error("Weka link ya picha yenye HTTPS.");}
      await api("tasks/"+encodeURIComponent(taskId)+"/reports",{note:note.trim(),...(u?{evidenceUrl:u}:{})});
      await load(projectId);setTaskId("");setNote("");setUrl("");setNotice("Ripoti imehifadhiwa na inasubiri admin aikague.");
    }catch(e){setError(e instanceof Error?e.message:"Ripoti imeshindikana.");}
    finally{setBusy(false);}
  }
  const tasks=history?.tasks||[];
  return <main style={{minHeight:"100dvh",background:"linear-gradient(145deg,#06101e,#0b2c48)",color:"#f0f7ff",fontFamily:"system-ui,sans-serif",padding:"22px 16px"}}>
    <div style={{maxWidth:1000,margin:"auto"}}>
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:20}}><div><small style={{color:"#eac273",letterSpacing:2}}>UVUMBUZI LAB · AGENT DESK</small><h1 style={{margin:"7px 0"}}>Kazi na Ripoti Zangu</h1></div><a style={{color:"#f1cd83"}} href="/uvumbuzi">← Miradi Yangu</a></header>
      {loading&&<p style={panel}>Ninapakia kazi…</p>}
      {error&&<p role="alert" style={{...panel,color:"#ffd4ce",borderColor:"#ab6a70"}}>{error} <a href="/sign-in" style={{color:"#f3ce7b"}}>Ingia tena</a></p>}
      {notice&&<p role="status" style={{...panel,color:"#c6f7dc"}}>{notice}</p>}
      {!loading&&<div style={{display:"grid",gap:15}}>
        <div style={panel}><label htmlFor="agent-project">Mradi</label><select id="agent-project" style={{...inp,marginTop:8}} value={projectId} onChange={e=>{setError("");setTaskId("");void load(e.target.value).catch(err=>setError(String(err)));}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}</select></div>
        {!projects.length?<section style={panel}><p>Bado hujaunganishwa na mradi. Tumia invitation code kwanza.</p><a href="/uvumbuzi/join" style={{color:"#efd18c"}}>Tumia Agent Code ↗</a></section>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,350px),1fr))",gap:15}}>
          <section style={panel}><h2 style={{marginTop:0}}>Kazi Nilizopangiwa</h2>{tasks.length===0?<p>Hakuna kazi mpya.</p>:tasks.map(t=><article key={t.id} style={{borderBottom:"1px solid #345677",padding:"13px 0"}}><div style={{fontWeight:800}}>{t.title}</div><div style={{fontSize:12,color:"#bdd0df"}}>Tarehe: {t.dueDate||"Haijawekwa"} · Hali: {t.status}</div>{t.details&&<p style={{fontSize:13}}>{t.details}</p>}<button type="button" disabled={t.status==="approved"||t.status==="submitted"} onClick={()=>{setTaskId(t.id);setNote("");setUrl("");}} style={{...gold,opacity:(t.status==="approved"||t.status==="submitted") ? 0.5 : 1}}>Andika ripoti</button></article>)}</section>
          <section style={panel}><h2 style={{marginTop:0}}>Tuma Ripoti ya Kazi</h2><p style={{color:"#abc7df",fontSize:13}}>Ripoti yako iwe ya kweli, ya kazi uliyofanya. Picha ya ushahidi iwe na link ya HTTPS kutoka sehemu unayoidhibiti.</p><form onSubmit={submit} style={{display:"grid",gap:12}}><label htmlFor="task-id">Kazi</label><select id="task-id" required style={inp} value={taskId} onChange={e=>setTaskId(e.target.value)}><option value="">Chagua kazi</option>{tasks.filter(t=>t.status!=="submitted"&&t.status!=="approved").map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select><label htmlFor="report-text">Ripoti ya maendeleo</label><textarea id="report-text" required rows={5} maxLength={5000} style={inp} value={note} onChange={e=>setNote(e.target.value)} placeholder="Nimefanya nini? Nimepata matokeo gani? Hatua inayofuata?"/><label htmlFor="proof-url">Picha / ushahidi (HTTPS URL, hiari)</label><input id="proof-url" type="url" maxLength={2000} style={inp} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/><button type="submit" disabled={busy||!taskId} style={gold}>{busy?"Inahifadhi…":"Tuma ripoti kwa admin"}</button></form></section>
        </div>}
      </div>}
    </div></main>;
}
