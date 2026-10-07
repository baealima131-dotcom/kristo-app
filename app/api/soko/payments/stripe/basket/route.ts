import {NextRequest,NextResponse} from 'next/server';
import {guardCheckoutAuth} from '@/app/api/_lib/rbac';
import {basketPaymentStatus,prepareBasketPayment,cancelBasketPayment} from '@/app/api/_lib/store/sokoBasketPaymentsDb';
import {sokoStripeServerConfigured} from '@/app/api/_lib/sokoStripeServer';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest){const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;try{if(!sokoStripeServerConfigured())throw new Error('Card checkout is not configured yet.');const text=await req.text();if(text.length>8192)throw new Error('Basket request too large.');const body=JSON.parse(text);return reply(await prepareBasketPayment(auth.viewer.userId,body.orderIds));}catch(error){return reply({ok:false,error:error instanceof Error?error.message:'Could not prepare basket payment.'},400);}}
export async function GET(req:NextRequest){const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;try{return reply(await basketPaymentStatus(auth.viewer.userId,String(req.nextUrl.searchParams.get('basketId')||'')));}catch(error){return reply({ok:false,error:error instanceof Error?error.message:'Could not confirm basket payment.'},400);}}

export async function DELETE(req:NextRequest){const auth=await guardCheckoutAuth(req);if(auth instanceof NextResponse)return auth;try{const body=await req.json();return reply(await cancelBasketPayment(auth.viewer.userId,String(body.basketId||'')));}catch(error){return reply({ok:false,error:error instanceof Error?error.message:'Could not cancel basket.'},400);}}
