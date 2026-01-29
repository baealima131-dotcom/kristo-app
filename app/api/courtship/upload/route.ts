import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // ✅ fs needs node runtime

type ChatSender = "Sender" | "Receiver" | "Pastor";

type AttachmentMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  url?: string; // ✅ we will add this
};

type ChatMessage = {
  id: string;
  matchId: string;
  sender: ChatSender;
  kind: "file";
  attachment: AttachmentMeta;
  createdAt: string;
  deliveredTo?: Partial<Record<ChatSender, boolean>>;
  readBy?: Partial<Record<ChatSender, boolean>>;
};

type PresenceState = Partial<Record<ChatSender, { online: boolean; lastSeenAt: string }>>;

type CourtshipDB = {
  chats: Record<string, any[]>;
  files: Record<string, AttachmentMeta & { matchId: string; sender: ChatSender; absPath: string }>;
  presence: Record<string, PresenceState>;
  matches: { id: string }[];
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "courtship.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ chats: {}, files: {}, presence: {}, matches: [] }, null, 2),
      "utf-8"
    );
  }
}

function safeReadDB(): CourtshipDB {
  ensure();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const db = JSON.parse(raw || "{}");
    if (!db.chats) db.chats = {};
    if (!db.files) db.files = {};
    if (!db.presence) db.presence = {};
    if (!db.matches) db.matches = [];
    return db as CourtshipDB;
  } catch {
    // if corrupted JSON, do not crash API
    return { chats: {}, files: {}, presence: {}, matches: [] };
  }
}

function writeDB(db: CourtshipDB) {
  ensure();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function ensureThread(db: CourtshipDB, matchId: string) {
  if (!db.chats[matchId]) db.chats[matchId] = [];
  if (!db.presence[matchId]) db.presence[matchId] = {};
}

function isOnline(state: PresenceState | undefined, who: ChatSender) {
  const p = state?.[who];
  if (!p) return false;
  // online if pinged within last 25 seconds
  const age = Date.now() - +new Date(p.lastSeenAt);
  return p.online === true && age <= 25_000;
}

function buildFileUrl(req: Request, fileId: string) {
  // ✅ this must match your file-serving route:
  // Example: /api/courtship/file?fileId=...
  const u = new URL(req.url);
  return `${u.origin}/api/courtship/file?fileId=${encodeURIComponent(fileId)}`;
}

const ALL_SENDERS: ChatSender[] = ["Sender", "Receiver", "Pastor"];

export async function POST(req: Request) {
  const db = safeReadDB();

  const form = await req.formData();
  const matchId = String(form.get("matchId") || "");
  const sender = String(form.get("sender") || "") as ChatSender;
  const file = form.get("file") as File | null;

  if (!matchId) return NextResponse.json({ ok: false, error: "matchId is required" }, { status: 400 });
  if (!ALL_SENDERS.includes(sender))
    return NextResponse.json({ ok: false, error: "Invalid sender" }, { status: 400 });
  if (!file) return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });

  // validate match exists (strict)
  const exists = (db.matches || []).some((m) => m.id === matchId);
  if (!exists) return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });

  // limit: 8MB
  const max = 8 * 1024 * 1024;
  if (file.size > max) return NextResponse.json({ ok: false, error: "File too large (max 8MB)" }, { status: 400 });

  ensureThread(db, matchId);

  const fileId = uid("file");
  const safeName = (file.name || "upload").replace(/[^\w.\- ]+/g, "_");

  const folder = path.join(UPLOAD_DIR, matchId);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const absPath = path.join(folder, `${fileId}_${safeName}`);

  // write file to disk
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buffer);

  const meta: AttachmentMeta = {
    id: fileId,
    name: safeName,
    mime: file.type || "application/octet-stream",
    size: file.size,
    createdAt: nowISO(),
    url: buildFileUrl(req, fileId), // ✅ UI can render immediately
  };

  db.files[fileId] = { ...meta, matchId, sender, absPath };

  // ✅ Delivered/Seen logic
  // - Sender: delivered + seen true
  // - Other roles: delivered true ONLY if they are online now
  const presenceState = db.presence[matchId] || {};
  const deliveredTo: Partial<Record<ChatSender, boolean>> = { [sender]: true };
  const readBy: Partial<Record<ChatSender, boolean>> = { [sender]: true };

  for (const who of ALL_SENDERS) {
    if (who === sender) continue;
    if (isOnline(presenceState, who)) {
      deliveredTo[who] = true;
    }
  }

  const msg: ChatMessage = {
    id: uid("msg"),
    matchId,
    sender,
    kind: "file",
    attachment: meta,
    createdAt: nowISO(),
    deliveredTo,
    readBy,
  };

  db.chats[matchId].push(msg);
  if (db.chats[matchId].length > 300) db.chats[matchId] = db.chats[matchId].slice(-300);

  // mark sender online (heartbeat)
  db.presence[matchId][sender] = { online: true, lastSeenAt: nowISO() };

  writeDB(db);

  return NextResponse.json({
    ok: true,
    message: msg,
    fileId,
    url: meta.url, // ✅ convenience
  });
}
