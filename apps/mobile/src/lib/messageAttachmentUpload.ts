import { apiPost, getApiBase } from "@/src/lib/kristoApi";
import type { MsgAttachment } from "@/src/lib/messagesStore";

export type PendingMessageAttachment = {
  id: string;
  kind: "image" | "file";
  localUri: string;
  name: string;
  mime: string;
  size?: number;
};

/**
 * Pull a human-readable message out of whatever an upload/send path throws or
 * returns. Handles Error instances, API error results ({ error }), nested
 * shapes ({ error: { message } }), and raw strings so the UI never surfaces
 * "[object Object]".
 */
export function extractApiErrorMessage(err: any, fallback = "Something went wrong. Please try again."): string {
  if (err == null) return fallback;
  if (typeof err === "string") return err.trim() || fallback;

  const candidates = [
    err?.message,
    err?.error?.message,
    err?.error,
    err?.body?.error?.message,
    err?.body?.error,
    err?.data?.error?.message,
    err?.data?.error,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return fallback;
}

export function resolveMessageAttachmentUrl(uri?: string) {
  const v = String(uri || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("file://") || v.startsWith("data:")) return v;
  const base = String(getApiBase() || "").replace(/\/+$/, "");
  if (!base) return v;
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

export function inferAttachmentKind(raw: any): "image" | "file" {
  const kind = String(raw?.kind || "").trim().toLowerCase();
  if (kind === "file") return "file";
  if (kind === "image") return "image";

  const mime = String(raw?.mime || raw?.mimeType || "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";

  const name = String(raw?.name || raw?.fileName || raw?.filename || "").trim().toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|heic|bmp)$/i.test(name)) return "image";

  return "file";
}

export function formatAttachmentSize(size?: number) {
  const n = Number(size || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatAttachmentMimeLabel(mime?: string) {
  const m = String(mime || "").trim().toLowerCase();
  if (!m) return "FILE";
  if (m.includes("pdf")) return "PDF";
  if (m.includes("jpeg") || m.includes("jpg")) return "JPEG";
  if (m.includes("png")) return "PNG";
  if (m.includes("webp")) return "WEBP";
  if (m.includes("gif")) return "GIF";
  if (m.includes("plain")) return "TXT";
  if (m.includes("word") || m.includes("document")) return "DOC";
  if (m.includes("sheet") || m.includes("excel")) return "XLS";
  const tail = m.split("/").pop();
  return tail ? tail.toUpperCase() : "FILE";
}

export function normalizeMsgAttachment(raw: any): MsgAttachment {
  const kind = inferAttachmentKind(raw);
  const rawUri = String(raw?.uri || raw?.url || raw?.imageUri || raw?.fileUri || "").trim();
  const uri = resolveMessageAttachmentUrl(rawUri);
  const name = String(raw?.name || raw?.fileName || raw?.filename || (kind === "image" ? "image.jpg" : "attachment")).trim();
  const mime = String(raw?.mime || raw?.mimeType || (kind === "image" ? "image/jpeg" : "application/octet-stream"));
  const size = typeof raw?.size === "number" ? raw.size : undefined;

  return {
    id: String(raw?.id || `att_${Date.now()}`),
    kind,
    uri,
    url: uri,
    name,
    mime,
    size,
    imageUri: kind === "image" ? uri : raw?.imageUri ? resolveMessageAttachmentUrl(raw.imageUri) : undefined,
    fileUri: kind === "file" ? uri : raw?.fileUri ? resolveMessageAttachmentUrl(raw.fileUri) : undefined,
    fileName: name,
    mimeType: mime,
  };
}

export async function uploadMessageAttachment(
  item: PendingMessageAttachment,
  headers: Record<string, string>
): Promise<MsgAttachment> {
  console.log("[MessagesAttach] upload start", {
    id: item.id,
    kind: item.kind,
    name: item.name,
    mime: item.mime,
    size: item.size,
  });

  const fd = new FormData();
  fd.append("file", {
    uri: item.localUri,
    name: item.name,
    type: item.mime || (item.kind === "image" ? "image/jpeg" : "application/octet-stream"),
  } as any);

  const res: any = await apiPost("/api/church/room-attachments/upload", fd, {
    headers: {
      accept: "application/json",
      ...headers,
    },
  });

  if (!res?.ok || !res?.data?.url) {
    const code = String(res?.code || "").trim();
    const status = Number(res?.status || 0);
    if (code === "ROOM_ATTACHMENT_TOO_LARGE" || status === 413) {
      throw new Error(
        item.kind === "image"
          ? "Image is too large. Please choose a smaller image."
          : "File is too large. Please choose a smaller file."
      );
    }
    throw new Error(extractApiErrorMessage(res, "Upload failed. Please try again."));
  }

  const uploadedUrl = resolveMessageAttachmentUrl(String(res.data.url));
  console.log("[MessagesAttach] upload success", { id: item.id, url: uploadedUrl });

  const attachment: MsgAttachment = {
    id: item.id,
    kind: item.kind,
    uri: uploadedUrl,
    url: uploadedUrl,
    name: String(res.data.filename || item.name),
    mime: String(res.data.mime || res.data.mimeType || item.mime),
    size: typeof res.data.size === "number" ? res.data.size : item.size,
    fileName: String(res.data.filename || item.name),
    mimeType: String(res.data.mime || res.data.mimeType || item.mime),
  };

  if (item.kind === "image") {
    attachment.imageUri = uploadedUrl;
  } else {
    attachment.fileUri = uploadedUrl;
  }

  return attachment;
}
