import { getProfile } from "@/app/api/auth/_lib/profile";
import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";
import { readSellerBlocks, saveSellerBlock, markBlockReported, removeSellerBlock } from "@/app/api/_lib/store/sokoSellerBlocksDb";
import { POST as reportProduct } from "../../reports/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
async function state(req: NextRequest, userId: string) {
  const result = await readSellerBlocks(userId);
  // A durable pending flag retries moderation delivery; delivery failure never unblocks a seller.
  for (const productId of result.pending.slice(0,10)) {
    try {
      const headers = new Headers(req.headers); headers.set("content-type","application/json");
      const response = await reportProduct(new NextRequest(new URL("/api/soko/reports",req.url),{
        method:"POST",headers,body:JSON.stringify({productId,reason:"Seller misconduct",details:"Seller blocked by this user. Review this seller and product for abusive behavior."})
      }));
      const body = await response.json();
      if(response.ok && body.ok) await markBlockReported(userId,productId);
    } catch { /* Retained for retry on the next authenticated refresh. */ }
  }
  const current = await readSellerBlocks(userId);
  const sellers = await Promise.all(current.sellerIds.map(async id => {
    const profile = await getProfile(id).catch(() => null);
    return {id, name: String(profile?.fullName || "Seller"), avatarUri: String(profile?.avatarUrl || ""), kristoId: String(profile?.userCode || "")};
  }));
  return reply({ok:true,sellers,sellerIds:current.sellerIds,productIds:current.productIds,reportPending:current.pending.length>0});
}
export async function GET(req: NextRequest) {
  const auth=await guardCheckoutAuth(req); if(auth instanceof NextResponse) return auth;
  try { return await state(req,auth.viewer.userId); } catch { return reply({ok:false,error:"Could not load blocked sellers."},503); }
}
export async function POST(req: NextRequest) {
  const auth=await guardCheckoutAuth(req); if(auth instanceof NextResponse) return auth;
  try {
    const body=await req.json(); const productId=String(body.productId||"").trim();
    const product=productId ? await getSokoProductById(productId) : null;
    if(!product?.sellerUserId) return reply({ok:false,error:"This product is unavailable. Refresh and try again."},404);
    if(product.sellerUserId===auth.viewer.userId) return reply({ok:false,error:"You cannot block your own seller account."},400);
    await saveSellerBlock(auth.viewer.userId,product.sellerUserId,productId);
    return await state(req,auth.viewer.userId);
  } catch { return reply({ok:false,error:"Could not save block. Please try again."},503); }
}

export async function DELETE(req: NextRequest) {
  const auth=await guardCheckoutAuth(req); if(auth instanceof NextResponse) return auth;
  try {
    const body=await req.json(); const sellerId=String(body.sellerId||"").trim();
    if(!sellerId || sellerId.length>100) return reply({ok:false,error:"Seller required."},400);
    await removeSellerBlock(auth.viewer.userId,sellerId);
    return await state(req,auth.viewer.userId);
  } catch { return reply({ok:false,error:"Could not unblock seller. Please try again."},503); }
}
