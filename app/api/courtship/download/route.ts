import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // ✅ fs works only in node runtime

type FileMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  absPath: string;
};

type CourtshipDB = {
  files: Record<string, FileMeta>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DATA_FILE = path.join(DATA_DIR, "courtship.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function safeReadDB(): CourtshipDB {
  ensureDirs();

  if (!fs.existsSync(DATA_FILE)) return { files: {} };

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const db = JSON.parse(raw || "{}");
    if (!db.files) db.files = {};
    return db as CourtshipDB;
  } catch {
    // ✅ if JSON corrupted, don't crash the API
    return { files: {} };
  }
}

// ✅ make sure absPath is inside uploads folder
function isSafeAbsPath(absPath: string) {
  const resolved = path.resolve(absPath);
  const allowedRoot = path.resolve(UPLOADS_DIR);
  return resolved.startsWith(allowedRoot + path.sep);
}

function contentDisposition(name: string, download: boolean) {
  // minimal safe filename
  const safeName = (name || "file").replace(/[\r\n"]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeName}"`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId") || "";
  const download = url.searchParams.get("download") === "1";

  if (!fileId) return new Response("fileId required", { status: 400 });

  const db = safeReadDB();
  const meta = db.files[fileId];
  if (!meta) return new Response("Not found", { status: 404 });

  if (!meta.absPath) return new Response("Missing file path", { status: 404 });

  // ✅ security guard
  if (!isSafeAbsPath(meta.absPath)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(meta.absPath)) return new Response("Missing file", { status: 404 });

  const stat = fs.statSync(meta.absPath);
  const size = meta.size || stat.size;

  // ✅ stream file (better for large files)
  const stream = fs.createReadStream(meta.absPath);

  return new Response(stream as any, {
    status: 200,
    headers: {
      "Content-Type": meta.mime || "application/octet-stream",
      "Content-Disposition": contentDisposition(meta.name, download),
      "Content-Length": String(size),
      // optional caching (tune if you want)
      "Cache-Control": "private, max-age=3600",
    },
  });
}
