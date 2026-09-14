import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { sanitizeSokoCatalogProduct } from "../app/api/_lib/sokoPublicCatalog.ts";
import {
  isolateSokoCatalogProducts,
  resolveSokoCatalogPhotos,
  sokoImageUrl,
} from "../app/api/_lib/sokoProductImages.ts";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("public catalog sanitizer drops private seller, storage, and payment fields", () => {
  const sanitized = sanitizeSokoCatalogProduct({
    id: "soko-1",
    title: "Bag",
    description: "Public copy",
    price: 20,
    currency: "USD",
    imageKeys: ["local/soko-products/a/b.jpg"],
    clientKey: "secret-client",
    paymentOptions: {
      methods: ["cash_app"],
      cashTag: "HiddenTag",
      mobileNumber: "+15555550100",
      recipientName: "Private Name",
      stripeAccountId: "acct_secret",
      stripeCardAvailable: true,
    },
    fulfillmentOptions: {
      type: "parcel",
      addressFrom: { street1: "123 Private St", phone: "555-0100" },
      parcel: { length: 10 },
    },
    seller: {
      id: "user-internal",
      kristoId: "KR123",
      name: "Prince Kabika",
      shopName: "PK Shop",
    },
    photos: ["/api/soko/product-images/x/y.jpg"],
    image: "/api/soko/product-images/x/y.jpg",
  });

  assert.equal(sanitized.title, "Bag");
  assert.equal(sanitized.paymentOptions.stripeCardAvailable, true);
  assert.deepEqual(sanitized.paymentOptions.methods, ["cash_app"]);
  assert.equal("cashTag" in sanitized.paymentOptions, false);
  assert.equal("mobileNumber" in sanitized.paymentOptions, false);
  assert.equal("imageKeys" in sanitized, false);
  assert.equal("clientKey" in sanitized, false);
  assert.equal("addressFrom" in (sanitized.fulfillmentOptions || {}), false);
  assert.equal("id" in sanitized.seller, false);
  assert.equal("kristoId" in sanitized.seller, false);
  assert.equal(sanitized.seller.name, "Prince Kabika");

  const signedIn = sanitizeSokoCatalogProduct(
    { id: "soko-1", seller: { id: "user-internal", kristoId: "KR123", name: "Prince Kabika" } },
    { includeInternalIds: true }
  );
  assert.equal(signedIn.seller.id, "user-internal");
});

test("GET products is public; writes stay behind guardAuth", () => {
  const route = read("app/api/soko/products/route.ts");
  const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("async function write"));
  const writeBlock = route.slice(route.indexOf("async function write"));
  const productsDb = read("app/api/_lib/store/sokoProductsDb.ts");
  assert.doesNotMatch(getBlock, /guardAuth|guardCheckoutAuth/);
  assert.match(getBlock, /sanitizeSokoCatalogProduct/);
  assert.match(writeBlock, /guardAuth/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(productsDb, /resolveSokoCatalogPhotos/);
  assert.match(productsDb, /isolateSokoCatalogProducts/);
  assert.match(productsDb, /listingStripeCardAvailable/);
  assert.doesNotMatch(
    productsDb.slice(productsDb.indexOf("function publicProductWithoutImages")),
    /stripeCardAvailable: false/
  );
  assert.doesNotMatch(productsDb, /\.map\(sokoImageUrl\)/);
});

test("invalid local image keys do not fail a mixed public catalog", () => {
  const owner = "a".repeat(64);
  const fileId = "00000000-0000-0000-0000-000000000000";
  const localKey = `local/soko-products/${owner}/${fileId}.jpg`;
  const uploadsKey = `uploads/soko-products/${owner}/${fileId}.jpg`;
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    KRISTO_VIDEO_STORAGE_BUCKET: process.env.KRISTO_VIDEO_STORAGE_BUCKET,
    KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID: process.env.KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID,
    KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY: process.env.KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY,
    KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL: process.env.KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL,
  };
  process.env.NODE_ENV = "production";
  process.env.VERCEL = "1";
  process.env.KRISTO_VIDEO_STORAGE_BUCKET = "bucket";
  process.env.KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID = "id";
  process.env.KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY = "secret";
  process.env.KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL = "https://media.example.test";
  try {
    assert.throws(() => sokoImageUrl(localKey), /development-only/);
    const page = isolateSokoCatalogProducts(
      [
        { id: "uploads-ok", title: "Durable listing", imageKeys: [uploadsKey] },
        { id: "local-legacy", title: "Legacy listing", imageKeys: [localKey] },
        { id: "explode", title: "Broken mapper", imageKeys: [localKey] },
      ],
      (row) => {
        if (row.id === "explode") throw new Error("unexpected row failure");
        const photos = resolveSokoCatalogPhotos(row.imageKeys);
        return sanitizeSokoCatalogProduct({
          id: row.id,
          title: row.title,
          photos,
          image: photos[0] || "",
        });
      },
      (row) => sanitizeSokoCatalogProduct({ id: row.id, title: row.title, photos: [], image: "" })
    );
    assert.equal(page.length, 3);
    assert.equal(page[0].image, `https://media.example.test/${uploadsKey}`);
    assert.deepEqual(page[1].photos, []);
    assert.equal(page[1].image, "");
    assert.equal(page[2].id, "explode");
    assert.equal(page[2].image, "");
    assert.equal(page.some((item) => item.image.includes("placeholder")), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
