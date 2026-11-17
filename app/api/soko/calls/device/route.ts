import {NextRequest,NextResponse} from 'next/server';
import {guardCheckoutAuth} from '@/app/api/_lib/rbac';
import {validExpoPushToken,saveZporaPushDevice,deleteZporaPushDevice} from '@/app/api/_lib/store/zporaPushDb';
export const runtime='nodejs';
async function mutate(req:NextRequest,remove:boolean){
 const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;
 const body=await req.json().catch(()=>({}));const token=String(body?.token||'');
 if(!validExpoPushToken(token))return NextResponse.json({ok:false,error:'Invalid push token.'},{status:400});
 try{if(remove)await deleteZporaPushDevice(auth.viewer.userId,token);else await saveZporaPushDevice(auth.viewer.userId,token);return NextResponse.json({ok:true});}
 catch{return NextResponse.json({ok:false,error:'Could not register notifications.'},{status:503});}
}
export const POST=(req:NextRequest)=>mutate(req,false);
export const DELETE=(req:NextRequest)=>mutate(req,true);
