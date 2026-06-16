import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(mobileRoot, "assets/images/jujuju-splash.png");
const iosLegacyDir = path.join(
  mobileRoot,
  "ios/KristoApp/Images.xcassets/SplashScreenLegacy.imageset"
);

const ANDROID_DENSITIES = [
  { folder: "drawable-mdpi", size: 288 },
  { folder: "drawable-hdpi", size: 432 },
  { folder: "drawable-xhdpi", size: 576 },
  { folder: "drawable-xxhdpi", size: 864 },
  { folder: "drawable-xxxhdpi", size: 1152 },
];

const IOS_SCALES = [
  { suffix: "", width: 414 },
  { suffix: "@2x", width: 828 },
  { suffix: "@3x", width: 1242 },
];

async function writeCoverPng(outPath, width, height) {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(sourcePath)
    .resize(width, height, {
      fit: "cover",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(outPath);
}

async function syncIosLegacySplash() {
  if (!fs.existsSync(path.dirname(iosLegacyDir))) {
    throw new Error("iOS project not found. Run `npx expo prebuild` first.");
  }

  await fs.promises.mkdir(iosLegacyDir, { recursive: true });

  for (const scale of IOS_SCALES) {
    const height = Math.round(scale.width * (1844 / 853));
    await writeCoverPng(
      path.join(iosLegacyDir, `image${scale.suffix}.png`),
      scale.width,
      height
    );
  }

  const contents = {
    images: [
      { idiom: "universal", filename: "image.png", scale: "1x" },
      { idiom: "universal", filename: "image@2x.png", scale: "2x" },
      { idiom: "universal", filename: "image@3x.png", scale: "3x" },
    ],
    info: { version: 1, author: "expo" },
  };

  await fs.promises.writeFile(
    path.join(iosLegacyDir, "Contents.json"),
    `${JSON.stringify(contents, null, 2)}\n`
  );
}

async function syncAndroidSplashLogos() {
  const resRoot = path.join(mobileRoot, "android/app/src/main/res");
  if (!fs.existsSync(resRoot)) {
    throw new Error("Android project not found. Run `npx expo prebuild` first.");
  }

  for (const density of ANDROID_DENSITIES) {
    await writeCoverPng(
      path.join(resRoot, density.folder, "splashscreen_logo.png"),
      density.size,
      density.size
    );
  }
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing splash source: ${sourcePath}`);
  }

  await syncIosLegacySplash();
  await syncAndroidSplashLogos();

  console.log(
    JSON.stringify(
      {
        source: path.relative(mobileRoot, sourcePath),
        ios: path.relative(mobileRoot, iosLegacyDir),
        android: ANDROID_DENSITIES.map((d) => `android/app/src/main/res/${d.folder}/splashscreen_logo.png`),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
