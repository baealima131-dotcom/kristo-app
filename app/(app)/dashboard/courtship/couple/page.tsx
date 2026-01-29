// app/(app)/dashboard/courtship/couple/page.tsx
"use client";

import type { CSSProperties, ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import CourtshipTabs from "../_components/CourtshipTabs";
import { useCourtshipStore, type ChatMessage, type ChatSender } from "../_lib/courtshipStore";

type Steps = { s1: boolean; s2: boolean; s3: boolean; s4: boolean };

type ChatFetchPayload = {
  ok: true;
  matchId: string;
  messages: ChatMessage[];
  presence: Partial<Record<ChatSender, string>>;
  readState: Partial<Record<ChatSender, string>>;
};

const EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DELETE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const LONG_PRESS_MS = 450;

// polling
const CHAT_POLL_MS = 3000;
const PRESENCE_PING_MS = 10_000;
const MARK_READ_DEBOUNCE_MS = 700;

function safeTimeNum(iso?: string) {
  const n = +new Date(iso || "");
  return Number.isFinite(n) ? n : NaN;
}

function isDeletedForAll(msg: ChatMessage) {
  return Boolean((msg as any).deletedAt);
}

function isDeletedForMe(msg: ChatMessage, viewer: ChatSender) {
  const t = (msg as any)?.deletedFor?.[viewer];
  return Boolean(t);
}

function canEditMessage(msg: ChatMessage, viewer: ChatSender) {
  if (isDeletedForAll(msg)) return false;
  if (isDeletedForMe(msg, viewer)) return false;
  if (msg.sender !== viewer) return false;
  if (msg.kind !== "text") return false;
  const t = safeTimeNum((msg as any).createdAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= EDIT_WINDOW_MS;
}

function canDeleteMessage(msg: ChatMessage, viewer: ChatSender) {
  if (isDeletedForAll(msg)) return false;
  if (isDeletedForMe(msg, viewer)) return false;
  if (msg.sender !== viewer) return false;
  const t = safeTimeNum((msg as any).createdAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= DELETE_WINDOW_MS;
}

export default function CouplePage() {
  const store = useCourtshipStore();
  // keep latest store without forcing useEffect deps
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const sp = useSearchParams();

  const [matchId, setMatchId] = useState("");
  const [viewer, setViewer] = useState<ChatSender>(store.mode); // default from demo mode
  const [viewerLocked, setViewerLocked] = useState(false);

  // chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // keep latest messages without forcing useEffect deps
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);

  // presence/read state
  const [presence, setPresence] = useState<Partial<Record<ChatSender, string>>>({});
  const [readState, setReadState] = useState<Partial<Record<ChatSender, string>>>({});

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  // ✅ keep latest viewer/matchId in refs so intervals never use stale values
  const viewerRef = useRef<ChatSender>(viewer);
  const matchIdRef = useRef<string>(matchId);

  useEffect(() => {
    viewerRef.current = viewer;
  }, [viewer]);

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);

  // init matchId from URL
  useEffect(() => {
    const m = sp.get("matchId") || "";
    setMatchId(m);
  }, [sp]);

  // keep viewer synced with mode ONLY if user hasn't chosen manually
  useEffect(() => {
    if (!viewerLocked) setViewer(store.mode);
  }, [store.mode, viewerLocked]);

  const match = useMemo(() => (matchId ? store.getMatch(matchId) : undefined), [matchId, store]);
  const profile = useMemo(() => (match?.profileId ? store.getProfile(match.profileId) : undefined), [match, store]);

  const steps: Steps = useMemo(
    () => (matchId ? store.getSteps(matchId) : { s1: false, s2: false, s3: false, s4: false }),
    [matchId, store]
  );

  // ✅ viewport for action menu clamp (avoid window usage in render)
  const [vp, setVp] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const apply = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  function getPresenceStamp(role: ChatSender): number | null {
    const raw = presence?.[role];
    if (!raw) return null;
    const t = +new Date(raw);
    return Number.isFinite(t) ? t : null;
  }

  function onlineLabel(role: ChatSender) {
    const t = getPresenceStamp(role);
    if (!t) return "⚫ Offline";
    const age = Date.now() - t;
    return age <= 25_000 ? "🟢 Online" : "⚫ Offline";
  }

  function lastRead(role: ChatSender) {
    const t = readState?.[role];
    if (!t) return "—";
    const n = +new Date(t);
    if (!Number.isFinite(n)) return "—";
    return new Date(n).toLocaleString();
  }

  async function refreshChatNow() {
    const mId = matchIdRef.current;
    const v = viewerRef.current;
    if (!mId) return;

    try {
      const res = (await storeRef.current.fetchChat(mId, v)) as any as ChatFetchPayload;
      setMessages(res?.messages || []);
      setPresence(res?.presence || {});
      setReadState(res?.readState || {});
    } catch {
      // ignore
    }
  }

  // ✅ Chat polling (guards against strict mode duplicate intervals)
  const chatTimerRef = useRef<any>(null);
  useEffect(() => {
    if (!matchId) return;

    // clear old timer
    if (chatTimerRef.current) clearInterval(chatTimerRef.current);

    let alive = true;
    const tick = async () => {
      try {
        const mId = matchIdRef.current;
        const v = viewerRef.current;
        if (!mId) return;

        const res = (await storeRef.current.fetchChat(mId, v)) as any as ChatFetchPayload;
        if (!alive) return;

        setMessages(res?.messages || []);
        setPresence(res?.presence || {});
        setReadState(res?.readState || {});
      } catch {
        // ignore
      }
    };

    tick();
    chatTimerRef.current = setInterval(tick, CHAT_POLL_MS);

    return () => {
      alive = false;
      if (chatTimerRef.current) clearInterval(chatTimerRef.current);
      chatTimerRef.current = null;
    };
  }, [matchId]);

  // ✅ Presence ping every 10s (guards against strict mode duplicate intervals)
  const presenceTimerRef = useRef<any>(null);
  useEffect(() => {
    if (!matchId) return;

    if (presenceTimerRef.current) clearInterval(presenceTimerRef.current);

    let alive = true;
    const ping = async () => {
      try {
        const mId = matchIdRef.current;
        const v = viewerRef.current;
        if (!mId) return;

        await storeRef.current.pingPresence(mId, v);

        const res = await storeRef.current.getPresence(mId);
        if (!alive) return;

        const pres = (res?.presence || {}) as Partial<Record<ChatSender, string>>;
        setPresence(pres);
      } catch {
        // ignore
      }
    };

    ping();
    presenceTimerRef.current = setInterval(ping, PRESENCE_PING_MS);

    return () => {
      alive = false;
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current);
      presenceTimerRef.current = null;
    };
  }, [matchId]);

  // ✅ WhatsApp-style: mark read ONLY when bottom is visible
  const markReadTimerRef = useRef<any>(null);

  // observe bottom sentinel inside the scroll container (re-attach when messages render)
  useEffect(() => {
    const root = listRef.current;
    const target = bottomRef.current;
    if (!root || !target) return;

    const compute = () => {
      // fallback: true if near bottom (within 24px)
      const gap = root.scrollHeight - root.scrollTop - root.clientHeight;
      setAtBottom(gap <= 24);
    };

    // run once immediately
    compute();

    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        // if sentinel visible => definitely at bottom
        if (e && e.isIntersecting) setAtBottom(true);
        else compute();
      },
      {
        root,
        threshold: 0.01,
        rootMargin: "0px 0px 80px 0px", // treat near-bottom as bottom
      }
    );

    obs.observe(target);

    // also listen to scroll (covers Safari/edge cases)
    root.addEventListener("scroll", compute, { passive: true });

    return () => {
      obs.disconnect();
      root.removeEventListener("scroll", compute as any);
    };
  }, [matchId, messages.length]);
  // ✅ WhatsApp-style: mark read when latest message is from OTHER user (no scroll dependency)
  useEffect(() => {
    if (!matchId) return;
    if (messages.length === 0) return;

    const v = viewerRef.current;
    if (v === "Pastor") return;

    const last = messagesRef.current[messagesRef.current.length - 1] as any;
    if (!last) return;

    // only mark read if the last message is NOT mine
    if (last.sender === v) return;

    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);

    markReadTimerRef.current = setTimeout(() => {
      const mId = matchIdRef.current;
      const vv = viewerRef.current;
      if (!mId) return;
      if (vv === "Pastor") return;
      storeRef.current.markRead(mId, vv).catch(() => {});
    }, MARK_READ_DEBOUNCE_MS);

    return () => {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = null;
    };
  }, [messages.length, matchId, viewer]);
// scroll to bottom on new messages (ONLY if already at bottom, or I sent the last msg)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const last = messagesRef.current[messagesRef.current.length - 1] as any;
    const lastMine = Boolean(last && last.sender === viewer);

    if (atBottom || lastMine) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, atBottom, viewer]);

  // ===========================
  // ✅ Edit/Delete UI state
  // ===========================

  const [actionForId, setActionForId] = useState<string | null>(null); // message id open actions
  const [actionAt, setActionAt] = useState<{ x: number; y: number } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>("");

  function closeActions() {
    setActionForId(null);
    setActionAt(null);
  }

  function openActionsFor(msgId: string, x: number, y: number) {
    setActionForId(msgId);
    setActionAt({ x, y });
  }

  async function startEdit(msg: ChatMessage) {
    closeActions();
    setEditingId(msg.id);
    setEditingDraft(String(msg.text || ""));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingDraft("");
  }

  async function saveEditNow() {
    if (!editingId || !matchId) return;
    const clean = editingDraft.trim();
    if (!clean) return alert("⛔ Message haiwezi kuwa empty.");

    try {
      await store.editMessage(matchId, viewer, editingId, clean);
      cancelEdit();
      await refreshChatNow();
    } catch (e: any) {
      alert(e?.message || "Failed to edit");
    }
  }

  async function deleteForMeNow(msgId: string) {
    closeActions();
    if (!matchId) return;

    const ok = confirm("Delete for me only? (Wewe tu utaificha)");
    if (!ok) return;

    try {
      await store.deleteMessage(matchId, viewer, msgId, "me");
      await refreshChatNow();
    } catch (e: any) {
      alert(e?.message || "Failed to delete for me");
    }
  }

  async function deleteForAllNow(msgId: string) {
    closeActions();
    if (!matchId) return;

    const ok = confirm("Delete for everyone? (Wote wataona: This message was deleted)");
    if (!ok) return;

    try {
      await store.deleteMessage(matchId, viewer, msgId, "all");
      await refreshChatNow();
    } catch (e: any) {
      alert(e?.message || "Failed to delete for all");
    }
  }

  async function sendTextNow() {
    const clean = text.trim();
    if (!clean || !matchId) return;

    setText("");
    try {
      await store.sendText(matchId, viewer, clean);
      await refreshChatNow();
    } catch (e: any) {
      alert(e?.message || "Failed to send message");
    }
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !matchId) return;

    if (f.size > 5 * 1024 * 1024) {
      e.target.value = "";
      return alert("⛔ File kubwa sana. Max 5MB.");
    }

    setUploading(true);
    try {
      await store.sendFile(matchId, viewer, f);
      await refreshChatNow();
    } catch (err: any) {
      alert(err?.message || "Failed to upload file");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function clearNow() {
    if (!matchId) return;
    try {
      await store.clearChat(matchId, viewer);
      await refreshChatNow();
    } catch (e: any) {
      alert(e?.message || "Failed to clear chat");
    }
  }

  // If no matchId in URL: show selector
  if (!matchId) {
    return (
      <div>
        <CourtshipTabs />

        <div style={shell}>
          <div style={pageTitle}>Couple Dashboard</div>

          {store.matches.length === 0 ? (
            <div style={empty}>
              Hakuna matches bado. Nenda <b>Discover</b> → Send Interest, kisha <b>Requests</b> (Receiver) → Accept.
            </div>
          ) : (
            <div style={card}>
              <div style={cardTitle}>Chagua Match</div>
              <div style={{ opacity: 0.86, marginTop: 6, lineHeight: 1.6 }}>
                Umeingia bila <b>matchId</b>. Chagua match hapa:
              </div>

              <select
                style={{ ...select, marginTop: 10, width: "100%" }}
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
              >
                <option value="">— Select match —</option>
                {store.matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} (profile: {m.profileId})
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <Link style={btnGoldLink} href="/dashboard/courtship/matches">
                  Back to Matches
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const approved = !!(match?.approved || steps.s4);

  const actionMsg = actionForId ? messages.find((m) => m.id === actionForId) : null;
  const allowEdit = actionMsg ? canEditMessage(actionMsg, viewer) : false;
  const allowDelete = actionMsg ? canDeleteMessage(actionMsg, viewer) : false;

  // clamp action menu position
  const menuLeft = actionAt ? Math.max(10, Math.min(actionAt.x, vp.w - 240)) : 10;
  const menuTop = actionAt ? Math.max(10, Math.min(actionAt.y, vp.h - 190)) : 10;

  return (
    <div>
      <CourtshipTabs />

      <div style={shell} onClick={() => (actionForId ? closeActions() : null)}>
        <div style={topRow}>
          <div>
            <div style={pageTitle}>Couple Dashboard — {profile?.name || matchId}</div>
            <div style={sub}>
              {profile ? (
                <>
                  {profile.gender} • {profile.city}, {profile.state} • {profile.faith}
                </>
              ) : (
                <>Profile not found</>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <span style={pill}>Viewer: {viewer}</span>

              <select
                style={select}
                value={viewer}
                onChange={(e) => {
                  setViewerLocked(true);
                  setViewer(e.target.value as ChatSender);
                }}
              >
                <option value="Sender">Sender</option>
                <option value="Receiver">Receiver</option>
                <option value="Pastor">Pastor</option>
              </select>

              <span style={pill}>Sender {onlineLabel("Sender")}</span>
              <span style={pill}>Receiver {onlineLabel("Receiver")}</span>
              <span style={pill}>Pastor {onlineLabel("Pastor")}</span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <span style={pillSmall}>Last read (Sender): {lastRead("Sender")}</span>
              <span style={pillSmall}>Last read (Receiver): {lastRead("Receiver")}</span>
              <span style={pillSmall}>Last read (Pastor): {lastRead("Pastor")}</span>
            </div>
          </div>

          <div style={vipBadge}>👑 VIP GOLD PURE</div>
        </div>

        {/* Steps */}
        <div style={card}>
          <div style={cardTitle}>Progress</div>

          <StepRow
            label="1. Agreement"
            desc="Mnakubaliana nia + mipaka + uaminifu."
            done={steps.s1}
            onClick={() => store.setStep(matchId, "s1", !steps.s1)}
          />
          <StepRow
            label="2. Core Questions"
            desc="Maswali ya msingi (imani, maono, maadili, fedha, familia)."
            done={steps.s2}
            onClick={() => store.setStep(matchId, "s2", !steps.s2)}
          />
          <StepRow
            label="3. Counseling Prep"
            desc="Tayari kwa ushauri wa wachungaji (mambo ya msingi yamekamilika)."
            done={steps.s3}
            onClick={() => store.setStep(matchId, "s3", !steps.s3)}
          />

          {/* Step 4 always LOCKED (pastor only in Pastor page) */}
          <StepRow
            label="4. Pastor Approval"
            desc="Pastor mmoja akisha-approve → Engagement Mode."
            done={approved}
            locked
            onClick={() => {}}
          />
        </div>

        {/* CHAT */}
        <div style={card}>
          <div style={cardTopRow}>
            <div>
              <div style={cardTitle}>💬 Couple Chat Room</div>
              <div style={sub}>
                Double-click / Long-press (message yako) → Edit ≤ 10min, Delete ≤ 30min. Delete: For me / For all. File
                uploads (max 5MB).
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={btnSoft} onClick={refreshChatNow} disabled={store.loading}>
                Refresh
              </button>
              <button style={btnDanger} onClick={clearNow} disabled={store.loading}>
                Clear
              </button>
            </div>
          </div>

          <div ref={listRef} style={chatBox}>
            {messages.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No messages yet. Andika message ya kwanza.</div>
            ) : (
              messages
                .filter((m) => !isDeletedForMe(m, viewer))
                .map((m) => {
                  const key =
                    String(m.id || "").trim() ||
                    `${m.matchId || matchId}_${m.sender}_${String(m.createdAt || "")}_${String((m as any)?.editedAt || "")}`;
                  return (
                    <ChatBubble
                      key={key}
                      msg={m}
                      viewer={viewer}
                      readState={readState}
                      onOpenActions={(x, y) => openActionsFor(m.id, x, y)}
                    />
                  );
                })
            )}
          </div>

          {/* ✅ Actions popover */}
          {actionForId && actionAt ? (
            <div
              style={{
                ...actionMenu,
                left: menuLeft,
                top: menuTop,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={actionTitle}>Message Actions</div>
              <div style={actionSub}>
                {allowEdit ? "✏️ Edit available (≤10 min)" : "✏️ Edit expired/locked"} •{" "}
                {allowDelete ? "🗑 Delete available (≤30 min)" : "🗑 Delete expired/locked"}
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <button
                  style={allowEdit ? btnGold : btnLocked}
                  disabled={!allowEdit}
                  onClick={() => actionMsg && startEdit(actionMsg)}
                >
                  Edit
                </button>

                <button
                  style={allowDelete ? btnSoft : btnLocked}
                  disabled={!allowDelete}
                  onClick={() => deleteForMeNow(actionForId)}
                >
                  Delete for me
                </button>

                <button
                  style={allowDelete ? btnDanger : btnLocked}
                  disabled={!allowDelete}
                  onClick={() => deleteForAllNow(actionForId)}
                >
                  Delete for all
                </button>

                <button style={btnSoft} onClick={closeActions}>
                  Close
                </button>
              </div>
            </div>
          ) : null}

          {/* ✅ Composer */}
          <div style={composerRow}>
            {editingId ? (
              <div style={editBar}>
                <div style={{ fontWeight: 950 }}>Editing message…</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>Save ndani ya dakika 10 tangu ilipotumwa.</div>
              </div>
            ) : null}

            <input
              style={input}
              placeholder={editingId ? "Edit message..." : "Type message..."}
              value={editingId ? editingDraft : text}
              onChange={(e) => {
                if (editingId) setEditingDraft(e.target.value);
                else setText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (editingId) saveEditNow().catch(() => {});
                  else sendTextNow().catch(() => {});
                }
                if (e.key === "Escape" && editingId) cancelEdit();
              }}
            />

            {!editingId ? (
              <label style={fileBtn}>
                {uploading ? "Uploading..." : "📎 File"}
                <input type="file" style={{ display: "none" }} onChange={onPickFile} />
              </label>
            ) : null}

            {editingId ? (
              <>
                <button style={btnGold} onClick={() => saveEditNow()} disabled={!editingDraft.trim() || store.loading}>
                  Save
                </button>
                <button style={btnSoft} onClick={cancelEdit} disabled={store.loading}>
                  Cancel
                </button>
              </>
            ) : (
              <button style={btnGold} onClick={() => sendTextNow()} disabled={!text.trim() || store.loading || uploading}>
                Send
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link style={btnGoldLink} href={`/dashboard/courtship/pastor?matchId=${encodeURIComponent(matchId)}`}>
            Go to Pastor Approval
          </Link>
          <Link style={btnGhostLink} href="/dashboard/courtship/matches">
            Back to Matches
          </Link>
        </div>
      </div>
    </div>
  );
}

function StepRow(props: { label: string; desc: string; done: boolean; locked?: boolean; onClick: () => void }) {
  const locked = !!props.locked;
  const label = locked ? (props.done ? "Approved ✅" : "Locked 🔒") : props.done ? "Mark Undone" : "Mark Done";

  return (
    <div style={stepRow}>
      <div>
        <div style={{ fontWeight: 950 }}>{props.label}</div>
        <div style={{ opacity: 0.82, marginTop: 4, lineHeight: 1.5 }}>{props.desc}</div>
      </div>
      <button style={locked ? btnLocked : props.done ? btnDone : btnGold} onClick={props.onClick} disabled={locked}>
        {label}
      </button>
    </div>
  );
}

/**
 * ✅ Message styles:
 * - Sender: gold-ish
 * - Receiver: blue-ish
 * - Pastor: purple-ish
 */
function ChatBubble({
  msg,
  viewer,
  readState,
  onOpenActions,
}: {
  msg: ChatMessage;
  viewer: ChatSender;
  readState: Partial<Record<ChatSender, string>>;
  onOpenActions: (x: number, y: number) => void;
}) {
  const mine = msg.sender === viewer;
  // receipts (WhatsApp-style)
  // show receipts ONLY for my outgoing messages, using the PEER delivery + read
  const peer: ChatSender | null =
    viewer === "Sender" ? "Receiver" : viewer === "Receiver" ? "Sender" : null;

  const delivered = mine && peer ? Boolean((msg as any)?.deliveredTo?.[peer]) : false;

  // prefer per-message readBy (true read receipt); fallback to readState
  const seen = (() => {
    if (!mine || !peer) return false;

    const rb = (msg as any)?.readBy?.[peer];
    if (rb) return true;

    const lastRead = readState?.[peer];
    if (!lastRead) return false;

    const lr = +new Date(lastRead);
    const mt = +new Date((msg as any).createdAt);
    if (!Number.isFinite(lr) || !Number.isFinite(mt)) return false;
    return lr >= mt;
  })();

  // ✅ render priority: seen > delivered > sent
  const statusText = !mine ? "" : seen ? "✓✓✓" : delivered ? "✓✓" : "✓";


  const createdAtNum = +new Date(msg.createdAt as any);
  const time = Number.isFinite(createdAtNum) ? new Date(createdAtNum).toLocaleString() : "—";

  const editedAtISO = (msg as any).editedAt as string | undefined;
  const isEdited = Boolean(editedAtISO);

  const deletedAtISO = (msg as any).deletedAt as string | undefined;
  const isDelAll = Boolean(deletedAtISO);

  const fileAny = msg.file;
  const fileName = fileAny?.name || "file";
  const fileMime = fileAny?.mime || "application/octet-stream";
  const fileUrl = fileAny?.url || "";
  const fileKb = Math.max(0, Math.round(((fileAny?.size || 0) as number) / 1024));

  const styleBySender =
    msg.sender === "Sender" ? bubbleSender : msg.sender === "Receiver" ? bubbleReceiver : bubblePastor;

  const tagBySender =
    msg.sender === "Sender" ? senderTagSender : msg.sender === "Receiver" ? senderTagReceiver : senderTagPastor;

  // ✅ long-press support (mobile)
  const lpRef = useRef<any>(null);
  const movedRef = useRef(false);

  function openAtEvent(e: any) {
    if (!mine) return;
    if (!canEditMessage(msg, viewer) && !canDeleteMessage(msg, viewer)) return;

    const touch = e?.touches?.[0] || e?.changedTouches?.[0];
    if (touch) return onOpenActions(touch.clientX, touch.clientY);

    return onOpenActions(e.clientX, e.clientY);
  }

  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", width: "100%" }}>
      <div
        style={{ ...bubbleBase, ...styleBySender, ...(mine ? bubbleMineHint : {}) }}
        title={mine ? "Double-click / long-press for actions (edit/delete if time allows)" : undefined}
        onDoubleClick={(e) => {
          e.stopPropagation();
          openAtEvent(e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openAtEvent(e);
        }}
        onTouchStart={(e) => {
          if (!mine) return;
          movedRef.current = false;
          lpRef.current = setTimeout(() => {
            if (!movedRef.current) openAtEvent(e);
          }, LONG_PRESS_MS);
        }}
        onTouchMove={() => {
          movedRef.current = true;
          if (lpRef.current) clearTimeout(lpRef.current);
        }}
        onTouchEnd={() => {
          if (lpRef.current) clearTimeout(lpRef.current);
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div style={bubbleHeader}>
          <div style={{ ...senderTagBase, ...tagBySender }}>{msg.sender}</div>
          <div style={timeTag}>{time} {mine ? statusText : ""}</div>
        </div>

        {isDelAll ? (
          <div style={deletedBox}>
            <div style={{ fontWeight: 950 }}>This message was deleted</div>
            <div style={deletedMeta}>🗑 Deleted</div>
          </div>
        ) : msg.kind === "text" ? (
          <>
            <div style={bubbleText}>{msg.text}</div>
            {isEdited ? <div style={metaLine}>✏️ Edited</div> : null}
          </>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900 }}>{fileName}</div>

            {fileMime.startsWith("image/") && fileUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={fileName} style={img} />
            ) : fileUrl ? (
              <a href={fileUrl} target="_blank" rel="noreferrer" style={downloadLink}>
                Download file
              </a>
            ) : (
              <div style={{ opacity: 0.8 }}>Attachment missing URL</div>
            )}

            <div style={{ opacity: 0.75, fontSize: 12 }}>
              {fileMime} • {fileKb} KB
            </div>
          </div>
        )}

        <div style={receipt}>
          {mine ? (
            <span style={{ opacity: 0.85 }}>{!mine ? "" : seen ? "✓✓ Seen" : delivered ? "✓✓ Delivered" : "✓ Sent"}</span>
          ) : (
            <span style={{ opacity: 0.6 }}> </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===========================
   STYLES
   =========================== */

const shell: CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  padding: 16,
  background:
    "radial-gradient(900px 380px at 15% 0%, rgba(212,175,55,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
  boxShadow: "0 16px 45px rgba(0,0,0,0.45)",
};

const topRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const pageTitle: CSSProperties = { fontSize: 32, fontWeight: 950, marginBottom: 6 };
const sub: CSSProperties = { opacity: 0.84, lineHeight: 1.6 };

const vipBadge: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.28)",
  background:
    "radial-gradient(120px 60px at 30% 0%, rgba(212,175,55,0.28), transparent 70%), linear-gradient(180deg, rgba(212,175,55,0.14), rgba(255,255,255,0.04))",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  whiteSpace: "nowrap",
};

const card: CSSProperties = {
  marginTop: 14,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  padding: 14,
  background:
    "radial-gradient(650px 320px at 15% 0%, rgba(212,175,55,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.03))",
};

const cardTitle: CSSProperties = { fontSize: 18, fontWeight: 950, marginBottom: 8 };
const cardTopRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
};

const pill: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(212,175,55,0.20)",
  background: "rgba(212,175,55,0.06)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
};

const pillSmall: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  fontWeight: 900,
  opacity: 0.9,
};

const select: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
};

const btnGold: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  cursor: "pointer",
};

const btnSoft: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const btnDanger: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,120,120,0.28)",
  background: "rgba(255,120,120,0.10)",
  color: "rgba(255,210,210,0.95)",
  fontWeight: 950,
  cursor: "pointer",
};

const btnLocked: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "rgba(255,255,255,0.65)",
  fontWeight: 950,
};

const btnDone: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(120,255,200,0.20)",
  background: "rgba(120,255,200,0.07)",
  color: "rgba(210,255,235,0.95)",
  fontWeight: 950,
  cursor: "pointer",
};

const btnGoldLink: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.34)",
  background: "rgba(212,175,55,0.08)",
  color: "rgba(255,236,190,0.98)",
  fontWeight: 950,
  textDecoration: "none",
  display: "inline-block",
};

const btnGhostLink: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  fontWeight: 950,
  textDecoration: "none",
  display: "inline-block",
};

const stepRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  padding: "12px 0",
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const chatBox: CSSProperties = {
  marginTop: 12,
  height: 360,
  overflow: "auto",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const composerRow: CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const editBar: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.22)",
  background: "rgba(212,175,55,0.08)",
};

const input: CSSProperties = {
  flex: 1,
  minWidth: 220,
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 850,
};

const fileBtn: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  fontWeight: 950,
  cursor: "pointer",
};

const empty: CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  opacity: 0.9,
  lineHeight: 1.7,
};

/* ======= Bubble styles ======= */

const bubbleBase: CSSProperties = {
  width: "fit-content",
  maxWidth: 520,
  borderRadius: 14,
  padding: 12,
  fontSize: 14,
  lineHeight: 1.55,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.18)",
};

const bubbleMineHint: CSSProperties = {
  boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset",
};

const bubbleSender: CSSProperties = {
  border: "1px solid rgba(212,175,55,0.30)",
  background:
    "radial-gradient(140px 60px at 25% 0%, rgba(212,175,55,0.22), transparent 70%), rgba(212,175,55,0.08)",
};

const bubbleReceiver: CSSProperties = {
  border: "1px solid rgba(120,190,255,0.26)",
  background:
    "radial-gradient(140px 60px at 25% 0%, rgba(120,190,255,0.18), transparent 70%), rgba(120,190,255,0.06)",
};

const bubblePastor: CSSProperties = {
  border: "1px solid rgba(200,160,255,0.28)",
  background:
    "radial-gradient(140px 60px at 25% 0%, rgba(200,160,255,0.18), transparent 70%), rgba(200,160,255,0.07)",
};

const bubbleHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 6,
};

const senderTagBase: CSSProperties = {
  fontWeight: 950,
  opacity: 0.95,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.18)",
};

const senderTagSender: CSSProperties = {
  border: "1px solid rgba(212,175,55,0.28)",
  background: "rgba(212,175,55,0.10)",
  color: "rgba(255,236,190,0.98)",
};

const senderTagReceiver: CSSProperties = {
  border: "1px solid rgba(120,190,255,0.24)",
  background: "rgba(120,190,255,0.10)",
  color: "rgba(220,240,255,0.98)",
};

const senderTagPastor: CSSProperties = {
  border: "1px solid rgba(200,160,255,0.26)",
  background: "rgba(200,160,255,0.10)",
  color: "rgba(245,235,255,0.98)",
};

const timeTag: CSSProperties = {
  fontSize: 11,
  fontWeight: 850,
  opacity: 0.72,
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.18)",
  whiteSpace: "nowrap",
};

const bubbleText: CSSProperties = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.55,
  fontWeight: 750,
  opacity: 0.96,
};

const metaLine: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  opacity: 0.78,
  fontWeight: 850,
};

const deletedBox: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px dashed rgba(255,255,255,0.22)",
  background: "rgba(0,0,0,0.14)",
  opacity: 0.92,
};

const deletedMeta: CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  opacity: 0.75,
  fontWeight: 850,
};

const receipt: CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  display: "flex",
  justifyContent: "flex-end",
  opacity: 0.9,
};

const img: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
};

const downloadLink: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "inherit",
  textDecoration: "none",
  fontWeight: 950,
  display: "inline-block",
  width: "fit-content",
};

/* ======= Actions popover ======= */

const actionMenu: CSSProperties = {
  position: "fixed",
  zIndex: 50,
  width: 230,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(220px 120px at 20% 0%, rgba(212,175,55,0.14), transparent 60%), rgba(0,0,0,0.75)",
  padding: 12,
  boxShadow: "0 18px 45px rgba(0,0,0,0.55)",
  backdropFilter: "blur(8px)",
};

const actionTitle: CSSProperties = { fontWeight: 950, marginBottom: 4 };
const actionSub: CSSProperties = { fontSize: 12, opacity: 0.82, lineHeight: 1.45 };
