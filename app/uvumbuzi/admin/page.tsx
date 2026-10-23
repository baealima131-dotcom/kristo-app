"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

type Project = { id: string; name: string; domain?: string; role: "owner" | "leader" | "member" };
type Member = { subject: string; role: string; createdAt?: string };
type Report = { id: string; note: string; evidenceUrl?: string | null; createdAt?: string };
type Task = { id: string; title: string; details?: string; assigneeSubject: string; status: "assigned" | "submitted" | "approved" | "changes_requested"; dueDate?: string | null; reports?: Report[]; createdAt?: string };
type Activity = { seq: number; action: string; actorSubject: string; createdAt?: string };
type History = { projectId: string; role: "owner" | "leader" | "member"; ownerSubject: string; members: Member[]; tasks: Task[]; activity: Activity[]; people?: Record<string,{ kristoId: string }> };
type Operations = {role:"owner"|"leader";supervisors:{subject:string;createdAt:string;maxAgents:number;agentsUsed:number}[];agents:{agentSubject:string;supervisorSubject:string;enrolledAt:string}[];claims:{id:string;churchId:string;churchPersonSubject:string;agentSubject:string;supervisorSubject:string;status:string;note:string;trained:number|null;understood:number|null;responseNote:string;createdAt:string;respondedAt?:string|null}[];people?:Record<string,{kristoId:string}>};
type Invite = { role?:string;createdBy?:string;id: string; codeSuffix: string; label: string; expiresAt: string; redeemedAt?: string | null; redeemedBy?: string | null };
type Viewer = { kristoId?: string; projects?: Project[] };
const st: Record<string,CSSProperties> = {
  page:{minHeight:"100dvh",background:"radial-gradient(ellipse at 50% 0,#143456,#06111e 75%)",color:"#f2f7fe",fontFamily:"Inter,system-ui,sans-serif",padding:"20px 18px 45px"},
  wrap:{maxWidth:1380,margin:"0 auto"},
  panel:{border:"1px solid #31618a",borderRadius:17,background:"#0c1f34",padding:18},
  sub:{fontSize:13,color:"#a5c0d7",lineHeight:1.6},
  field:{width:"100%",padding:"11px 12px",border:"1px solid #45769e",borderRadius:9,background:"#071626",color:"#f4f7fc",fontSize:14},
  gold:{padding:"11px 15px",borderRadius:9,border:"1px solid #f3ca81",background:"#edc46e",color:"#1a202a",fontWeight:800,cursor:"pointer"},
  dark:{padding:"10px 14px",borderRadius:9,border:"1px solid #3c81b6",background:"#123858",color:"#e5efff",fontWeight:700,cursor:"pointer"},
  label:{display:"block",fontSize:12,color:"#b8cfe1",marginBottom:6},
};
async function bridge(path: string, body?: object): Promise<any> {
  const res = await fetch("/api/uvumbuzi/lab/"+path,{
    method: body ? "POST":"GET",credentials:"same-origin",cache:"no-store",
    headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined,
  });
  let result:any;try{result=await res.json();}catch{throw Error("Server haijarudisha JSON.");}
  if(!res.ok) throw Error(res.status===401?"Session haijatambuliwa. Ingia tena.":String(result?.error||"HTTP "+res.status));
  return result;
}
function tomorrowLocal() {
  const d=new Date(); d.setDate(d.getDate()+1);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}
function safePhoto(url:unknown):string | null {
  if(typeof url!=="string") return null;
  try {const u=new URL(url);return u.protocol==="https:"?u.href:null;}catch{return null;}
}
function timeStamp(s?:string){if(!s)return "";const d=new Date(s);return Number.isNaN(d.getTime())?s:d.toLocaleString();}
function msg(e:unknown){return e instanceof Error?e.message:"Ombi halijafanikiwa.";}
export default function AgentAdmin(){
  const [viewer,setViewer]=useState<Viewer|null>(null);
  const [projects,setProjects]=useState<Project[]>([]);
  const [selected,setSelected]=useState("");
  const [history,setHistory]=useState<History|null>(null);
  const [invites,setInvites]=useState<Invite[]>([]);
  const [operations,setOperations]=useState<Operations|null>(null);
  const [codeRole,setCodeRole]=useState<"agent"|"supervisor">("supervisor");
  const [loading,setLoading]=useState(true);
  const [working,setWorking]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [code,setCode]=useState("");
  const [codeLabel,setCodeLabel]=useState("");
  const [codeKristoId,setCodeKristoId]=useState("");
  const [codeMaxAgents,setCodeMaxAgents]=useState(5);
  const [capEdit,setCapEdit]=useState<Record<string,string>>({});
  const [inviteKristoId,setInviteKristoId]=useState("");
  const [taskTitle,setTaskTitle]=useState("");
  const [taskDetails,setTaskDetails]=useState("");
  const [assignee,setAssignee]=useState("");
  const [dueDate,setDueDate]=useState(tomorrowLocal);
  const [view,setView]=useState<"overview"|"supervisors"|"agents"|"churches"|"tasks"|"reports"|"invites">("overview");
  const current=projects.find(x=>x.id===selected);
  const owner=history?.role==="owner";
  const permitted=owner||history?.role==="leader";
  const memberIds=useMemo(()=>operations?.agents.map(a=>a.agentSubject)||[],[operations]);
  const people={...(history?.people||{}),...(operations?.people||{})};
  const display=(subject:string)=>people[subject]?.kristoId||"Agent · "+subject.slice(0,8)+"…";
  const tasks=history?.tasks||[];
  const reports=tasks.flatMap(t=>(t.reports||[]).map(r=>({...r,task:t}))).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  const awaiting=tasks.filter(t=>t.status==="submitted");
  const today=tomorrowLocal();
  const tomorrow=tasks.filter(t=>t.dueDate===today);
  const activeCodes=invites.filter(i=>!i.redeemedAt&&Date.parse(i.expiresAt)>Date.now());
  const outreach=operations?.claims||[];
  const confirmed=outreach.filter(c=>c.status==="confirmed");
  const load=useCallback(async(projectId?:string)=>{
    const me=await bridge("me") as Viewer;
    const allowed=(me.projects||[]).filter(p=>(p.role==="owner"||p.role==="leader")&&p.domain==="outreach");
    setViewer(me);setProjects(allowed);
    const id=projectId&&allowed.some(p=>p.id===projectId)?projectId:allowed[0]?.id||"";
    setSelected(id);
    if(!id){setHistory(null);setInvites([]);setOperations(null);return;}
    const [h,c,ops]=await Promise.all([bridge("projects/"+encodeURIComponent(id)+"/history"),bridge("projects/"+encodeURIComponent(id)+"/invitations"),bridge("projects/"+encodeURIComponent(id)+"/operations")]);
    setHistory(h);setInvites(Array.isArray(c)?c:[]);setOperations(ops);
  },[]);
  useEffect(()=>{let live=true;void load().catch(e=>{if(live)setError(msg(e));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[load]);
  async function run(action:()=>Promise<void>,success:string) {
    if(working)return;setWorking(true);setError("");setNotice("");
    try{await action();await load(selected);setNotice(success);}catch(e){setError(msg(e));try{await load(selected);}catch{/* original error retained */}}finally{setWorking(false);}
  }
  function changeProject(v:string) {setCode("");setHistory(null);setInvites([]);setOperations(null);setError("");setLoading(true);void load(v).catch(e=>setError(msg(e))).finally(()=>setLoading(false));}
  function createCode(e:FormEvent){e.preventDefault();void run(async()=>{const result=await bridge("projects/"+encodeURIComponent(selected)+"/invitations",{label:codeLabel.trim(),validDays:7,role:owner?codeRole:"agent",
  ...(codeKristoId.trim()?{kristoId:codeKristoId.trim().toUpperCase()}:{}),
  ...(owner&&codeRole==="supervisor"?{maxAgents:codeMaxAgents}:{})});setCode(result.code);setCodeLabel("");setCodeKristoId("");},"Code mpya imeundwa. Nakili na mtumie agent kwa njia salama; haitarudi tena baada ya kufunga ukurasa.");}
  function inviteById(e:FormEvent){e.preventDefault();const kristoId=inviteKristoId.trim().toUpperCase();void run(async()=>{await bridge("projects/"+encodeURIComponent(selected)+"/members",{kristoId});setInviteKristoId("");},"Mshiriki ameongezwa kwa Kristo ID yake.");}
  function saveSupervisorCap(subject:string){
    const maxAgents=Number(capEdit[subject]);
    if(!Number.isInteger(maxAgents)||maxAgents<1||maxAgents>100){setError("Limit iwe 1 hadi 100.");return;}
    void run(()=>bridge("projects/"+encodeURIComponent(selected)+"/supervisors/"+encodeURIComponent(subject)+"/limit",{maxAgents}).then(()=>{}),
      "Idadi ya juu ya agents wa supervisor imesasishwa.");
  }
  function createTask(e:FormEvent){e.preventDefault();if(!memberIds.includes(assignee)){setError("Chagua agent kutoka orodha ya washiriki.");return;}void run(async()=>{await bridge("projects/"+encodeURIComponent(selected)+"/tasks",{title:taskTitle.trim(),details:taskDetails.trim(),assigneeSubject:assignee,dueDate});setTaskTitle("");setTaskDetails("");},"Kazi imegawiwa kwa agent, na tarehe imehifadhiwa.");}
  function decide(t:Task,decision:"approved"|"changes_requested"){if(!confirm(decision==="approved"?"Kubali ripoti hii?":"Rudisha ripoti ili agent airekebishe?"))return;void run(()=>bridge("tasks/"+encodeURIComponent(t.id)+"/decision",{decision,reason:decision==="changes_requested"?"Tafadhali boresha ripoti na ushahidi.":""}).then(()=>{}),"Uamuzi wa ripoti umehifadhiwa.");}
  function startOutreachCampaign(){
    if(!confirm("Unda mradi mpya wa Kristo Church Outreach? Hii haibadilishi mradi wako wa Sumaku na Umeme."))return;
    if(working)return;
    setWorking(true);setError("");setNotice("");
    void (async()=>{
      try{
        const made=await bridge("projects",{name:"Kristo Church Outreach — Tanzania",description:"Usimamizi wa supervisors, agents, makanisa na uthibitisho wa mafunzo.",domain:"outreach"}) as Project;
        await load(made.id);setView("supervisors");setNotice("Mradi mpya wa Church Outreach umeundwa. Sasa alika supervisor wa kwanza.");
      }catch(e){setError(msg(e));}finally{setWorking(false);}
    })();
  }
  const tabs:[typeof view,string][]=[["overview","Muhtasari"],["supervisors","Supervisors"],["agents","Agents"],["churches","Churches"],["tasks","Kazi za kesho"],["reports","Ripoti & picha"],["invites","Mialiko & codes"]];
  return <main style={st.page}><div style={st.wrap}>
    <header style={{display:"flex",gap:15,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",marginBottom:18}}>
      <div><span style={{fontSize:11,letterSpacing:2,color:"#f0c976"}}>UVUMBUZI LAB / SYSTEM ADMIN EYE</span><h1 style={{fontSize:30,margin:"4px 0"}}>Agent Operations Center</h1><p style={{...st.sub,margin:0}}>Uendeshaji wa miradi ya Lab kwa ruhusa za Kristo · Preview</p></div>
      <div style={{display:"flex",gap:9,flexWrap:"wrap"}}><button type="button" onClick={startOutreachCampaign} disabled={working||loading||!viewer} style={st.gold}>+ Church Outreach Project</button><a href="/uvumbuzi" style={{...st.dark,textDecoration:"none"}}>← Miradi yangu</a><button style={st.dark} disabled={working||loading} onClick={()=>{void load(selected).catch(e=>setError(msg(e)));}}>↻ Sasisha</button></div>
    </header>
    {loading?<div style={st.panel}>Ninathibitisha akaunti na ruhusa za mradi…</div>:null}
    {error?<div role="alert" style={{...st.panel,borderColor:"#b96f77",color:"#ffd9db",marginBottom:12}}>{error} {error.includes("Session")?<a href="/sign-in" style={{color:"#f3c978"}}>Ingia tena</a>:null}</div>:null}
    {notice?<div role="status" style={{...st.panel,borderColor:"#488d71",color:"#c1f7dc",marginBottom:12}}>{notice}</div>:null}
    {!loading&&viewer&&projects.length===0?<section style={st.panel}><h2>Hakuna mradi wenye ruhusa ya usimamizi</h2><p style={st.sub}>Hii ni System Admin ya Church Outreach pekee. Bonyeza + Church Outreach Project ili kuanza; miradi ya maabara haionyeshwi hapa.</p><a href="/uvumbuzi" style={st.dark}>Fungua Miradi</a></section>:null}
    {history&&current&&<div>
      <section style={{...st.panel,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:12}}>
        <div><small style={{color:"#a5cbe5"}}>ACTIVE PROJECT</small><div style={{fontSize:17,fontWeight:800}}>{current.name}</div><div style={st.sub}>Kristo: {viewer?.kristoId||"Haijaoneshwa"} · Role: <b>{history.role}</b> · Admin hii haioni miradi ya watu wengine</div></div>
        <select aria-label="Chagua mradi" style={{...st.field,maxWidth:360}} value={selected} onChange={e=>changeProject(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select>
      </section>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10,marginBottom:13}}>
        {[[String(operations?.supervisors.length||0),"Supervisors"],[String(operations?.agents.length||0),"Agents"],[String(confirmed.length),"Churches confirmed"],[String(outreach.filter(c=>c.status==="pending").length),"Churches pending"],[String(tomorrow.length),"Kazi za kesho"],[String(awaiting.length),"Ripoti za kukagua"],[String(reports.length),"Ripoti zote"],[String(activeCodes.length),"Codes hai"]].map(([n,label])=><div key={label} style={{...st.panel,padding:16}}><div style={{fontSize:27,fontWeight:850,color:"#f5c97c"}}>{n}</div><div style={st.sub}>{label}</div></div>)}
      </div>
      <nav aria-label="Admin tools" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>{tabs.map(([k,name])=><button key={k} type="button" aria-pressed={view===k} onClick={()=>setView(k)} style={view===k?st.gold:st.dark}>{name}</button>)}</nav>
      {view==="overview"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:13}}>
        <section style={st.panel}><h2 style={{marginTop:0}}>Ufuatiliaji wa kazi za kesho</h2>{tomorrow.length===0?<p style={st.sub}>Hakuna kazi iliyopangiwa tarehe ya kesho. Nenda Kazi za kesho kuigawa.</p>:tomorrow.map(t=><div key={t.id} className="taskRow" style={{borderBottom:"1px solid #32516a",padding:"10px 0"}}><strong>{t.title}</strong><div style={st.sub}>{display(t.assigneeSubject)} · {t.status}</div></div>)}<button style={{...st.dark,marginTop:12}} onClick={()=>setView("tasks")}>Gawa kazi →</button></section>
        <section style={st.panel}><h2 style={{marginTop:0}}>Ripoti zinazohitaji ukaguzi</h2>{awaiting.length===0?<p style={st.sub}>Hakuna ripoti inayosubiri maamuzi.</p>:awaiting.map(t=><div key={t.id} style={{padding:"11px 0",borderBottom:"1px solid #32516a"}}><b>{t.title}</b><div style={st.sub}>{display(t.assigneeSubject)} · Inasubiri ukaguzi</div></div>)}<button style={{...st.dark,marginTop:12}} onClick={()=>setView("reports")}>Tazama ripoti & picha →</button></section>
      </div>}

      {view==="supervisors"&&<section style={st.panel}><h2 style={{marginTop:0}}>Supervisors wa mradi</h2>
        <p style={st.sub}>Mmiliki atengeneze Supervisor Code na aitume kwa mtu aliyeingia Kristo. Supervisor ataweza kuwaalika agents kwa codes zake pekee.</p>
        {!operations?.supervisors.length?<p style={st.sub}>Hakuna supervisor aliyejiunga bado.</p>:operations.supervisors.map(sv=><div key={sv.subject} style={{padding:"12px 0",borderBottom:"1px solid #335a7c"}}><b>{display(sv.subject)}</b><div style={st.sub}>Agents: {sv.agentsUsed}/{sv.maxAgents} · Church submissions: {outreach.filter(x=>x.supervisorSubject===sv.subject).length} · {timeStamp(sv.createdAt)}</div>
          {owner?<div style={{display:"flex",gap:9,alignItems:"center",marginTop:10,flexWrap:"wrap"}}>
            <label style={st.label}>Agent limit <input aria-label={"Agent limit for "+display(sv.subject)} style={{...st.field,width:94,marginLeft:8}} type="number" min={1} max={100} value={capEdit[sv.subject]??String(sv.maxAgents)} onChange={e=>setCapEdit(v=>({...v,[sv.subject]:e.target.value}))}/></label>
            <button style={st.dark} disabled={working} onClick={()=>saveSupervisorCap(sv.subject)}>Hifadhi limit</button>
          </div>:null}</div>)}
        {owner?<button style={{...st.gold,marginTop:12}} onClick={()=>{setCodeRole("supervisor");setView("invites");}}>+ Invite Supervisor</button>:null}
      </section>}
      {view==="churches"&&<section style={st.panel}><h2 style={{marginTop:0}}>Church outreach & uthibitisho</h2><p style={st.sub}>Agent huingiza Church ID na Kristo ID ya mwakilishi aliyefundishwa; jibu la mwakilishi ndilo linalotofautisha confirmed, needs follow-up au declined. Church ID yenyewe bado haijathibitishwa dhidi ya registry ya Kristo.</p>
        {!outreach.length?<p style={st.sub}>Hakuna church iliyowasilishwa bado.</p>:outreach.map(o=><article key={o.id} style={{border:"1px solid #3c6283",borderRadius:12,background:"#081c30",padding:14,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><strong>Church ID: {o.churchId}</strong><b style={{color:o.status==="confirmed"?"#8eeac3":"#f5cd82"}}>{o.status}</b></div>
          <p style={st.sub}>Church Kristo ID: {display(o.churchPersonSubject)} · Agent: {display(o.agentSubject)} · Supervisor: {display(o.supervisorSubject)}</p>
          <p style={st.sub}>Imeingizwa: {timeStamp(o.createdAt)} · Jibu: {o.respondedAt?timeStamp(o.respondedAt):"Pending"}</p>
          {o.note?<p style={{whiteSpace:"pre-wrap"}}>Maelezo ya agent: {o.note}</p>:null}
          {o.status!=="pending"?<p style={{whiteSpace:"pre-wrap"}}>Alifundishwa: {o.trained===1?"Ndiyo":"Hapana"} · Alielewa: {o.understood===1?"Ndiyo":"Hapana"} {o.responseNote?"· "+o.responseNote:""}</p>:<p style={st.sub}>Barua ya kuthibitisha iko kwenye akaunti ya Kristo ya mtu aliyetajwa.</p>}
        </article>)}
      </section>}
      {view==="agents"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:13}}>
        <section style={st.panel}><h2 style={{marginTop:0}}>Wafanyakazi / Agents ({operations?.agents.length||0})</h2><p style={st.sub}>Watu waliopewa ruhusa kwenye mradi huu; jina la agent linaoneshwa kwa Kristo ID inayopatikana.</p>
          {!operations?.agents.length?<p style={st.sub}>Hakuna agent wa code bado.</p>:operations.agents.map(m=><div key={m.agentSubject} style={{borderBottom:"1px solid #32516a",padding:"11px 0",display:"flex",gap:12,alignItems:"center"}}><div style={{borderRadius:"50%",background:"#134c75",padding:12}}>♙</div><div><strong>{display(m.agentSubject)}</strong><div style={st.sub}>Supervisor: {display(m.supervisorSubject)} · {timeStamp(m.enrolledAt)}</div></div></div>)}
        </section>
        <section style={st.panel}><h2 style={{marginTop:0}}>Alika kwa Kristo ID</h2><p style={st.sub}>Wamiliki pekee wanaweza kuongeza washiriki bila code.</p>{owner?<form onSubmit={inviteById}><label htmlFor="person" style={st.label}>Kristo ID</label><input id="person" style={st.field} required placeholder="KR7-12345AB" value={inviteKristoId} maxLength={24} onChange={e=>setInviteKristoId(e.target.value)}/><button disabled={working} style={{...st.gold,marginTop:12}} type="submit">Alika agent</button></form>:<p style={st.sub}>Wewe ni leader, mwombe owner atoe code.</p>}</section>
      </div>}
      {view==="tasks"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(350px,1fr))",gap:13}}>
        <section style={st.panel}><h2 style={{marginTop:0}}>Gawa kazi za kesho</h2>{permitted?<form onSubmit={createTask} style={{display:"grid",gap:12}}>
          <div><label style={st.label} htmlFor="task-title">Jina la kazi</label><input id="task-title" style={st.field} required maxLength={200} placeholder="Mfano: Tembelea taasisi 3" value={taskTitle} onChange={e=>setTaskTitle(e.target.value)}/></div>
          <div><label style={st.label} htmlFor="agent-select">Agent</label><select id="agent-select" style={st.field} required value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Chagua agent</option>{(operations?.agents||[]).map(m=><option value={m.agentSubject} key={m.agentSubject}>{display(m.agentSubject)}</option>)}</select></div>
          <div><label style={st.label} htmlFor="due">Tarehe ya kazi (local)</label><input id="due" style={st.field} type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
          <div><label style={st.label} htmlFor="instructions">Maelekezo</label><textarea id="instructions" rows={4} style={st.field} value={taskDetails} maxLength={5000} onChange={e=>setTaskDetails(e.target.value)} placeholder="Andika lengo na ripoti inayotakiwa."/></div>
          <button disabled={working||!memberIds.length} style={st.gold} type="submit">Tuma kazi kwa agent</button><p style={st.sub}>Kazi inahifadhiwa kwenye Lab. Hakuna notification ya simu inayotumwa moja kwa moja bado.</p>
        </form>:<p style={st.sub}>Huna ruhusa ya kugawa kazi.</p>}</section>
        <section style={st.panel}><h2 style={{marginTop:0}}>Kazi zilizogawiwa ({tasks.length})</h2>{tasks.length===0?<p style={st.sub}>Bado hakuna kazi.</p>:tasks.map(t=><div key={t.id} style={{padding:"12px 0",borderBottom:"1px solid #34546c"}}><strong>{t.title}</strong><div style={st.sub}>{display(t.assigneeSubject)} · {t.dueDate||"Bila tarehe"} · {t.status}</div>{t.details?<p style={st.sub}>{t.details}</p>:null}</div>)}</section>
      </div>}
      {view==="reports"&&<section style={st.panel}><h2 style={{marginTop:0}}>Ripoti na ushahidi wa agent</h2>
        <p style={st.sub}>Picha zinafunguliwa kwa link za HTTPS zilizotumwa na agent mwenyewe. Usichukulie ushahidi kuwa umethibitishwa hadi uukague.</p>
        {!reports.length?<p style={st.sub}>Bado hakuna ripoti zilizowasilishwa.</p>:reports.map(r=>{const photo=safePhoto(r.evidenceUrl);const pending=r.task.status==="submitted"&&r.task.reports?.at(-1)?.id===r.id;return <article key={r.id} style={{border:"1px solid #345775",borderRadius:12,padding:16,marginBottom:12,background:"#08182a"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:9,flexWrap:"wrap"}}><b>{r.task.title}</b><span style={{color:"#e6c174"}}>{r.task.status}</span></div>
          <div style={st.sub}>{display(r.task.assigneeSubject)} · {timeStamp(r.createdAt)}</div>
          <p style={{lineHeight:1.7,whiteSpace:"pre-wrap"}}>{r.note}</p>
          {photo?<a href={photo} target="_blank" rel="noopener noreferrer" style={{...st.dark,display:"inline-block"}}>↗ Fungua picha / ushahidi</a>:null}
          {pending&&permitted&&<div style={{display:"flex",gap:10,marginTop:14}}><button style={st.gold} disabled={working} onClick={()=>decide(r.task,"approved")}>Kubali ripoti</button><button style={st.dark} disabled={working} onClick={()=>decide(r.task,"changes_requested")}>Omba marekebisho</button></div>}
        </article>})}
      </section>}
      {view==="invites"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(350px,1fr))",gap:13}}>
        <section style={st.panel}><h2 style={{marginTop:0}}>Unda Agent Code</h2><p style={st.sub}>Code hutumika mara moja tu na inaisha baada ya siku 7. Anayeitumia lazima awe ameingia kwa Kristo. Haimpi ruhusa ya admin.</p>
          {permitted?<form onSubmit={createCode}>{owner?<><label htmlFor="code-role" style={st.label}>Aina ya mwaliko</label><select id="code-role" style={{...st.field,marginBottom:10}} value={codeRole} onChange={e=>setCodeRole(e.target.value as "supervisor"|"agent")}><option value="supervisor">Supervisor</option><option value="agent">Agent</option></select></>:<p style={st.sub}>Wewe supervisor unaweza kutoa code za agent wako tu.</p>}<label style={st.label} htmlFor="code-kristo-id">Kristo ID ya anayealikwa {owner&&codeRole==="supervisor"?"(lazima)":"(hiari)"}</label>
<input id="code-kristo-id" style={{...st.field,marginBottom:12}} value={codeKristoId} onChange={e=>setCodeKristoId(e.target.value)} required={owner&&codeRole==="supervisor"} placeholder="KR7-12345AB" maxLength={24}/>
{owner&&codeRole==="supervisor"?<><label style={st.label} htmlFor="limit-new">Agent limit ya supervisor huyu</label>
<input id="limit-new" type="number" min={1} max={100} required style={{...st.field,marginBottom:12}} value={codeMaxAgents} onChange={e=>setCodeMaxAgents(Number(e.target.value))}/></>:null}
<label style={st.label} htmlFor="code-label">Jina la code / kundi (hiari)</label><input id="code-label" style={st.field} maxLength={120} placeholder="Mfano: Agent Tanzania 01" value={codeLabel} onChange={e=>setCodeLabel(e.target.value)}/><button style={{...st.gold,marginTop:12}} disabled={working} type="submit">Tengeneza code mpya</button></form>:<p style={st.sub}>Code inahitaji ruhusa ya owner au supervisor.</p>}
          {code?<div role="status" style={{marginTop:15,padding:15,border:"1px solid #b69956",borderRadius:11}}><div style={st.sub}>CODE — nakili sasa. Haitaoneshwa tena.</div><strong style={{fontSize:18,letterSpacing:1.1,wordBreak:"break-all"}}>{code}</strong><br/><button style={{...st.dark,marginTop:12}} type="button" onClick={()=>{void navigator.clipboard?.writeText(code).then(()=>setNotice("Code imenakiliwa."),()=>setError("Chagua na nakili code kwa mkono."));}}>Nakili code</button><p style={st.sub}>Mtumie mhusika aliyealikwa <a href="/uvumbuzi/join" style={{color:"#efc875"}}>/uvumbuzi/join</a> ili kuitumia.</p></div>:null}
        </section>
        <section style={st.panel}><h2 style={{marginTop:0}}>Codes zilizotolewa ({invites.length})</h2><p style={st.sub}>Kwa usalama, code kamili haihifadhiwi hapa; mwisho wake tu ndio unaooneshwa.</p>{invites.length===0?<p style={st.sub}>Hakuna code iliyotolewa.</p>:invites.map(c=><div key={c.id} style={{padding:"10px 0",borderBottom:"1px solid #36556d"}}><b>{c.label||"Agent invitation"} · …{c.codeSuffix}</b><div style={st.sub}>{c.redeemedAt?"Imetumika":Date.parse(c.expiresAt)<=Date.now()?"Imeisha muda":"Inasubiri agent"} · Mwisho {timeStamp(c.expiresAt)}</div></div>)}</section>
      </div>}
      <footer style={{marginTop:22,...st.sub}}>Hii ni Admin ya miradi ya Uvumbuzi Lab pekee. Haina ruhusa ya kubadilisha Kristo App Production, akaunti za wengine, au data za simulator.</footer>
    </div>}
  </div></main>;
}
