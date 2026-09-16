import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";

export const dynamic = "force-dynamic";

export default async function SokoProductLinkPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await getSokoProductById(productId).catch(() => null);
  if (!product || String(product.status || "") === "Deleted") {
    return <main style={{ fontFamily: "sans-serif", padding: 24 }}>This listing is unavailable.</main>;
  }
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 560 }}>
      <p style={{ letterSpacing: 1, color: "#1b4332", fontWeight: 700 }}>SOKO</p>
      <h1>{String(product.title || "Listing")}</h1>
      <p>
        {String(product.currency || "")} {String(product.price ?? "")}
      </p>
      <p>Open this listing in the SOKO app to buy or contact the seller.</p>
    </main>
  );
}
