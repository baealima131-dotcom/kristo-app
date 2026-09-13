import { NextRequest, NextResponse } from "next/server";
import { guardAuth } from "@/app/api/_lib/rbac";
import { getViewer } from "@/app/api/_lib/auth";
import { getProfile } from "@/app/api/auth/_lib/profile";
import {
  publishSokoProduct,
  listSokoProducts,
  changeSokoProduct,
  updateSokoProductInventory,
} from "@/app/api/_lib/store/sokoProductsDb";
import { sanitizeSokoCatalogProduct } from "@/app/api/_lib/sokoPublicCatalog";
import { dbGetMySokoSellerApplication } from "@/app/api/_lib/store/sokoSellerAccessDb";
import { getMembershipsForUser } from "@/app/api/_lib/memberships";
import { getChurchById } from "@/app/api/_lib/churches";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function reply(body: unknown, status=200, cache = "private, no-store") {
  return NextResponse.json(body,{status,headers:{"Cache-Control": cache}});
}
async function peekSignedInUserId(req: NextRequest) {
  try {
    const viewer = await getViewer(req);
    return String(viewer?.userId || "").trim();
  } catch {
    return "";
  }
}
export async function GET(req: NextRequest) {
  try {
    const signedInUserId = await peekSignedInUserId(req);
    const result = await listSokoProducts(
      req.nextUrl.searchParams.get("before") || "",
      req.nextUrl.searchParams.get("sellerId") || ""
    );

    const sellerCache = new Map<string, Promise<any>>();

    const loadSeller = (userId: string) => {
      const existing = sellerCache.get(userId);
      if (existing) return existing;

      const pending = (async () => {
        const [profile, application, memberships] =
          await Promise.all([
            getProfile(userId),
            dbGetMySokoSellerApplication(userId),
            getMembershipsForUser(userId),
          ]);

        const activeMembership = memberships.find(
          (row: any) =>
            String(row?.status || "").trim() === "Active"
        );

        const churchId =
          String(activeMembership?.churchId || "").trim();

        const showChurch =
          profile?.privacy?.showChurch !== false;

        const church =
          showChurch && churchId
            ? await getChurchById(churchId)
            : undefined;

        return {
          name:
            String(profile?.fullName || "").trim(),
          kristoId:
            String(profile?.userCode || "").trim().toUpperCase(),
          avatarUrl:
            String(profile?.avatarUrl || "").trim(),
          shopName:
            String(application?.businessName || "").trim(),
          shopCategory:
            String(application?.category || "").trim(),
          shopLocation:
            String(application?.location || "").trim(),
          churchId:
            showChurch ? churchId : "",
          churchName:
            showChurch
              ? String(church?.name || "").trim()
              : "",
          churchAvatarUrl:
            showChurch
              ? String(
                  (church as any)?.avatarUrl ||
                  (church as any)?.avatarUri ||
                  (church as any)?.logoUrl ||
                  (church as any)?.logoUri ||
                  ""
                ).trim()
              : "",
        };
      })().catch(() => null);

      sellerCache.set(userId, pending);
      return pending;
    };

    const products = await Promise.all(
      (Array.isArray((result as any).products)
        ? (result as any).products
        : []
      ).map(async (product: any) => {
        try {
          const userId =
            String(product?.seller?.id || "").trim();

          const publicSeller = userId ? await loadSeller(userId) : null;
          const merged = {
            ...product,
            seller: {
              ...(product.seller || {}),
              ...(publicSeller || {}),
              ...(signedInUserId && userId ? { id: userId } : {}),
              name:
                publicSeller?.name ||
                product?.seller?.name ||
                "Kristo Seller",
              verified: true,
            },
          };
          return sanitizeSokoCatalogProduct(merged, {
            includeInternalIds: Boolean(signedInUserId),
          });
        } catch {
          return sanitizeSokoCatalogProduct({
            ...product,
            photos: [],
            image: "",
          });
        }
      })
    );

    return reply({
      ok: true,
      ...result,
      products,
    }, 200, "private, no-store");
  } catch (error) {
    console.error("KRISTO_SOKO_PRODUCTS_ENRICH_ERROR", error);
    return reply(
      {
        ok: false,
        error: "Could not load SOKO products.",
      },
      503
    );
  }
}
async function write(req: NextRequest, publish: boolean) {
  const auth = await guardAuth(req); if (auth instanceof NextResponse) return auth;
  try {
    // Bound JSON bytes before parsing.
    const reader = req.body?.getReader(); if (!reader) return reply({ok:false,error:"Missing body."},400);
    const chunks: Uint8Array[]=[]; let size=0;
    try { while(true) { const part=await reader.read(); if(part.done) break; size+=part.value.byteLength;
      if(size>24000) { await reader.cancel(); return reply({ok:false,error:"Product request too large."},413); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ok:false,error:"Invalid product."},400);
    const userId=auth.viewer.userId, profile=await getProfile(userId);
    const kristoId=String(profile?.userCode || "").trim().toUpperCase();
    if(publish) {
      if(!kristoId) return reply({ok:false,error:"Complete your Kristo profile."},409);
      const product=await publishSokoProduct(userId,kristoId,String(profile?.fullName || "Kristo seller"),body);
      return reply({ok:true,product},201);
    }
    if (
      typeof body.quantity === "number" ||
      typeof body.quantity === "string"
    ) {
      const product = await updateSokoProductInventory(
        userId,
        kristoId,
        String(body.id || ""),
        Number(body.quantity)
      );

      return reply({
        ok: true,
        product,
      });
    }

    await changeSokoProduct(
      userId,
      kristoId,
      String(body.id || ""),
      String(body.status || "")
    );

    return reply({ok:true});
  } catch(error) { return reply({ok:false,error:error instanceof Error && !/sql|postgres|database|relation|connect/i.test(error.message) ? error.message : "Could not save product."},400); }
}
export async function POST(req: NextRequest) { return write(req,true); }
export async function PATCH(req: NextRequest) { return write(req,false); }
