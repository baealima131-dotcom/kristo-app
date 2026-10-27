import {NextRequest,NextResponse} from 'next/server';
import {guardCheckoutAuth} from '@/app/api/_lib/rbac';
import {authorizeSokoConversationAccess} from '@/app/api/_lib/sokoBuyerSellerChatPolicy';
import {dbGetSokoBuyerSellerConversation,dbCreateSokoBuyerSellerMessage} from '@/app/api/_lib/store/sokoBuyerSellerChatDb';
import {getSokoProductById} from '@/app/api/_lib/store/sokoProductsDb';
import {readSellerBlocks} from '@/app/api/_lib/store/sokoSellerBlocksDb';
export const runtime='nodejs';
export async function POST(req:NextRequest){
  const auth=await guardCheckoutAuth(req); if(auth instanceof NextResponse)return auth;
  const body=await req.json().catch(()=>({}));
  const id=String(body?.conversationId||'').trim();
  const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
  if(!id||id.length>100)return reply({ok:false,error:'Choose a conversation.'},400);
  try{
    const thread=await dbGetSokoBuyerSellerConversation(id);
    const access=authorizeSokoConversationAccess(thread,auth.viewer.userId);
    if(!access.ok)return reply({ok:false,error:access.error},access.status);
    if(!thread||thread.sellerUserId!==auth.viewer.userId)return reply({ok:false,error:'Only this seller can share their payment methods.'},403);
    const blocks=await Promise.all([readSellerBlocks(thread.buyerUserId),readSellerBlocks(thread.sellerUserId)]);
    if(blocks[0].sellerIds.includes(thread.sellerUserId)||blocks[1].sellerIds.includes(thread.buyerUserId))return reply({ok:false,error:'Conversation blocked.'},403);
    const product=await getSokoProductById(thread.productId);
    if(!product||product.sellerUserId!==thread.sellerUserId)return reply({ok:false,error:'Listing unavailable.'},404);
    const p=product.paymentOptions||{};
    const methods=Array.isArray(p.methods)?p.methods:[];
    const clean=(v:unknown)=>String(v||'').replace(/[\r\n]/g,' ').trim().slice(0,140);
    const lines:string[]=[];
    if(methods.includes('cash'))lines.push('Cash · agree on collection and amount first.');
    if(methods.includes('mobile_money')&&clean(p.mobileNetwork)&&clean(p.mobileNumber)&&clean(p.recipientName))lines.push(`${clean(p.mobileNetwork)} · ${clean(p.mobileNumber)} · Recipient: ${clean(p.recipientName)}`);
    if(methods.includes('cash_app')&&clean(p.cashTag))lines.push(`Cash App · ${clean(p.cashTag)}`);
    if(p.stripeCardAvailable===true)lines.push('Card · use the secure checkout on the product page.');
    if(!lines.length)return reply({ok:false,error:'Add available payment methods to your listing first.'},400);
    const message=await dbCreateSokoBuyerSellerMessage({conversationId:id,senderUserId:auth.viewer.userId,type:'text',text:'ZPORA · AVAILABLE PAYMENT METHODS\n'+lines.join('\n')+'\nConfirm the final amount and recipient before transferring. Use your provider’s official app or menu. Never send your PIN or OTP in chat. This message does not confirm payment.'});
    return reply({ok:true,message},201);
  }catch{return reply({ok:false,error:'Could not share payment methods. Please retry.'},503);}
}
