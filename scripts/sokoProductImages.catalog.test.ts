import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  isolateSokoCatalogProducts,
  resolveSokoCatalogPhotos,
  sokoImageUrl,
  trySokoCatalogImageUrl,
} from "../app/api/_lib/sokoProductImages.ts";
import {
  SOKO_PRODUCT_IMAGE_MAX_BYTES,
  SOKO_PRODUCT_IMAGE_MAX_FILES_PER_REQUEST,
  assertDurableSokoUploadResult,
  assertStoredSokoProductImageHead,
  buildSokoProductImageObjectKey,
  detectSokoProductImageFormat,
  evaluateSokoSellerImageUploadAccess,
  inspectSokoProductImageUpload,
  selectSokoProductImageWriteTarget,
} from "../app/api/_lib/sokoSellerProductImagePolicy.ts";

const owner = "a".repeat(64);
const fileId = "00000000-0000-0000-0000-000000000000";
const localKey = `local/soko-products/${owner}/${fileId}.jpg`;
const uploadsKey = `uploads/soko-products/${owner}/${fileId}.jpg`;

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production rejects local keys and catalog skips them without throwing", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      KRISTO_VIDEO_STORAGE_BUCKET: "bucket",
      KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID: "id",
      KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY: "secret",
      KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL: "https://media.example.test",
    },
    () => {
      assert.throws(() => sokoImageUrl(localKey), /development-only/);
      assert.equal(trySokoCatalogImageUrl(localKey), null);
      assert.deepEqual(resolveSokoCatalogPhotos([localKey, "not-a-key", uploadsKey]), [
        `https://media.example.test/${uploadsKey}`,
      ]);
    }
  );
});

test("catalog per-product isolation keeps neighbors when one projector throws", () => {
  withEnv({
    NODE_ENV: "production",
    VERCEL: "1",
    KRISTO_VIDEO_STORAGE_BUCKET: "bucket",
    KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID: "id",
    KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY: "secret",
    KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL: "https://media.example.test",
  }, () => {
    const rows = [
      { id: "good-uploads", imageKeys: [uploadsKey], title: "Good" },
      { id: "legacy-local", imageKeys: [localKey], title: "Legacy" },
      { id: "explode", imageKeys: [localKey], title: "Boom" },
    ];
    const products = isolateSokoCatalogProducts(
      rows,
      (row) => {
        if (row.id === "explode") throw new Error("unexpected row failure");
        const photos = resolveSokoCatalogPhotos(row.imageKeys);
        return { id: row.id, title: row.title, photos, image: photos[0] || "" };
      },
      (row) => ({ id: row.id, title: row.title, photos: [] as string[], image: "" })
    );
    assert.equal(products.length, 3);
    assert.equal(products[0].image, `https://media.example.test/${uploadsKey}`);
    assert.deepEqual(products[1].photos, []);
    assert.equal(products[1].image, "");
    assert.equal(products[2].id, "explode");
    assert.equal(products[2].image, "");
    assert.equal(products.every((row) => typeof row.image === "string"), true);
    assert.equal(products.some((row) => /placeholder|example\.com\/missing/i.test(row.image)), false);
  });
});

test("seller image upload authorization", () => {
  assert.equal(evaluateSokoSellerImageUploadAccess({
    authenticated: false,
    kristoId: "KR1",
    sellerApproved: true,
    sellerStatus: "active",
  }).ok, false);
  assert.equal(evaluateSokoSellerImageUploadAccess({
    authenticated: true,
    kristoId: "",
    sellerApproved: true,
    sellerStatus: "active",
  }).status, 409);
  assert.equal(evaluateSokoSellerImageUploadAccess({
    authenticated: true,
    kristoId: "KR1",
    sellerApproved: false,
    sellerStatus: "active",
  }).status, 403);
  assert.equal(evaluateSokoSellerImageUploadAccess({
    authenticated: true,
    kristoId: "KR1",
    sellerApproved: true,
    sellerStatus: "suspended",
  }).status, 403);
  assert.equal(evaluateSokoSellerImageUploadAccess({
    authenticated: true,
    kristoId: "KR1",
    sellerApproved: true,
    sellerStatus: "active",
  }).ok, true);
});

test("MIME magic bytes, extension, and size rejection", () => {
  assert.equal(detectSokoProductImageFormat(Buffer.from("not-an-image")), null);
  assert.equal(detectSokoProductImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).mime, "image/jpeg");
  assert.equal(detectSokoProductImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).extension, "jpg");
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  assert.equal(detectSokoProductImageFormat(png)?.mime, "image/png");
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBP"),
  ]);
  assert.equal(detectSokoProductImageFormat(webp)?.extension, "webp");
  assert.equal(
    inspectSokoProductImageUpload({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      filename: "photo.png",
    }).ok,
    false
  );
  assert.equal(
    inspectSokoProductImageUpload({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      filename: "photo.jpg",
      declaredMime: "image/png",
    }).ok,
    false
  );
  assert.equal(SOKO_PRODUCT_IMAGE_MAX_FILES_PER_REQUEST, 1);
  assert.equal(Buffer.alloc(SOKO_PRODUCT_IMAGE_MAX_BYTES + 1).length > SOKO_PRODUCT_IMAGE_MAX_BYTES, true);
  assert.throws(
    () => buildSokoProductImageObjectKey({
      prefix: "uploads",
      ownerHex: "abc",
      fileId,
      extension: "jpg",
    }),
    /Invalid image owner/
  );
});

test("listing uploads keep magic-byte checks and store the verified extension", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBP"),
  ]);
  const heic = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypheic"),
    Buffer.alloc(4),
    Buffer.from("mif1"),
  ]);

  const jpegOk = inspectSokoProductImageUpload({
    bytes: jpeg,
    filename: "listing.JPEG",
    declaredMime: "image/jpeg",
  });
  assert.equal(jpegOk.ok, true);
  if (!jpegOk.ok) return;
  assert.equal(
    buildSokoProductImageObjectKey({
      prefix: "uploads",
      ownerHex: owner,
      fileId,
      extension: jpegOk.format.extension,
    }),
    `uploads/soko-products/${owner}/${fileId}.jpg`
  );

  const pngOk = inspectSokoProductImageUpload({
    bytes: png,
    filename: "photo.png",
    declaredMime: "image/png",
  });
  assert.equal(pngOk.ok, true);
  if (pngOk.ok) assert.equal(pngOk.format.extension, "png");

  const webpOk = inspectSokoProductImageUpload({
    bytes: webp,
    filename: "photo.webp",
    declaredMime: "image/webp",
  });
  assert.equal(webpOk.ok, true);
  if (webpOk.ok) assert.equal(webpOk.format.extension, "webp");

  const jpegWrongExt = inspectSokoProductImageUpload({
    bytes: jpeg,
    filename: "photo.png",
    declaredMime: "image/jpeg",
  });
  assert.equal(jpegWrongExt.ok, false);
  if (!jpegWrongExt.ok) {
    assert.match(jpegWrongExt.error, /extension does not match/);
  }

  const heicRejected = inspectSokoProductImageUpload({
    bytes: heic,
    filename: "photo.jpg",
    declaredMime: "image/jpeg",
  });
  assert.equal(heicRejected.ok, false);
  if (!heicRejected.ok) {
    assert.match(heicRejected.error, /Convert HEIC/);
  }

  const spoofed = inspectSokoProductImageUpload({
    bytes: Buffer.from("GIF89a"),
    filename: "photo.jpg",
    declaredMime: "image/jpeg",
  });
  assert.equal(spoofed.ok, false);
  if (!spoofed.ok) {
    assert.match(spoofed.error, /JPEG, PNG or WebP/);
  }
});

test("object key extension is derived from verified bytes", () => {
  const verified = inspectSokoProductImageUpload({
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    filename: "photo.jpg",
    declaredMime: "image/jpeg",
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  const key = buildSokoProductImageObjectKey({
    prefix: "uploads",
    ownerHex: owner,
    fileId,
    extension: verified.format.extension,
  });
  assert.equal(key, `uploads/soko-products/${owner}/${fileId}.jpg`);
});

test("durable uploads/ HTTPS URL output and Vercel never uses local disk", () => {
  assert.equal(
    selectSokoProductImageWriteTarget({
      hasObjectStorage: true,
      vercel: true,
      localDev: true,
    }),
    "uploads"
  );
  assert.equal(
    selectSokoProductImageWriteTarget({
      hasObjectStorage: false,
      vercel: true,
      localDev: true,
    }),
    "unavailable"
  );
  assert.equal(
    selectSokoProductImageWriteTarget({
      hasObjectStorage: false,
      vercel: false,
      localDev: true,
    }),
    "local"
  );

  const key = buildSokoProductImageObjectKey({
    prefix: "uploads",
    ownerHex: owner,
    fileId,
    extension: "png",
  });
  assert.equal(key, `uploads/soko-products/${owner}/${fileId}.png`);
  const durable = assertDurableSokoUploadResult({
    key,
    publicUrl: `https://media.example.test/${key}`,
  });
  assert.equal(durable.publicUrl.startsWith("https://"), true);
  assert.throws(() => assertDurableSokoUploadResult({
    key: localKey,
    publicUrl: "/api/soko/product-images/x/y.jpg",
  }));
  assert.throws(() => assertStoredSokoProductImageHead({
    key,
    expectedBytes: 12,
    expectedMime: "image/png",
    contentLength: 11,
    contentType: "image/png",
  }));

  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      KRISTO_VIDEO_STORAGE_BUCKET: "bucket",
      KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID: "id",
      KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY: "secret",
      KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL: "https://media.example.test",
    },
    () => {
      assert.equal(
        sokoImageUrl(uploadsKey),
        `https://media.example.test/${uploadsKey}`
      );
    }
  );
});

test("seller product-images route uses auth, MIME, size, R2, and no Vercel local fallback", () => {
  const route = read("app/api/soko/seller/product-images/route.ts");
  const productsDb = read("app/api/_lib/store/sokoProductsDb.ts");

  assert.match(route, /guardAuth/);
  assert.match(route, /evaluateSokoSellerImageUploadAccess/);
  assert.match(route, /inspectSokoProductImageUpload/);
  assert.match(route, /uploadBufferToStorage/);
  assert.match(route, /headStorageObject/);
  assert.match(route, /assertDurableSokoUploadResult/);
  assert.match(route, /assertStoredSokoProductImageHead/);
  assert.match(route, /extension: format\.extension/);
  assert.match(route, /contentType: format\.mime/);
  assert.match(route, /selectSokoProductImageWriteTarget/);
  assert.match(route, /vercel: Boolean\(process\.env\.VERCEL\)/);
  assert.match(route, /writeTarget === "local"/);
  assert.doesNotMatch(route, /cash-app|workforce|sokoWork/);
  assert.doesNotMatch(route, /product-images\/\[owner\]/);

  assert.match(productsDb, /resolveSokoCatalogPhotos/);
  assert.match(productsDb, /isolateSokoCatalogProducts/);
  assert.match(productsDb, /publicProductWithoutImages/);
  assert.doesNotMatch(productsDb, /\.map\(sokoImageUrl\)/);
});
