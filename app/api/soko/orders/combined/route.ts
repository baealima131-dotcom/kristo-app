import {NextRequest,NextResponse} from 'next/server';
import {guardCheckoutAuth} from '@/app/api/_lib/rbac';
import {createCombinedParcelOrder} from '@/app/api/_lib/store/sokoCombinedParcelDb';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
  const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;
  try{const raw=await req.text();if(raw.length>16384)throw new Error('Checkout request too large.');const body=JSON.parse(raw);
    const order=await createCombinedParcelOrder({buyer:auth.viewer.userId,buyerName:String(auth.viewer.name||'Zpora buyer'),items:body.items,clientKey:String(body.clientKey||''),address:body.deliveryDetails||{},selection:body.deliverySelection||{}});
    return NextResponse.json({ok:true,order},{status:201,headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Could not create parcel order.'},{status:400,headers:{'Cache-Control':'private, no-store'}});}
}
