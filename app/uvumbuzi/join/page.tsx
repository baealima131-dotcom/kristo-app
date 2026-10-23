"use client";
import { useState, type FormEvent, type CSSProperties } from "react";

const panel:CSSProperties={maxWidth:560,margin:"45px auto",padding:28,background:"#0c2138",border:"1px solid #3875a7",borderRadius:20,color:"#f4f8ff"};
const field:CSSProperties={width:"100%",padding:"14px",margin:"11px 0",background:"#061626",color:"white",border:"1px solid #4b799f",borderRadius:9};
const btn:CSSProperties={padding:"13px 18px",borderRadius:9,border:0,background:"#f2c877",fontWeight:800,cursor:"pointer"};
export default function JoinLabAgent(){
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [success,setSuccess]=useState(false);
  const [role,setRole]=useState<"supervisor"|"agent">("agent");
  async function redeem(e:FormEvent){
    e.preventDefault();if(busy)return;
    setBusy(true);setMessage("");
    try {
      const normalized=code.trim().toUpperCase();
      if(!/^UVA-([0-9A-F]{6}-){3}[0-9A-F]{6}$/.test(normalized)){setMessage("Code haijakamilika. Tumia format UVA-XXXXXX-XXXXXX-XXXXXX-XXXXXX.");return;}
      const r=await fetch("/api/uvumbuzi/lab/invitations/redeem",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({code:normalized})});
      const value=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(r.status===401?"Ingia Kristo kwanza.":String(value.error||"Code imekataliwa."));
      setSuccess(true);setRole(value.programRole==="supervisor"?"supervisor":"agent");setCode("");setMessage(value.programRole==="supervisor"?"Umejiunga kama Supervisor. Sasa unaweza kuwaalika agents wako kwa codes.":"Umejiunga kama Agent. Huna ruhusa ya admin.");
    }catch(e){setMessage(e instanceof Error?e.message:"Jaribio halijakamilika.");}
    finally{setBusy(false);}
  }
  return <main style={{minHeight:"100dvh",background:"linear-gradient(135deg,#06101f,#0b2440)",padding:"20px 16px",fontFamily:"system-ui,sans-serif"}}>
    <div style={panel}><div style={{color:"#f4cd7c",fontSize:12,letterSpacing:2}}>KRISTO × UVUMBUZI LAB</div><h1 style={{fontSize:28,marginBottom:8}}>Jiunge na Timu ya Lab</h1>
    <p style={{color:"#b7d1e8",lineHeight:1.7}}>Mmiliki au supervisor akikutumia code ya invitation, ingia Kristo App kwanza, kisha weka code hapa. Code hutumika mara moja na inaisha muda wake.</p>
    {!success?<form onSubmit={redeem}><label htmlFor="code" style={{display:"block",marginTop:24}}>Supervisor / Agent invitation code</label><input id="code" style={field} required autoComplete="off" maxLength={31} value={code} onChange={e=>setCode(e.target.value)} placeholder="UVA-XXXXXX-XXXXXX-XXXXXX-XXXXXX"/><button type="submit" disabled={busy} style={btn}>{busy?"Inathibitisha…":"Tumia Code na Jiunge"}</button></form>:<a href={role==="supervisor"?"/uvumbuzi/admin":"/uvumbuzi/agent"} style={{...btn,display:"inline-block",textDecoration:"none"}}>{role==="supervisor"?"Fungua Supervisor Dashboard →":"Fungua Agent Desk →"}</a>}
    {message?<div role={success?"status":"alert"} style={{marginTop:21,padding:13,borderRadius:10,border:"1px solid #446d89",color:success?"#b7f2d4":"#ffd1ce"}}>{message}</div>:null}
    <p style={{fontSize:12,color:"#91adca",marginTop:26}}>Usitumie password au OTP kama agent code. Hii haimpi mtu ruhusa ya System Admin.</p>
    <a href="/uvumbuzi" style={{color:"#e9cb86"}}>← Rudi kwenye Uvumbuzi Lab</a>
    </div></main>;
}
