import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(mobileRoot, "assets");
const imagesDir = path.join(assetsDir, "images");
const iconsDir = path.join(assetsDir, "icons");

const SOURCE_CANDIDATES = [
  path.join(imagesDir, "motowaMUNGU-source.png"),
  path.resolve("/Users/princefariji/Downloads/motowaMUNGU.png"),
  path.join(imagesDir, "motowaMUNGU.png"),
];

const BLACK_BG = { r: 0, g: 0, b: 0, alpha: 1 };

const IOS_FILL = 0.96;
const ANDROID_FILL = 0.88;
const TRIM_THRESHOLD = 12;

const IOS_SIZES = [1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20];
const ANDROID_SIZES = [512, 192, 144, 96, 72, 48];

function resolveSourcePath() {
  for (const candidate of SOURCE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Source icon not found. Checked:\n${SOURCE_CANDIDATES.join("\n")}`);
}

let trimmedSourceBuffer = null;

async function getTrimmedSource() {
  if (trimmedSourceBuffer) return trimmedSourceBuffer;

  const sourcePath = resolveSourcePath();
  trimmedSourceBuffer = await sharp(sourcePath)
    .trim({ threshold: TRIM_THRESHOLD })
    .toBuffer();

  return trimmedSourceBuffer;
}

async function makeFilledSquare(size, fillRatio, { cover = false } = {}) {
  const trimmed = await getTrimmedSource();

  if (cover) {
    return sharp(trimmed)
      .resize(size, size, {
        fit: "cover",
        position: "centre",
        kernel: sharp.kernel.lanczos3,
      })
      .flatten({ background: BLACK_BG })
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
      .toBuffer();
  }

  const inner = Math.round(size * fillRatio);
  const pad = Math.floor((size - inner) / 2);

  const artwork = await sharp(trimmed)
    .resize(inner, inner, {
      fit: "contain",
      position: "centre",
      background: BLACK_BG,
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: BLACK_BG })
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: BLACK_BG,
    },
  })
    .composite([{ input: artwork, left: pad, top: pad }])
    .flatten({ background: BLACK_BG })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toBuffer();
}

async function makeIosIcon(size) {
  return makeFilledSquare(size, IOS_FILL, { cover: true });
}

async function makeAdaptiveForeground(size = 1024) {
  return makeFilledSquare(size, ANDROID_FILL, { cover: false });
}

async function makeAdaptiveBackground(size = 1024) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: BLACK_BG,
    },
  })
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

async function main() {
  const sourcePath = resolveSourcePath();

  await fs.promises.mkdir(imagesDir, { recursive: true });
  await fs.promises.mkdir(iconsDir, { recursive: true });

  const trimmedMeta = await sharp(await getTrimmedSource()).metadata();
  const master1024 = await makeIosIcon(1024);
  const adaptiveForeground = await makeAdaptiveForeground(1024);
  const adaptiveBackground = await makeAdaptiveBackground(1024);

  const outputs = [
    [master1024, path.join(assetsDir, "icon.png")],
    [master1024, path.join(imagesDir, "motowaMUNGU-1024.png")],
    [master1024, path.join(imagesDir, "motowaMUNGU.png")],
    [adaptiveForeground, path.join(assetsDir, "adaptive-icon.png")],
    [adaptiveForeground, path.join(imagesDir, "motowaMUNGU-adaptive-foreground.png")],
    [adaptiveBackground, path.join(imagesDir, "motowaMUNGU-adaptive-background.png")],
    [await makeIosIcon(48), path.join(imagesDir, "motowaMUNGU-favicon.png")],
  ];

  for (const [buffer, outPath] of outputs) {
    await fs.promises.writeFile(outPath, buffer);
  }

  for (const size of IOS_SIZES) {
    const buf = await makeIosIcon(size);
    await fs.promises.writeFile(path.join(iconsDir, `ios-${size}.png`), buf);
  }

  for (const size of ANDROID_SIZES) {
    const buf = await makeIosIcon(size);
    await fs.promises.writeFile(path.join(iconsDir, `android-${size}.png`), buf);
  }

  const adaptive512 = await sharp(adaptiveForeground).resize(512, 512).png().toBuffer();
  await fs.promises.writeFile(path.join(iconsDir, "android-adaptive-foreground-512.png"), adaptive512);

  const sourceMeta = await sharp(sourcePath).metadata();
  console.log(
    JSON.stringify(
      {
        source: path.relative(mobileRoot, sourcePath),
        sourceSize: `${sourceMeta.width}x${sourceMeta.height}`,
        trimmedSize: `${trimmedMeta.width}x${trimmedMeta.height}`,
        iosFill: `${Math.round(IOS_FILL * 100)}% (cover, edge-to-edge)`,
        androidFill: `${Math.round(ANDROID_FILL * 100)}% (adaptive safe)`,
        generated: outputs.map(([, p]) => path.relative(mobileRoot, p)),
        iosSizes: IOS_SIZES,
        androidSizes: ANDROID_SIZES,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
