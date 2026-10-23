"use client";
import {useEffect,useState,type FormEvent,type CSSProperties} from "react";
type Letter={id:string;churchId:string;projectName:string;note:string;status:string;createdAt:string;trained:number|null;understood:number|null;responseNote?:string|null};
const frame:CSSProperties={background:"#0b223a",border:"1px solid #3a7097",borderRadius:16,padding:21};
const btn:CSSProperties={background:"#f1ca7b",color:"#16212d",border:0,borderRadius:9,padding:"12px 17px",fontWeight:800,cursor:"pointer"};
async function request(url:string,body?:object){
 const r=await fetch("/api/uvumbuzi/lab/"+url,{credentials:"same-origin",cache:"no-store",method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(r.status===401?"Ingia Kristo kwanza.":String(j.error||"Ombi limeshindwa."));
 return j;
}
export default function ChurchConfirmation(){
 const [letters,setLetters]=useState<Letter[]>([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const [trained,setTrained]=useState<Record<string,string>>({});const [understood,setUnderstood]=useState<Record<string,string>>({});const [notes,setNotes]=useState<Record<string,string>>({});
 async function refresh(){const out=await request("confirmations");setLetters(Array.isArray(out)?out:[]);}
 useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:"Tatizo la kusoma barua.")).finally(()=>setLoading(false));},[]);
 async function send(e:FormEvent,id:string){e.preventDefault();if(busy)return;setBusy(true);setError("");setNotice("");
 try{if(!["yes","no"].includes(trained[id])||!["yes","no"].includes(understood[id]))throw Error("Jibu maswali yote mawili.");
 await request("confirmations/"+encodeURIComponent(id)+"/respond",{trained:trained[id]==="yes",understood:understood[id]==="yes",note:(notes[id]||"").trim()});
 await refresh();setNotice("Jibu lako limehifadhiwa na sasa linaonekana kwa msimamizi wa mradi.");
 }catch(err){setError(err instanceof Error?err.message:"Jibu limeshindwa.");}finally{setBusy(false);}}
 const pending=letters.filter(l=>l.status==="pending");
 return <main style={{minHeight:"100dvh",padding:"24px 16px 55px",background:"linear-gradient(135deg,#071020,#102c48)",color:"#f5faff",fontFamily:"system-ui,sans-serif"}}>
   <div style={{maxWidth:1000,margin:"0 auto"}}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:20}}><div><small style={{letterSpacing:2,color:"#f3cd7e"}}>KRISTO × UVUMBUZI LAB</small><h1 style={{margin:"5px 0"}}>Barua za Uthibitisho</h1><p style={{color:"#afcbe0",margin:0}}>Thibitisha mwenyewe ikiwa agent alikufundisha na kama ulielewa.</p></div><a style={{color:"#f3cc7d"}} href="/uvumbuzi">← Miradi ya Lab</a></header>
    {loading&&<div style={frame}>Ninasoma barua zako…</div>}
    {error&&<div role="alert" style={{...frame,borderColor:"#cb777c",color:"#ffdad9",marginBottom:10}}>{error} <a href="/sign-in" style={{color:"#f3cc7d"}}>Ingia</a></div>}
    {notice&&<div role="status" style={{...frame,borderColor:"#5aaa87",color:"#c5f6df",marginBottom:10}}>{notice}</div>}
    {!loading&&<div style={{display:"grid",gap:15}}>
      <section style={frame}><b>Barua mpya: {pending.length}</b><p style={{fontSize:13,color:"#acc7da"}}>Barua hizi zinaonekana kwa Kristo ID yako pekee. Agent hawezi kuzijibu kwa niaba yako. Huu ni uthibitisho wa mafunzo, si uthibitisho wa umiliki wa kanisa.</p></section>
      {letters.length===0&&<section style={frame}>Hakuna barua za uthibitisho kwa akaunti yako bado.</section>}
      {letters.map(letter=><article key={letter.id} style={frame}>
        <div style={{display:"flex",gap:14,justifyContent:"space-between",flexWrap:"wrap"}}><div><small style={{color:"#f3cd7e"}}>{letter.projectName}</small><h2 style={{margin:"5px 0"}}>Church ID: {letter.churchId}</h2></div><b style={{color:letter.status==="confirmed"?"#9df0c8":"#eec57d"}}>{letter.status}</b></div>
        <p style={{color:"#c6d8e6",whiteSpace:"pre-wrap"}}>Agent amesema amekusaidia kuanzisha/kutumia Kristo App kwa kanisa hili. Maelezo yake: {letter.note||"Hakuna maelezo ya ziada."}</p>
        <p style={{fontSize:12,color:"#93b8d6"}}>Tarehe ya ombi: {new Date(letter.createdAt).toLocaleString()}</p>
        {letter.status==="pending"?<form onSubmit={e=>{void send(e,letter.id);}} style={{display:"grid",gap:16,maxWidth:650}}>
          <fieldset style={{border:"1px solid #3b6c90",borderRadius:10,padding:13}}><legend>1. Je, agent alikufundisha au kukusaidia kweli?</legend><label style={{marginRight:18}}><input type="radio" required checked={trained[letter.id]==="yes"} onChange={()=>setTrained(v=>({...v,[letter.id]:"yes"}))}/> Ndiyo</label><label><input type="radio" checked={trained[letter.id]==="no"} onChange={()=>setTrained(v=>({...v,[letter.id]:"no"}))}/> Hapana</label></fieldset>
          <fieldset style={{border:"1px solid #3b6c90",borderRadius:10,padding:13}}><legend>2. Je, umeelewa jinsi ya kuitumia Kristo App?</legend><label style={{marginRight:18}}><input type="radio" required checked={understood[letter.id]==="yes"} onChange={()=>setUnderstood(v=>({...v,[letter.id]:"yes"}))}/> Ndiyo</label><label><input type="radio" checked={understood[letter.id]==="no"} onChange={()=>setUnderstood(v=>({...v,[letter.id]:"no"}))}/> Bado</label></fieldset>
          <div><label htmlFor={"note-"+letter.id}>Maoni yako (hiari)</label><textarea id={"note-"+letter.id} maxLength={1000} rows={3} value={notes[letter.id]||""} onChange={e=>setNotes(v=>({...v,[letter.id]:e.target.value}))} style={{display:"block",width:"100%",marginTop:8,padding:12,borderRadius:9,color:"white",background:"#06182a",border:"1px solid #457eac"}} /></div>
          <button type="submit" disabled={busy||!["yes","no"].includes(trained[letter.id])||!["yes","no"].includes(understood[letter.id])} style={btn}>{busy?"Inahifadhi…":"Tuma uthibitisho wangu"}</button>
        </form>:<p style={{color:"#b8d5ea"}}>Majibu yamehifadhiwa. Alifundishwa: {letter.trained===1?"Ndiyo":"Hapana"} · Alielewa: {letter.understood===1?"Ndiyo":"Hapana"}{letter.responseNote?" · "+letter.responseNote:""}</p>}
      </article>)}
    </div>}
   </div>
 </main>;
}
