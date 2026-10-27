import {zporaPushTokens,deleteZporaPushDevice} from './store/zporaPushDb';
import type {PrivateCallSession} from './privateCallSessions';
export async function notifyZporaCallPush(session:PrivateCallSession,title:string){
 if(session.pastorSourceField!=='soko-purchase-call')return;
 const tokens=await zporaPushTokens(session.pastorUserId);
 if(!tokens.length)return;
 const response=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json',...(process.env.EXPO_PUSH_ACCESS_TOKEN?{Authorization:`Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`}:{})},body:JSON.stringify(tokens.map(to=>({to,title,body:'Open Zpora to answer this purchase call.',sound:'default',priority:'high',channelId:'purchase-calls',ttl:Math.max(0,Math.floor((Date.parse(session.ringExpiresAt)-Date.now())/1000)),data:{type:'zpora-purchase-call',callId:session.id}}))),signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('Push service unavailable');
 const payload=await response.json();
 const tickets=Array.isArray(payload?.data)?payload.data:[];
 for(let i=0;i<tickets.length;i++){
  if(tickets[i]?.details?.error==='DeviceNotRegistered')await deleteZporaPushDevice(session.pastorUserId,tokens[i]);
  if(tickets[i]?.status==='error')console.warn('ZPORA_CALL_PUSH_REJECTED',{callId:session.id,error:tickets[i]?.details?.error||'Push error'});
 }
}
