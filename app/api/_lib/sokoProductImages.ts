import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicVideoUrl, getVideoStorageConfig, headStorageObject } from "./media/objectStorage";

export const localSokoImagesEnabled = () => process.env.NODE_ENV === "development" && !process.env.VERCEL;
export const sokoImageOwner = (userId: string) => createHash("sha256").update(userId).digest("hex");
export const localSokoImageRoot = () => path.join(process.cwd(), ".soko-product-images");
const keyPattern = /^(local|uploads)\/soko-products\/([a-f0-9]{64})\/([a-f0-9-]{36}\.(jpg|png|webp))$/;
export function parseSokoImageKey(key: string) { return keyPattern.exec(key); }
export function sokoImageUrl(key: string) {
  const parts = parseSokoImageKey(key);
  if (!parts) throw new Error("Invalid product image key.");
  if (parts[1] === "local") {
    if (!localSokoImagesEnabled()) throw new Error("Local images are development-only.");
    return "/api/soko/product-images/" + parts[2] + "/" + parts[3];
  }
  const config = getVideoStorageConfig();
  if (!config) throw new Error("Product image storage is unavailable.");
  return buildPublicVideoUrl(config, key);
}
export async function verifySokoImage(key: string, userId: string) {
  const parts = parseSokoImageKey(key);
  if (!parts || parts[2] !== sokoImageOwner(userId)) throw new Error("Image does not belong to this seller.");
  if (parts[1] === "local") {
    if (!localSokoImagesEnabled()) throw new Error("Local images are development-only.");
    const info = await fs.stat(path.join(localSokoImageRoot(), parts[2], parts[3]));
    if (!info.isFile() || info.size < 1 || info.size > 8 * 1024 * 1024) throw new Error("Invalid image file.");
  } else {
    const info = await headStorageObject(key);
    if (info.contentLength < 1 || info.contentLength > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(info.contentType || "")) throw new Error("Invalid stored image.");
  }
}
