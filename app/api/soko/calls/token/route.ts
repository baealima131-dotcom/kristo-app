import {NextRequest,NextResponse} from 'next/server';
import {AccessToken} from 'livekit-server-sdk';
import {guardCheckoutAuth} from '@/app/api/_lib/rbac';
import {getPrivateCallSession} from '@/app/api/_lib/privateCallSessions';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;
 const body=await req.json().catch(()=>({}));
 const session=await getPrivateCallSession(String(body?.callId||''));
 if(!session||session.pastorSourceField!=='soko-purchase-call'||![session.callerUserId,session.pastorUserId].includes(auth.viewer.userId))return NextResponse.json({ok:false,error:'Call unavailable.'},{status:403});
 if(session.status!=='accepted')return NextResponse.json({ok:false,error:'This call is not active.'},{status:409});
 const key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET,url=process.env.LIVEKIT_URL;
 if(!key||!secret||!url)return NextResponse.json({ok:false,error:'Voice service is not configured.'},{status:503});
 const token=new AccessToken(key,secret,{identity:auth.viewer.userId,ttl:'5m'});
 token.addGrant({room:session.roomName,roomJoin:true,canSubscribe:true,canPublish:true,canPublishData:false,canPublishSources:[/* microphone */ 2]});
 return NextResponse.json({ok:true,url,token:await token.toJwt()},{headers:{'Cache-Control':'private, no-store'}});
}
