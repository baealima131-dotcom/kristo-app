import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { randomUUID,createHash } from 'node:crypto';
import { guardCheckoutAuth } from '@/app/api/_lib/rbac';
import { getDatabaseUrl } from '@/app/api/_lib/store/authDb';
import { getPrivateCallSession } from '@/app/api/_lib/privateCallSessions';
import { dbGetSokoBuyerSellerConversation } from '@/app/api/_lib/store/sokoBuyerSellerChatDb';
import { authorizeSokoConversationAccess } from '@/app/api/_lib/sokoBuyerSellerChatPolicy';
import { readSellerBlocks } from '@/app/api/_lib/store/sokoSellerBlocksDb';
import { sanitizeSokoCatalogProduct } from '@/app/api/_lib/sokoPublicCatalog';
import { listSokoProducts } from '@/app/api/_lib/store/sokoProductsDb';
import { inspectSokoProductImageUpload } from '@/app/api/_lib/sokoSellerProductImagePolicy';
import { uploadBufferToStorage } from '@/app/api/_lib/media/objectStorage';
import {createSokoOrder,updateSokoOrder,listSokoOrders,saveSokoPaymentProof,getSokoPaymentProof} from '@/app/api/_lib/store/sokoOrdersDb';
import {getProfile} from '@/app/api/auth/_lib/profile';
import {assertLivePaymentAction} from '@/app/api/_lib/liveStorePaymentPolicy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type State={shownProductIds?:string[];buyerDecision?:{productId:string;decision:string};checkout?:{productId:string;method:string;stage:string;orderId?:string};buyerActivity?:string;open:boolean;focusedProductId:string;cart:Record<string,number>;photo?:{url:string;sender:string};version:number};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function context(req:NextRequest){
 const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;
 const callId=req.nextUrl.searchParams.get('callId')||'';
 const call=await getPrivateCallSession(callId);
 const uid=auth.viewer.userId;
 if(!call||![call.callerUserId,call.pastorUserId].includes(uid))return reply({ok:false,error:'Call unavailable.'},403);
 if(call.status!=='accepted'||!call.sokoConversationId)return reply({ok:false,error:'Open a new connected Zpora call.'},409);
 const conversation=await dbGetSokoBuyerSellerConversation(call.sokoConversationId);
 const access=authorizeSokoConversationAccess(conversation,uid);
 if(!access.ok||!conversation)return reply({ok:false,error:'Conversation unavailable.'},403);
 if(![call.callerUserId,call.pastorUserId].includes(conversation.buyerUserId)||![call.callerUserId,call.pastorUserId].includes(conversation.sellerUserId))return reply({ok:false,error:'Call participants do not match.'},403);
 const blocks=await Promise.all([readSellerBlocks(conversation.buyerUserId),readSellerBlocks(conversation.sellerUserId)]);
 if(blocks[0].sellerIds.includes(conversation.sellerUserId)||blocks[1].sellerIds.includes(conversation.buyerUserId))return reply({ok:false,error:'Conversation blocked.'},403);
 const url=getDatabaseUrl();if(!url)return reply({ok:false,error:'Live store database unavailable.'},503);
 const sql=neon(url);
 await sql`CREATE TABLE IF NOT EXISTS soko_live_store (call_id TEXT PRIMARY KEY,state JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
 const initial:State={open:false,focusedProductId:conversation.productId,shownProductIds:[conversation.productId],cart:{},version:0};
 await sql`INSERT INTO soko_live_store(call_id,state) VALUES(${callId},${JSON.stringify(initial)}::jsonb) ON CONFLICT DO NOTHING`;
 const rows=await sql`SELECT state,version FROM soko_live_store WHERE call_id=${callId}`;
 const state={...(rows[0].state as State),version:Number(rows[0].version)};
 // The same catalog visibility and seller enforcement rules used by the store.
 let before='';const products:any[]=[];
 for(let page=0;page<50;page++){const result=await listSokoProducts(before,conversation.sellerUserId);products.push(...result.products.map(p=>({...sanitizeSokoCatalogProduct({...p,seller:{...((p as any).seller||{}),id:conversation.sellerUserId}}, {includeInternalIds:true}),category:typeof (p as any).category==='string'?(p as any).category:typeof (p as any).payload?.category==='string'?(p as any).payload.category:''})));before=result.nextCursor||'';if(!before)break;}
 let order:any=null;
 if(state.checkout?.orderId){const orders=await listSokoOrders(uid,uid===conversation.buyerUserId?'buying':'selling');order=orders.find(o=>o.id===state.checkout!.orderId)||null;if(order&&(order.buyerUserId!==conversation.buyerUserId||order.sellerUserId!==conversation.sellerUserId))return reply({ok:false,error:'Order participants do not match.'},403);}
 return {sql,callId,uid,conversation,state,products,order};
}
export async function GET(req:NextRequest){try{const c=await context(req);if(c instanceof NextResponse)return c;if(req.nextUrl.searchParams.get('proof')==='1'){
 if(!c.order)return reply({ok:false,error:'No payment proof.'},404);
 const proof=await getSokoPaymentProof({userId:c.uid,orderId:c.order.id});
 return reply({ok:true,image:`data:${proof.mime};base64,${proof.bytes.toString('base64')}`});}
 return reply({ok:true,state:c.state,products:c.products,buyerUserId:c.conversation.buyerUserId,order:c.order});}catch{return reply({ok:false,error:'Live store could not load.'},503);}}
export async function POST(req:NextRequest){try{
 const c=await context(req);if(c instanceof NextResponse)return c;
 const contentType=req.headers.get('content-type')||'';
 let body:any;let photo:State['photo'];
 if(contentType.startsWith('multipart/form-data')){
  // Bound the request while streaming before multipart parsing.
  const reader=req.body?.getReader();if(!reader)return reply({ok:false,error:'Image required.'},400);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>5*1024*1024){await reader.cancel();return reply({ok:false,error:'Image too large.'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
  const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':contentType}}).formData();
  const file=form.get('image');body={action:form.get('action')==='proof'?'proof':'photo',version:Number(form.get('version')),transactionReference:String(form.get('transactionReference')||''),paymentDate:String(form.get('paymentDate')||'')};
  if(!(file instanceof File))return reply({ok:false,error:'Image required.'},400);
  const bytes=Buffer.from(await file.arrayBuffer());const checked=inspectSokoProductImageUpload({bytes});
  if(!checked.ok)return reply({ok:false,error:checked.error},checked.status);
  if(body.action==='proof'){
 assertLivePaymentAction({action:'proof',buyer:c.uid===c.conversation.buyerUserId,checkout:c.state.checkout,order:c.order});
 if(c.order.status==='payment_submitted')return reply({ok:true,state:c.state,order:c.order});
 if(!body.transactionReference.trim()||!body.paymentDate||Number.isNaN(Date.parse(body.paymentDate)))return reply({ok:false,error:'Enter transaction reference and payment date.'},400);
 await saveSokoPaymentProof({userId:c.uid,orderId:c.order.id,bytes,mime:checked.format.mime});
 const order=await updateSokoOrder({userId:c.uid,orderId:c.order.id,action:'submit_payment',transactionReference:body.transactionReference,paymentDate:body.paymentDate});
 return reply({ok:true,state:c.state,order});
 }
 const uploaded=await uploadBufferToStorage({key:`soko/live-store/${c.callId}/${randomUUID()}.${checked.format.extension}`,body:bytes,contentType:checked.format.mime});
  photo={url:uploaded.publicUrl,sender:c.uid};
 }else{body=await req.json();}
 if(body.action==='activity'){
 assertLivePaymentAction({action:'activity',buyer:c.uid===c.conversation.buyerUserId,checkout:c.state.checkout,order:c.order});
 if(!['away','returned'].includes(body.activity))return reply({ok:false,error:'Invalid activity.'},400);
 const rows=await c.sql`UPDATE soko_live_store SET state=jsonb_set(state,'{buyerActivity}',${JSON.stringify(body.activity)}::jsonb),version=version+1,updated_at=NOW() WHERE call_id=${c.callId} RETURNING state,version`;
 return reply({ok:true,state:{...rows[0].state,version:Number(rows[0].version)},order:c.order});
 }
 if(['create_order','approve_payment','reject_payment','accept_delivery_quote','provide_delivery_quote'].includes(body.action)){
 assertLivePaymentAction({action:body.action,buyer:c.uid===c.conversation.buyerUserId,checkout:c.state.checkout,order:c.order});
 if(body.action==='create_order'){
 if(c.order)return reply({ok:true,state:c.state,order:c.order});
 const product=c.products.find(p=>p.id===c.state.checkout?.productId);
 if(!product)return reply({ok:false,error:'Product unavailable.'},404);
 const profile=await getProfile(c.uid);
 const order=await createSokoOrder({buyerUserId:c.uid,buyerName:String(profile?.fullName||'Buyer'),productId:product.id,paymentMethod:'mobile_money',clientKey:'live_'+createHash('sha256').update(c.callId+':'+product.id).digest('hex'),deliveryDetails:body.deliveryDetails||{},deliverySelection:body.deliverySelection||{}});
 const latestRows=await c.sql`SELECT state,version FROM soko_live_store WHERE call_id=${c.callId}`;
 const latest=latestRows[0].state as State;
 if(latest.checkout?.productId!==product.id)return reply({ok:false,error:'Checkout changed. Find the created order in Track Order.'},409);
 const next={...latest,checkout:{...latest.checkout,orderId:order.id,stage:'paying'},version:Number(latestRows[0].version)+1};
 const rows=await c.sql`UPDATE soko_live_store SET state=${JSON.stringify(next)}::jsonb,version=version+1,updated_at=NOW() WHERE call_id=${c.callId} AND version=${Number(latestRows[0].version)} RETURNING version`;
 if(!rows.length)return reply({ok:false,error:'Store changed. Open Track Order to resume this order.'},409);
 return reply({ok:true,state:next,order});
 }
 const order=await updateSokoOrder({userId:c.uid,orderId:c.order.id,action:body.action,note:String(body.note||''),deliveryQuoteAmount:body.deliveryQuoteAmount,deliveryQuoteEstimatedDays:body.deliveryQuoteEstimatedDays});
 return reply({ok:true,state:c.state,order});
 }
 if(body.version!==c.state.version)return reply({ok:false,error:'Store changed. Please try again.',state:c.state},409);
 const next:State={...c.state,cart:{...c.state.cart},version:c.state.version+1};
 if(['checkout','method','activity'].includes(body.action)){
 assertLivePaymentAction({action:body.action,buyer:c.uid===c.conversation.buyerUserId,checkout:c.state.checkout,order:c.order});
 if(body.action==='checkout'){
 const product=c.products.find(p=>p.id===body.productId);
 if(!product)return reply({ok:false,error:'Product unavailable.'},404);
 if(c.state.checkout?.orderId)return reply({ok:false,error:'Finish the current live order first.'},409);
 next.checkout={productId:product.id,method:'',stage:'choosing_method'};next.open=true;
 }else if(body.action==='method'){
 const product=c.products.find(p=>p.id===c.state.checkout?.productId);
 if(body.method!=='mobile_money'||!product?.paymentOptions?.methods?.includes('mobile_money'))return reply({ok:false,error:'Seller does not accept this mobile payment method.'},400);
 next.checkout={...c.state.checkout!,method:'mobile_money',stage:'entering_address'};
 }else{
 if(!['away','returned'].includes(body.activity))return reply({ok:false,error:'Invalid activity.'},400);
 next.buyerActivity=body.activity;
 }
 }
 else if(body.action==='open')next.open=true;
 else if(body.action==='focus'){
  if(!c.products.some(p=>p.id===body.productId))return reply({ok:false,error:'Product unavailable.'},404);
  if(c.uid===c.conversation.buyerUserId&&!new Set([...(c.state.shownProductIds||[]),c.state.focusedProductId]).has(body.productId))return reply({ok:false,error:'Seller has not shown this product yet.'},403);
  next.shownProductIds=Array.from(new Set([...(c.state.shownProductIds||[]),c.state.focusedProductId,body.productId].filter(Boolean)));
  next.focusedProductId=body.productId;next.open=true;
 }else if(body.action==='reject'){
  if(c.uid!==c.conversation.buyerUserId)return reply({ok:false,error:'Only the buyer can reject a product.'},403);
  if(body.productId!==c.state.focusedProductId)return reply({ok:false,error:'Product changed. Please try again.'},409);
  next.buyerDecision={productId:body.productId,decision:'rejected'};delete next.cart[body.productId];
 }else if(body.action==='cart'){
  if(c.uid!==c.conversation.buyerUserId)return reply({ok:false,error:'Only the buyer can edit this cart.'},403);
  const quantity=Number(body.quantity);if(!Number.isInteger(quantity)||quantity<0||quantity>999)return reply({ok:false,error:'Invalid quantity.'},400);
  const product=c.products.find(p=>p.id===body.productId);
  if(quantity>0&&(!product||quantity>Number(product.stockAvailable??product.quantity??0)))return reply({ok:false,error:'Not enough stock.'},409);
  if(quantity===0)delete next.cart[body.productId];else {next.cart[body.productId]=quantity;next.buyerDecision={productId:body.productId,decision:'accepted'};}
 }else if(body.action==='photo'&&photo){next.photo=photo;next.open=true;}
 else return reply({ok:false,error:'Unknown action.'},400);
 const rows=await c.sql`UPDATE soko_live_store SET state=${JSON.stringify(next)}::jsonb,version=version+1,updated_at=NOW() WHERE call_id=${c.callId} AND version=${c.state.version} RETURNING version`;
 if(!rows.length)return reply({ok:false,error:'Store changed. Please try again.'},409);
 return reply({ok:true,state:next});
 }catch(error){return reply({ok:false,error:error instanceof Error?error.message:'Live store update failed.'},400);}}
