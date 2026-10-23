import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  uvumbuziLab,
  type LabProjectSummary, type LabOperations, type LabConfirmation,
} from "@/src/lib/uvumbuziLabApi";

const C = { bg: "#071121",surface:"#11223E",line:"#5674A2",gold:"#F4D07C",text:"#F8F5F8",muted:"#B7BED5",violet:"#9587D5",green:"#7CE0BC" };
type ScreenTab = "church"|"team"|"letters"|"join";
const names:Record<ScreenTab,string>={church:"Church Visit",team:"My Agents",letters:"My Letters",join:"Join Team"};

export default function ChurchOutreachScreen(){
  const router=useRouter();
  const insets=useSafeAreaInsets();
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [tab,setTab]=useState<ScreenTab>("church");
  const [projects,setProjects]=useState<LabProjectSummary[]>([]);
  const [projectId,setProjectId]=useState("");
  const [operations,setOperations]=useState<LabOperations|null>(null);
  const [letters,setLetters]=useState<LabConfirmation[]>([]);
  const [churchId,setChurchId]=useState("");
  const [kristoId,setKristoId]=useState("");
  const [note,setNote]=useState("");
  const [inviteCode,setInviteCode]=useState("");
  const [newCode,setNewCode]=useState("");
  const [agentLabel,setAgentLabel]=useState("");
  const [agentKristoId,setAgentKristoId]=useState("");
  const [answers,setAnswers]=useState<Record<string,{trained?:boolean;understood?:boolean;note:string}>>({});
  const active=projects.find(p=>p.id===projectId);
  const isLeader=active?.role==="owner"||active?.role==="leader";
  const ops=operations;
  const load=useCallback(async(prefer?:string)=>{
    const [me,confirm]=await Promise.all([uvumbuziLab.me(),uvumbuziLab.confirmations()]);
    if(!me.ok)throw Error(me.error);
    const campaigns=(me.data.projects||[]).filter(p=>p.domain==="outreach");
    setProjects(campaigns);
    const id=prefer&&campaigns.some(p=>p.id===prefer)?prefer:campaigns[0]?.id||"";
    setProjectId(id);
    if(confirm.ok)setLetters(confirm.data);
    if(id&&campaigns.find(p=>p.id===id)?.role!=="member"){
      const response=await uvumbuziLab.outreachOperations(id);
      if(response.ok)setOperations(response.data);else setOperations(null);
    }else setOperations(null);
  },[]);
  useFocusEffect(useCallback(()=>{
    let active=true;setLoading(true);
    void load().catch(e=>{if(active)setError(e instanceof Error?e.message:"Could not load.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[load]));
  const reload=async()=>{setRefreshing(true);try{await load(projectId);}catch(e){setError(e instanceof Error?e.message:"Could not load.");}finally{setRefreshing(false);}};
  const act=async(fn:()=>Promise<{ok:true;data:any}|{ok:false;error:string}>,message:string)=>{
    if(busy)return;setBusy(true);setError("");setSuccess("");
    try{const result=await fn();if(!result.ok)throw Error(result.error);setSuccess(message);await load(projectId);return result.data;}
    catch(e){setError(e instanceof Error?e.message:"Request failed.");}
    finally{setBusy(false);}
    return null;
  };
  const record=async()=>{
    if(!projectId){setError("Join an outreach project first.");return;}
    if(!churchId.trim()||!kristoId.trim()){setError("Enter Church ID and Kristo ID.");return;}
    const done=await act(()=>uvumbuziLab.recordChurchVisit(projectId,churchId.trim().toUpperCase(),kristoId.trim().toUpperCase(),note.trim()),
      "Verification letter queued for the Kristo account you entered. Awaiting the person's answer.");
    if(done){setChurchId("");setKristoId("");setNote("");}
  };
  const join=async()=>{
    const normalized=inviteCode.trim().toUpperCase();
    if(!/^UVA-([0-9A-F]{6}-){3}[0-9A-F]{6}$/.test(normalized)){setError("Invitation code is incomplete.");return;}
    const data=await act(()=>uvumbuziLab.redeemInvite(normalized),"You joined the assigned church outreach team.");
    if(data){setInviteCode("");setTab(data.programRole==="supervisor"?"team":"church");await load(data.projectId);}
  };
  const generate=async()=>{
    if(!projectId)return;
    const data=await act(()=>uvumbuziLab.createInvite(projectId,"agent",agentLabel.trim(),agentKristoId.trim().toUpperCase()||undefined),
      "One-time agent code generated. Share it privately.");
    if(data?.code){setNewCode(data.code);setAgentLabel("");setAgentKristoId("");}
  };
  const respond=async(letter:LabConfirmation)=>{
    const a=answers[letter.id];
    if(a?.trained===undefined||a?.understood===undefined){setError("Answer both questions first.");return;}
    const done=await act(()=>uvumbuziLab.answerConfirmation(letter.id,a.trained!,a.understood!,a.note.trim()),
      "Your answer has reached the project operations dashboard.");
    if(done)setAnswers(prev=>{const n={...prev};delete n[letter.id];return n;});
  };
  const setAnswer=(id:string,partial:Partial<{trained:boolean;understood:boolean;note:string}>)=>
    setAnswers(v=>({...v,[id]:{...{note:""},...v[id],...partial}}));
  const validInbox=letters.filter(l=>l.status==="pending");
  const field=(label:string,value:string,fn:(s:string)=>void,placeholder:string,opts?:{multiline?:boolean;numeric?:boolean;upper?:boolean})=>
    <View style={{gap:7}}><Text style={styles.label}>{label}</Text><TextInput
      style={[styles.input,opts?.multiline&&{minHeight:85,textAlignVertical:"top"}]} value={value} onChangeText={fn}
      placeholder={placeholder} placeholderTextColor="#9CA7BF" multiline={!!opts?.multiline}
      maxLength={opts?.multiline?1000:64} keyboardType={opts?.numeric?"number-pad":"default"}
      autoCapitalize={opts?.upper?"characters":"none"} autoCorrect={false}/></View>;
  const action=(title:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={busy||disabled} onPress={onPress}
    style={[styles.action,(busy||disabled)&&{opacity:.45}]}><Text style={styles.actionText}>{title}</Text><Ionicons name="arrow-forward" size={17} color="#151626"/></Pressable>;

  return <View style={[styles.screen,{paddingTop:insets.top+12}]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={()=>router.back()} style={styles.back}><Ionicons name="chevron-back" size={25} color={C.text}/></Pressable>
      <View style={{flex:1}}><Text style={styles.overline}>KRISTO ECOSYSTEM · LAB OPERATIONS</Text><Text style={styles.title}>Church Outreach</Text></View>
      <View style={styles.status}><Ionicons name="people" size={22} color={C.gold}/></View>
    </View>
    <View style={styles.tabs}>{(["church","team","letters","join"] as ScreenTab[]).map(t=>
      <Pressable key={t} onPress={()=>{setTab(t);setError("");}} style={[styles.tab,t===tab&&styles.tabOn]}>
        <Text style={[styles.tabText,t===tab&&{color:"#172033"}]}>{names[t]}</Text>
        {t==="letters"&&validInbox.length>0&&<Text style={styles.count}>{validInbox.length}</Text>}
      </Pressable>)}</View>
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void reload()} tintColor={C.gold}/>}
      contentContainerStyle={{padding:16,paddingBottom:insets.bottom+34,gap:14}}>
      {loading&&<ActivityIndicator color={C.gold} size="large"/>}
      {!!error&&<View style={[styles.panel,{borderColor:"#D98B8C"}]}><Text style={{color:"#FFD3D4"}}>{error}</Text></View>}
      {!!success&&<View style={[styles.panel,{borderColor:C.green}]}><Text style={{color:"#C9FFE9"}}>{success}</Text></View>}
      {!loading&&<>
        {projects.length>0&&<View style={styles.panel}>
          <Text style={styles.label}>My outreach campaign</Text>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:10}}>{projects.map(p=>
            <Pressable accessibilityRole="button" key={p.id} onPress={()=>{setProjectId(p.id);setError("");void load(p.id).catch(e=>setError(e instanceof Error?e.message:"Could not switch project."));}}
              style={[styles.project,p.id===projectId&&{borderColor:C.gold}]}>
              <Text style={{color:p.id===projectId?C.gold:C.text,fontWeight:"700"}} numberOfLines={1}>{p.name}</Text>
            </Pressable>)}</View>
          <Text style={styles.small}>Role: {active?.role||"Not linked"} · Access comes from your Kristo account.</Text>
        </View>}
        {tab==="church"&&<>
          <View style={styles.panel}><Text style={styles.sectionTitle}>Help a Church</Text>
            <Pressable accessibilityRole="button" onPress={()=>router.push("/more/church" as any)}
              style={[styles.action,{backgroundColor:"#4E3D7C"}]}>
              <Text style={[styles.actionText,{color:"#F6E7FF"}]}>Open Church · Create / Find / Join</Text>
              <Ionicons name="arrow-forward" size={17} color="#F6E7FF"/>
            </Pressable>
            <Text style={styles.body}>After teaching someone to register or use Kristo App, enter the Church ID and the Kristo ID of the person you helped. They must verify this inside their own Kristo account.</Text>
            {projects.length===0?<Text style={styles.body}>Join the team using an invitation code first.</Text>:<View style={styles.form}>
              {field("Church ID",churchId,setChurchId,"Church ID", {upper:true})}
              {field("Kristo ID of the person you helped",kristoId,setKristoId,"KR7-12345AB",{upper:true})}
              {field("What did you explain?",note,setNote,"Brief, truthful description of your visit",{multiline:true})}
              {action("Request Church Confirmation",()=>void record(),!churchId.trim()||!kristoId.trim())}
              <Text style={styles.small}>Not counted as successful until the recipient confirms. Church ID ownership is not yet registry-verified.</Text>
            </View>}
          </View>
        </>}
        {tab==="team"&&<View style={styles.panel}>
          <Text style={styles.sectionTitle}>Supervisor · My Agents</Text>
          {!isLeader?<Text style={styles.body}>Only invited supervisors and the project owner can invite agents. Join using your supervisor code.</Text>:<>
            <Text style={styles.body}>Agents under your invitation: {ops?.agents.length??0}. Limits are set by the system owner on the web dashboard.</Text>
            {(ops?.supervisors||[]).filter(s=>active?.role!=="leader"||s.subject===undefined||ops.role==="leader").map(s=>
              <View key={s.subject} style={styles.agentRow}><Text style={styles.body}>Supervisor: {ops?.people?.[s.subject]?.kristoId||"Kristo verified"}</Text>
                <Text style={styles.small}>Agents {s.agentsUsed}/{s.maxAgents}</Text></View>)}
            {(ops?.agents||[]).map(a=><View key={a.agentSubject} style={styles.agentRow}>
              <Ionicons name="person-circle-outline" size={23} color={C.gold}/>
              <View style={{flex:1}}><Text style={styles.body}>{ops?.people?.[a.agentSubject]?.kristoId||"Linked agent"}</Text>
                <Text style={styles.small}>Church reports: {(ops?.claims||[]).filter(c=>c.agentSubject===a.agentSubject).length}</Text></View>
              </View>)}
            <Text style={[styles.sectionTitle,{fontSize:17,marginTop:14}]}>Invite an Agent</Text>
            <View style={styles.form}>
              {field("Agent label (optional)",agentLabel,setAgentLabel,"Agent 01")}
              {field("Agent Kristo ID (recommended)",agentKristoId,setAgentKristoId,"KR7-12345AB",{upper:true})}
              {action("Generate one-time agent code",()=>void generate())}
              {!!newCode&&<View style={[styles.panel,{backgroundColor:"#221F41"}]}>
                <Text style={styles.label}>Copy and share privately — visible this one time</Text>
                <Text selectable style={{color:C.gold,fontSize:19,fontWeight:"900",letterSpacing:1.1,marginTop:7}}>{newCode}</Text>
                <Text style={styles.small}>The agent enters this code under Join Team. Default validity: seven days.</Text>
              </View>}
            </View>
          </>}
        </View>}
        {tab==="letters"&&<View style={styles.panel}>
          <Text style={styles.sectionTitle}>Confirm a Church Visit</Text>
          <Text style={styles.body}>Only the Kristo account named by the agent receives this private verification letter.</Text>
          {letters.length===0&&<Text style={styles.small}>No letters yet.</Text>}
          {letters.map(l=><View key={l.id} style={styles.letter}>
            <Text style={styles.sectionTitle}>{l.churchId}</Text><Text style={styles.small}>{l.projectName} · {l.status}</Text>
            <Text style={styles.body}>{l.note||"An agent reported helping you with this church."}</Text>
            {l.status==="pending"?<View style={styles.form}>
              <Text style={styles.label}>Did this agent actually teach or help you?</Text>
              <View style={styles.choice}>{(["Yes","No"] as const).map(t=><Pressable key={t}
                style={[styles.choiceButton,answers[l.id]?.trained===(t==="Yes")&&styles.choiceOn]}
                onPress={()=>setAnswer(l.id,{trained:t==="Yes"})}><Text style={styles.body}>{t}</Text></Pressable>)}</View>
              <Text style={styles.label}>Do you understand how to use Kristo App now?</Text>
              <View style={styles.choice}>{(["Yes","Not yet"] as const).map(t=><Pressable key={t}
                style={[styles.choiceButton,answers[l.id]?.understood===(t==="Yes")&&styles.choiceOn]}
                onPress={()=>setAnswer(l.id,{understood:t==="Yes"})}><Text style={styles.body}>{t}</Text></Pressable>)}</View>
              {field("Optional message",answers[l.id]?.note||"",v=>setAnswer(l.id,{note:v}),"What else do you need?",{multiline:true})}
              {action("Send my answer",()=>void respond(l),answers[l.id]?.trained===undefined||answers[l.id]?.understood===undefined)}
            </View>:<Text style={styles.small}>Response already recorded. You cannot answer twice.</Text>}
          </View>)}
        </View>}
        {tab==="join"&&<View style={styles.panel}><Text style={styles.sectionTitle}>Join a Supervisor or Agent Team</Text>
          <Text style={styles.body}>Enter the invitation code issued for your Kristo account. You can only use a code once.</Text>
          <View style={styles.form}>{field("Invitation code",inviteCode,setInviteCode,"UVA-XXXXXX-XXXXXX-XXXXXX-XXXXXX",{upper:true})}
            {action("Join Team",()=>void join(),!inviteCode.trim())}</View>
          <Text style={styles.small}>A supervisor may add agents only within the capacity assigned by the System Admin. An agent cannot become an admin with an agent code.</Text>
        </View>}
      </>}
    </ScrollView>
  </View>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:C.bg},
  header:{flexDirection:"row",gap:12,alignItems:"center",paddingHorizontal:16,paddingBottom:17},
  back:{height:42,width:42,borderRadius:13,borderWidth:1,borderColor:C.line,justifyContent:"center",alignItems:"center"},
  overline:{fontSize:9,letterSpacing:1.5,color:C.gold,fontWeight:"700"},
  title:{fontSize:27,color:C.text,fontWeight:"800",marginTop:3},
  status:{height:44,width:44,borderRadius:15,backgroundColor:"#342B4F",alignItems:"center",justifyContent:"center"},
  tabs:{flexDirection:"row",paddingHorizontal:10,paddingBottom:11,gap:5},
  tab:{flex:1,alignItems:"center",justifyContent:"center",paddingVertical:10,paddingHorizontal:3,borderRadius:10,backgroundColor:"#182541",minHeight:43},
  tabOn:{backgroundColor:C.gold},
  tabText:{fontSize:10,color:C.muted,fontWeight:"800",textAlign:"center"},
  count:{position:"absolute",top:0,right:3,fontSize:9,color:C.gold,fontWeight:"800"},
  panel:{padding:19,backgroundColor:C.surface,borderColor:"#495E8C",borderWidth:1,borderRadius:20,gap:11},
  sectionTitle:{fontSize:20,color:C.text,fontWeight:"800"},
  body:{fontSize:13,color:"#D5DBE8",lineHeight:21},
  small:{fontSize:11,color:C.muted,lineHeight:17},
  label:{fontSize:12,color:"#E6DEEF",fontWeight:"700"},
  form:{gap:15,marginTop:8},
  input:{backgroundColor:"#09182E",borderColor:"#627CAC",borderWidth:1,borderRadius:11,padding:13,color:"white",fontSize:15},
  action:{borderRadius:11,padding:14,backgroundColor:C.gold,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  actionText:{color:"#1D2231",fontWeight:"900",fontSize:13},
  project:{paddingVertical:9,paddingHorizontal:12,borderRadius:9,borderWidth:1,borderColor:C.line},
  letter:{borderWidth:1,borderColor:"#3D5D86",borderRadius:14,padding:13,gap:10},
  choice:{flexDirection:"row",gap:9},
  choiceButton:{borderWidth:1,borderColor:C.line,borderRadius:10,paddingVertical:10,paddingHorizontal:18},
  choiceOn:{backgroundColor:"#2D5770",borderColor:C.gold},
  agentRow:{flexDirection:"row",gap:10,alignItems:"center",borderBottomWidth:1,borderBottomColor:"#304765",paddingVertical:10},
  pillText:{fontSize:11,fontWeight:"600",color:C.gold},
});
