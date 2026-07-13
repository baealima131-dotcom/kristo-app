import React, { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Stack,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  clearThreadMessages,
  clearThreadTextMessages,
  useThread,
  type MsgAttachment,
  type MsgItem,
} from "@/src/lib/messagesStore";
import {
  formatAttachmentMimeLabel,
  formatAttachmentSize,
  normalizeMsgAttachment,
  resolveMessageAttachmentUrl,
} from "@/src/lib/messageAttachmentUpload";
import {
  apiPatch,
} from "@/src/lib/kristoApi";
import {
  getKristoHeaders,
} from "@/src/lib/kristoHeaders";
import {
  updateDirectMessageConversationSetting,
} from "@/src/lib/directMessagesApi";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.055)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.58)";
const GOLD = "#D9B35F";

const CONVERSATION_STORAGE_LIMIT_BYTES =
  500 * 1024 * 1024;

const MEDIA_STORAGE_HIDDEN_PREFIX =
  "kristo_conversation_media_hidden_v1";

const MEDIA_STORAGE_SIZE_PREFIX =
  "kristo_conversation_media_sizes_v1";

type StorageTab =
  | "media"
  | "documents"
  | "audio"
  | "links";

type CleanupFilter =
  | "largest"
  | "all"
  | "videos"
  | "audio"
  | "documents"
  | "duplicates";

type StorageItem = {
  id: string;
  type: StorageTab;
  uri: string;
  title: string;
  subtitle: string;
  createdAt: number;
  mime: string;
  size?: number;
  messageId: string;
  sender: "me" | "other";
  sourceKind: "attachment" | "appointment-audio" | "link";
  isVideo?: boolean;
};

const URL_PATTERN =
  /https?:\/\/[^\s<>"')\]}]+/gi;

function singleParam(
  value: string | string[] | undefined
) {
  return Array.isArray(value)
    ? String(value[0] || "")
    : String(value || "");
}

function cleanUrl(url: string) {
  return String(url || "")
    .trim()
    .replace(/[.,!?;:]+$/, "");
}

function attachmentUri(
  attachment: MsgAttachment
) {
  return resolveMessageAttachmentUrl(
    attachment.imageUri ||
      attachment.fileUri ||
      attachment.uri ||
      attachment.url ||
      ""
  );
}

function attachmentMime(
  attachment: MsgAttachment
) {
  return String(
    attachment.mimeType ||
      attachment.mime ||
      ""
  )
    .trim()
    .toLowerCase();
}

function attachmentName(
  attachment: MsgAttachment
) {
  return String(
    attachment.fileName ||
      attachment.name ||
      "Attachment"
  ).trim();
}

function isImageAttachment(
  attachment: MsgAttachment
) {
  const mime = attachmentMime(attachment);
  const uri = attachmentUri(attachment)
    .split("?")[0]
    .toLowerCase();

  return (
    attachment.kind === "image" ||
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(uri)
  );
}

function isVideoAttachment(
  attachment: MsgAttachment
) {
  const mime = attachmentMime(attachment);
  const uri = attachmentUri(attachment)
    .split("?")[0]
    .toLowerCase();

  return (
    mime.startsWith("video/") ||
    /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(uri)
  );
}

function isAudioAttachment(
  attachment: MsgAttachment
) {
  const mime = attachmentMime(attachment);
  const uri = attachmentUri(attachment)
    .split("?")[0]
    .toLowerCase();

  return (
    mime.startsWith("audio/") ||
    /\.(mp3|m4a|aac|wav|ogg|opus|caf)$/i.test(uri)
  );
}

function extractAppointmentVoices(
  message: MsgItem
): StorageItem[] {
  const card = (
    message.card &&
    typeof message.card === "object"
      ? message.card
      : {}
  ) as Record<string, any>;

  const candidates = [
    card.voiceNotes,
    card.audioNotes,
    card.recordings,
    card.appointmentVoiceNotes,
  ];

  const voices = candidates.find(
    (value) => Array.isArray(value)
  );

  if (!Array.isArray(voices)) return [];

  return voices
    .map((raw: any, index: number) => {
      const uri = String(
        raw?.source ||
          raw?.url ||
          raw?.uri ||
          raw?.audioUrl ||
          raw?.fileUrl ||
          ""
      ).trim();

      if (!uri) return null;

      const duration = Number(
        raw?.durationSec ||
          raw?.duration ||
          0
      );

      return {
        id: [
          "appointment-audio",
          message.id,
          raw?.id || index,
        ].join(":"),
        type: "audio" as const,
        uri,
        title: String(
          raw?.name ||
            `Appointment recording ${index + 1}`
        ),
        subtitle:
          duration > 0
            ? `${Math.floor(duration / 60)}:${String(
                Math.round(duration % 60)
              ).padStart(2, "0")}`
            : "Appointment audio",
        createdAt: Number(message.createdAt || 0),
        mime: String(
          raw?.mime || "audio/m4a"
        ),
        messageId: String(message.id || ""),
        sender: message.sender,
        sourceKind: "appointment-audio" as const,
      };
    })
    .filter(Boolean) as StorageItem[];
}

function buildConversationStorageIndex(
  messages: MsgItem[]
) {
  const media: StorageItem[] = [];
  const documents: StorageItem[] = [];
  const audio: StorageItem[] = [];
  const links: StorageItem[] = [];
  const seenLinks = new Set<string>();

  for (const message of messages) {
    const createdAt = Number(
      message.createdAt || 0
    );

    for (
      const rawAttachment of
      message.attachments || []
    ) {
      const attachment =
        normalizeMsgAttachment(rawAttachment);

      const uri = attachmentUri(attachment);
      if (!uri) continue;

      const mime = attachmentMime(attachment);
      const name = attachmentName(attachment);
      const size = Number(
        attachment.size || 0
      );

      const base: Omit<
        StorageItem,
        "type"
      > = {
        id: [
          "attachment",
          message.id,
          attachment.id || uri,
        ].join(":"),
        uri,
        title: name,
        subtitle: [
          formatAttachmentMimeLabel(mime),
          formatAttachmentSize(size),
        ]
          .filter(Boolean)
          .join(" • "),
        createdAt,
        mime,
        size,
        messageId: String(message.id || ""),
        sender: message.sender,
        sourceKind: "attachment" as const,
      };

      if (
        isImageAttachment(attachment) ||
        isVideoAttachment(attachment)
      ) {
        media.push({
          ...base,
          type: "media",
          isVideo:
            isVideoAttachment(attachment),
        });
        continue;
      }

      if (isAudioAttachment(attachment)) {
        audio.push({
          ...base,
          type: "audio",
        });
        continue;
      }

      documents.push({
        ...base,
        type: "documents",
      });
    }

    audio.push(
      ...extractAppointmentVoices(message)
    );

    const text = String(
      message.storageText ||
        message.text ||
        ""
    );

    const matches = text.match(URL_PATTERN) || [];

    for (
      let index = 0;
      index < matches.length;
      index += 1
    ) {
      const uri = cleanUrl(matches[index]);
      if (!uri || seenLinks.has(uri)) continue;

      seenLinks.add(uri);

      let hostname = uri;

      try {
        hostname =
          new URL(uri).hostname.replace(
            /^www\./i,
            ""
          );
      } catch {}

      links.push({
        id: [
          "link",
          message.id,
          index,
          uri,
        ].join(":"),
        type: "links",
        uri,
        title: hostname || "Shared link",
        subtitle: uri,
        createdAt,
        mime: "text/url",
        messageId: String(message.id || ""),
        sender: message.sender,
        sourceKind: "link",
      });
    }

    const sharedUrl = String(
      message.sharedContent?.shareUrl || ""
    ).trim();

    if (
      /^https?:\/\//i.test(sharedUrl) &&
      !seenLinks.has(sharedUrl)
    ) {
      seenLinks.add(sharedUrl);

      links.push({
        id: [
          "shared-content-link",
          message.id,
          sharedUrl,
        ].join(":"),
        type: "links",
        uri: sharedUrl,
        title: String(
          message.sharedContent?.title ||
            "Shared content"
        ),
        subtitle: sharedUrl,
        createdAt,
        mime: "text/url",
        messageId: String(message.id || ""),
        sender: message.sender,
        sourceKind: "link",
      });
    }
  }

  const newestFirst = (
    a: StorageItem,
    b: StorageItem
  ) => b.createdAt - a.createdAt;

  media.sort(newestFirst);
  documents.sort(newestFirst);
  audio.sort(newestFirst);
  links.sort(newestFirst);

  return {
    media,
    documents,
    audio,
    links,
  };
}

function formatStorageBytes(bytes: number) {
  const value = Math.max(0, Number(bytes || 0));

  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function storageHiddenKey(threadId: string) {
  return `${MEDIA_STORAGE_HIDDEN_PREFIX}:${threadId}`;
}

function storageSizeKey(threadId: string) {
  return `${MEDIA_STORAGE_SIZE_PREFIX}:${threadId}`;
}

function formatDate(createdAt: number) {
  if (!createdAt) return "";

  try {
    return new Date(createdAt).toLocaleDateString(
      undefined,
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      }
    );
  } catch {
    return "";
  }
}

export default function ConversationMediaStorageScreen() {
  const router = useRouter();

  const params = useLocalSearchParams<{
    threadId?: string | string[];
    roomId?: string | string[];
    churchId?: string | string[];
    title?: string | string[];
    mode?: string | string[];
  }>();

  const threadId = singleParam(
    params.threadId
  );

  const conversationTitle =
    singleParam(params.title) ||
    "Conversation";

  const backendRoomId =
    singleParam(params.roomId) ||
    threadId;

  const churchId =
    singleParam(params.churchId);

  const deleteConversationMode =
    singleParam(params.mode) ===
    "delete-conversation";

  const threadState = useThread(
    threadId
  ) as any;

  const messages = useMemo<MsgItem[]>(() => {
    if (Array.isArray(threadState)) {
      return threadState;
    }

    if (
      Array.isArray(threadState?.messages)
    ) {
      return threadState.messages;
    }

    if (
      Array.isArray(threadState?.items)
    ) {
      return threadState.items;
    }

    return [];
  }, [threadState]);

  const index = useMemo(
    () =>
      buildConversationStorageIndex(
        messages
      ),
    [messages]
  );

  const backendHiddenItemIds =
    useMemo(
      () =>
        new Set(
          messages.flatMap((message) =>
            Array.isArray(
              message
                .viewerDeletedStorageItemIds
            )
              ? message
                  .viewerDeletedStorageItemIds
                  .map(String)
              : []
          )
        ),
      [messages]
    );

  const [tab, setTab] =
    useState<StorageTab>("media");

  const [query, setQuery] = useState("");
  const [storageSummaryOpen, setStorageSummaryOpen] =
    useState(false);
  const [cleanupOpen, setCleanupOpen] =
    useState(false);
  const [cleanupFilter, setCleanupFilter] =
    useState<CleanupFilter>("largest");
  const [hiddenItemIds, setHiddenItemIds] =
    useState<Set<string>>(new Set());
  const [resolvedSizes, setResolvedSizes] =
    useState<Record<string, number>>({});
  const [
    selectedCleanupItemIds,
    setSelectedCleanupItemIds,
  ] = useState<Set<string>>(new Set());

  const [
    selectedDeleteCategories,
    setSelectedDeleteCategories,
  ] = useState<Set<string>>(new Set());

  const [
    deleteConversationBusy,
    setDeleteConversationBusy,
  ] = useState(false);

  useEffect(() => {
    setHiddenItemIds(
      new Set(backendHiddenItemIds)
    );
  }, [backendHiddenItemIds]);

  /*
   * One-time migration from old local-only
   * tombstones to durable backend tombstones.
   */
  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(
      storageHiddenKey(threadId)
    )
      .then(async (raw) => {
        if (cancelled || !raw) return;

        let legacyIds: string[] = [];

        try {
          const parsed = JSON.parse(raw);
          legacyIds = Array.isArray(parsed)
            ? parsed.map(String)
            : [];
        } catch {
          legacyIds = [];
        }

        const missingIds =
          legacyIds.filter(
            (id) =>
              !backendHiddenItemIds.has(id)
          );

        if (!missingIds.length) {
          await AsyncStorage.removeItem(
            storageHiddenKey(threadId)
          ).catch(() => {});
          return;
        }

        const byMessage =
          new Map<string, string[]>();

        for (const itemId of missingIds) {
          const item = [
            ...index.media,
            ...index.documents,
            ...index.audio,
            ...index.links,
          ].find(
            (candidate) =>
              candidate.id === itemId
          );

          if (!item?.messageId) continue;

          const current =
            byMessage.get(
              item.messageId
            ) || [];

          current.push(itemId);
          byMessage.set(
            item.messageId,
            current
          );
        }

        for (
          const [
            messageId,
            itemIds,
          ] of byMessage
        ) {
          await apiPatch(
            "/api/church/room-messages",
            {
              roomId: threadId,
              messageId,
              action:
                "delete_storage_items",
              itemIds,
            },
            {
              headers:
                getKristoHeaders() as any,
            }
          );
        }

        if (!cancelled) {
          setHiddenItemIds(
            new Set([
              ...backendHiddenItemIds,
              ...missingIds,
            ])
          );
        }

        await AsyncStorage.removeItem(
          storageHiddenKey(threadId)
        ).catch(() => {});

        console.log(
          "KRISTO_MEDIA_STORAGE_LEGACY_DELETIONS_MIGRATED",
          {
            threadId,
            count: missingIds.length,
          }
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    backendHiddenItemIds,
    index,
    threadId,
  ]);

  useEffect(() => {
    let alive = true;

    void AsyncStorage.getItem(
      storageSizeKey(threadId)
    )
      .then((raw) => {
        if (!alive || !raw) return;

        const parsed = JSON.parse(raw);

        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          setResolvedSizes(parsed);
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [threadId]);

  const visibleIndex = useMemo(() => {
    const filter = (items: StorageItem[]) =>
      items.filter(
        (item) => !hiddenItemIds.has(item.id)
      );

    return {
      media: filter(index.media),
      documents: filter(index.documents),
      audio: filter(index.audio),
      links: filter(index.links),
    };
  }, [hiddenItemIds, index]);

  useEffect(() => {
    const allItems = [
      ...visibleIndex.media,
      ...visibleIndex.documents,
      ...visibleIndex.audio,
    ];

    const unresolved = allItems.filter(
      (item) =>
        !Number(item.size || 0) &&
        !Number(resolvedSizes[item.id] || 0) &&
        /^https?:\/\//i.test(item.uri)
    );

    if (!unresolved.length) return;

    let cancelled = false;

    void (async () => {
      const next: Record<string, number> = {
        ...resolvedSizes,
      };

      let changed = false;

      for (const item of unresolved.slice(0, 12)) {
        try {
          const response = await fetch(item.uri, {
            method: "HEAD",
          });

          const rawLength =
            response.headers.get("content-length");

          const size = Number(rawLength || 0);

          if (size > 0) {
            next[item.id] = size;
            changed = true;
          }
        } catch {}
      }

      if (!changed || cancelled) return;

      setResolvedSizes(next);

      await AsyncStorage.setItem(
        storageSizeKey(threadId),
        JSON.stringify(next)
      ).catch(() => {});

      console.log(
        "KRISTO_MEDIA_STORAGE_SIZE_CACHE_UPDATED",
        {
          threadId,
          resolvedCount: Object.keys(next).length,
        }
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    resolvedSizes,
    threadId,
    visibleIndex.audio,
    visibleIndex.documents,
    visibleIndex.media,
  ]);

  const storageUsage = useMemo(() => {
    const totalFor = (items: StorageItem[]) =>
      items.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(
              item.size ||
                resolvedSizes[item.id] ||
                0
            )
          ),
        0
      );

    const mediaBytes = totalFor(
      visibleIndex.media
    );
    const documentBytes = totalFor(
      visibleIndex.documents
    );
    const audioBytes = totalFor(
      visibleIndex.audio
    );

    const totalBytes =
      mediaBytes +
      documentBytes +
      audioBytes;

    return {
      totalBytes,
      mediaBytes,
      documentBytes,
      audioBytes,
      percent: Math.min(
        100,
        Math.max(
          0,
          (totalBytes /
            CONVERSATION_STORAGE_LIMIT_BYTES) *
            100
        )
      ),
    };
  }, [resolvedSizes, visibleIndex]);

  const allStorageItems = useMemo(
    () => [
      ...visibleIndex.media,
      ...visibleIndex.documents,
      ...visibleIndex.audio,
    ],
    [visibleIndex]
  );

  const cleanupItems = useMemo(() => {
    const itemSize = (item: StorageItem) =>
      Math.max(
        0,
        Number(
          item.size ||
            resolvedSizes[item.id] ||
            0
        )
      );

    const sorted = [...allStorageItems].sort(
      (a, b) => itemSize(b) - itemSize(a)
    );

    if (cleanupFilter === "all") {
      return sorted;
    }

    if (cleanupFilter === "largest") {
      return sorted.filter(
        (item) => itemSize(item) > 0
      );
    }

    if (cleanupFilter === "videos") {
      return sorted.filter(
        (item) =>
          item.type === "media" &&
          item.isVideo === true
      );
    }

    if (cleanupFilter === "audio") {
      return sorted.filter(
        (item) => item.type === "audio"
      );
    }

    if (cleanupFilter === "documents") {
      return sorted.filter(
        (item) => item.type === "documents"
      );
    }

    const groups = new Map<
      string,
      StorageItem[]
    >();

    for (const item of sorted) {
      const size = itemSize(item);
      const normalizedName = String(
        item.title || ""
      )
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

      const normalizedMime = String(
        item.mime || ""
      )
        .trim()
        .toLowerCase();

      const normalizedUri = String(
        item.uri || ""
      )
        .trim()
        .toLowerCase();

      const key =
        size > 0
          ? [
              size,
              normalizedName,
              normalizedMime,
            ].join("|")
          : normalizedUri
            ? `uri:${normalizedUri}`
            : "";

      if (!key) continue;

      const current = groups.get(key) || [];
      current.push(item);
      groups.set(key, current);
    }

    const duplicateIds = new Set<string>();

    for (const items of groups.values()) {
      if (items.length < 2) continue;

      for (const item of items) {
        duplicateIds.add(item.id);
      }
    }

    return sorted.filter((item) =>
      duplicateIds.has(item.id)
    );
  }, [
    allStorageItems,
    cleanupFilter,
    resolvedSizes,
  ]);

  const cleanupShownBytes = useMemo(
    () =>
      cleanupItems.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(
              item.size ||
                resolvedSizes[item.id] ||
                0
            )
          ),
        0
      ),
    [cleanupItems, resolvedSizes]
  );

  const cleanupSelectionActive =
    selectedCleanupItemIds.size > 0;

  const selectedCleanupItems = useMemo(
    () =>
      cleanupItems.filter((item) =>
        selectedCleanupItemIds.has(item.id)
      ),
    [cleanupItems, selectedCleanupItemIds]
  );

  const selectedCleanupBytes = useMemo(
    () =>
      selectedCleanupItems.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(
              item.size ||
                resolvedSizes[item.id] ||
                0
            )
          ),
        0
      ),
    [resolvedSizes, selectedCleanupItems]
  );

  const clearCleanupSelection =
    useCallback(() => {
      setSelectedCleanupItemIds(new Set());
    }, []);

  const toggleCleanupSelection =
    useCallback((item: StorageItem) => {
      setSelectedCleanupItemIds((current) => {
        const next = new Set(current);

        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }

        return next;
      });
    }, []);

  const selectAllCleanupItems =
    useCallback(() => {
      setSelectedCleanupItemIds(
        new Set(
          cleanupItems.map((item) => item.id)
        )
      );
    }, [cleanupItems]);

  const beginCleanupSelection =
    useCallback(
      (item: StorageItem) => {
        setCleanupFilter("all");
        setCleanupOpen(true);
        setSelectedCleanupItemIds(
          new Set([item.id])
        );

        console.log(
          "KRISTO_MEDIA_STORAGE_SELECTION_STARTED",
          {
            threadId,
            itemId: item.id,
          }
        );
      },
      [threadId]
    );

  const activeItems = useMemo(() => {
    const source = visibleIndex[tab];
    const normalizedQuery = query
      .trim()
      .toLowerCase();

    if (!normalizedQuery) return source;

    return source.filter((item) =>
      [
        item.title,
        item.subtitle,
        item.uri,
        item.mime,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [query, tab, visibleIndex]);

  React.useEffect(() => {
    console.log(
      "KRISTO_MEDIA_STORAGE_INDEX_READY",
      {
        threadId,
        messageCount: messages.length,
        mediaCount: index.media.length,
        documentCount:
          index.documents.length,
        audioCount: index.audio.length,
        linkCount: index.links.length,
      }
    );

    console.log(
      "KRISTO_MEDIA_STORAGE_MEDIA_COUNT",
      {
        threadId,
        count: visibleIndex.media.length,
      }
    );

    console.log(
      "KRISTO_MEDIA_STORAGE_DOCUMENT_COUNT",
      {
        threadId,
        count: visibleIndex.documents.length,
      }
    );

    console.log(
      "KRISTO_MEDIA_STORAGE_AUDIO_COUNT",
      {
        threadId,
        count: visibleIndex.audio.length,
      }
    );

    console.log(
      "KRISTO_MEDIA_STORAGE_LINK_COUNT",
      {
        threadId,
        count: visibleIndex.links.length,
      }
    );
  }, [index, messages.length, threadId]);

  const deleteStorageItemsForMe =
    useCallback(
      async (items: StorageItem[]) => {
        if (!items.length) return;

        const byMessage =
          new Map<string, StorageItem[]>();

        for (const item of items) {
          const current =
            byMessage.get(
              item.messageId
            ) || [];

          current.push(item);
          byMessage.set(
            item.messageId,
            current
          );
        }

        for (
          const [
            messageId,
            messageItems,
          ] of byMessage
        ) {
          const response: any =
            await apiPatch(
              "/api/church/room-messages",
              {
                roomId: threadId,
                messageId,
                action:
                  "delete_storage_items",
                itemIds:
                  messageItems.map(
                    (item) => item.id
                  ),
              },
              {
                headers:
                  getKristoHeaders() as any,
              }
            );

          if (
            !response ||
            response.ok === false
          ) {
            throw new Error(
              String(
                response?.error ||
                  "Storage item could not be deleted."
              )
            );
          }
        }

        const nextHidden = new Set(
          hiddenItemIds
        );

        const nextSizes = {
          ...resolvedSizes,
        };

        for (const item of items) {
          nextHidden.add(item.id);
          delete nextSizes[item.id];
        }

        setHiddenItemIds(nextHidden);
        setResolvedSizes(nextSizes);

        await AsyncStorage.setItem(
          storageSizeKey(threadId),
          JSON.stringify(nextSizes)
        ).catch(() => {});

        /*
         * Old hidden key is no longer source of
         * truth. Remove it after backend success.
         */
        await AsyncStorage.removeItem(
          storageHiddenKey(threadId)
        ).catch(() => {});

        console.log(
          "KRISTO_MEDIA_STORAGE_DELETE_FOR_ME_DURABLE",
          {
            threadId,
            count: items.length,
            itemIds: items.map(
              (item) => item.id
            ),
          }
        );
      },
      [
        hiddenItemIds,
        resolvedSizes,
        threadId,
      ]
    );

  const hideStorageItem = useCallback(
    async (item: StorageItem) => {
      try {
        await deleteStorageItemsForMe(
          [item]
        );
      } catch (error: any) {
        Alert.alert(
          "Delete failed",
          String(
            error?.message ||
              "Please try again."
          )
        );
      }
    },
    [deleteStorageItemsForMe]
  );

  const deleteSelectedCleanupItems =
    useCallback(() => {
      if (!selectedCleanupItems.length) {
        return;
      }

      Alert.alert(
        `Delete ${
          selectedCleanupItems.length
        } selected ${
          selectedCleanupItems.length ===
          1
            ? "item"
            : "items"
        }?`,
        `${formatStorageBytes(
          selectedCleanupBytes
        )} will be removed from your storage. Other people in the conversation will keep their copies.`,
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  await deleteStorageItemsForMe(
                    selectedCleanupItems
                  );

                  clearCleanupSelection();
                } catch (error: any) {
                  Alert.alert(
                    "Delete failed",
                    String(
                      error?.message ||
                        "Please try again."
                    )
                  );
                }
              })();
            },
          },
        ]
      );
    }, [
      clearCleanupSelection,
      deleteStorageItemsForMe,
      selectedCleanupBytes,
      selectedCleanupItems,
    ]);

  const hideAllCleanupItems =
    useCallback(() => {
      if (!cleanupItems.length) return;

      Alert.alert(
        "Delete shown items?",
        `Delete ${
          cleanupItems.length
        } item${
          cleanupItems.length === 1
            ? ""
            : "s"
        } from your storage? Other conversation participants will not be affected.`,
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  await deleteStorageItemsForMe(
                    cleanupItems
                  );

                  setCleanupOpen(false);
                } catch (error: any) {
                  Alert.alert(
                    "Delete failed",
                    String(
                      error?.message ||
                        "Please try again."
                    )
                  );
                }
              })();
            },
          },
        ]
      );
    }, [
      cleanupItems,
      deleteStorageItemsForMe,
    ]
  );

  const openItem = useCallback(
    async (item: StorageItem) => {
      try {
        const supported =
          await Linking.canOpenURL(item.uri);

        if (!supported) {
          Alert.alert(
            "Cannot open item",
            "This item is not available on this device."
          );
          return;
        }

        await Linking.openURL(item.uri);
      } catch {
        Alert.alert(
          "Could not open item",
          "Please try again."
        );
      }
    },
    []
  );

  const tabs: Array<{
    key: StorageTab;
    label: string;
    icon: React.ComponentProps<
      typeof Ionicons
    >["name"];
    count: number;
  }> = [
    {
      key: "media",
      label: "Media",
      icon: "images-outline",
      count: index.media.length,
    },
    {
      key: "documents",
      label: "Documents",
      icon: "document-text-outline",
      count: index.documents.length,
    },
    {
      key: "audio",
      label: "Audio",
      icon: "mic-outline",
      count: index.audio.length,
    },
    {
      key: "links",
      label: "Links",
      icon: "link-outline",
      count: index.links.length,
    },
  ];

  const renderGridItem = ({
    item,
  }: ListRenderItemInfo<StorageItem>) => (
    <Pressable
      onPress={() => void openItem(item)}
      onLongPress={() =>
        beginCleanupSelection(item)
      }
      delayLongPress={220}
      style={({ pressed }) => [
        styles.mediaTile,
        pressed && styles.pressed,
      ]}
    >
      {item.isVideo ? (
        <View style={styles.videoPreview}>
          <Ionicons
            name="videocam"
            size={30}
            color={GOLD}
          />
          <View style={styles.playCircle}>
            <Ionicons
              name="play"
              size={15}
              color="#0B0F17"
            />
          </View>
        </View>
      ) : (
        <Image
          source={{ uri: item.uri }}
          style={styles.mediaImage}
        />
      )}

      <View style={styles.mediaOverlay}>
        <Text
          numberOfLines={1}
          style={styles.mediaName}
        >
          {item.title}
        </Text>
      </View>
    </Pressable>
  );

  const renderListItem = ({
    item,
  }: ListRenderItemInfo<StorageItem>) => {
    const icon =
      item.type === "documents"
        ? "document-text-outline"
        : item.type === "audio"
          ? "play-circle-outline"
          : "link-outline";

    return (
      <Pressable
        onPress={() =>
          void openItem(item)
        }
        onLongPress={() =>
          beginCleanupSelection(item)
        }
        delayLongPress={220}
        style={({ pressed }) => [
          styles.listCard,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.itemIcon}>
          <Ionicons
            name={icon}
            size={24}
            color={GOLD}
          />
        </View>

        <View style={styles.itemText}>
          <Text
            style={styles.itemTitle}
            numberOfLines={1}
          >
            {item.title}
          </Text>

          <Text
            style={styles.itemSubtitle}
            numberOfLines={
              item.type === "links" ? 2 : 1
            }
          >
            {item.subtitle ||
              formatDate(item.createdAt)}
          </Text>

          {item.subtitle ? (
            <Text style={styles.itemDate}>
              {formatDate(item.createdAt)}
            </Text>
          ) : null}
        </View>

        <Ionicons
          name="chevron-forward"
          size={18}
          color="rgba(255,255,255,0.34)"
        />
      </Pressable>
    );
  };

  const availableDeleteStorageItems =
    useMemo(
      () => ({
        media: index.media.filter(
          (item) => !hiddenItemIds.has(item.id)
        ),
        documents: index.documents.filter(
          (item) => !hiddenItemIds.has(item.id)
        ),
        audio: index.audio.filter(
          (item) => !hiddenItemIds.has(item.id)
        ),
        links: index.links.filter(
          (item) => !hiddenItemIds.has(item.id)
        ),
      }),
      [index, hiddenItemIds]
    );

  const textMessageCount = useMemo(
    () =>
      messages.filter(
        (message) =>
          String(message?.text || "").trim().length > 0
      ).length,
    [messages]
  );

  const deleteCategoryRows: Array<{
    key:
      | "media"
      | "documents"
      | "audio"
      | "links"
      | "text"
      | "conversation";
    label: string;
    description: string;
    icon: string;
    count: number;
    danger?: boolean;
  }> = [
    {
      key: "media",
      label: "Photos & Videos",
      description:
        "Remove shared photos and videos from your media storage.",
      icon: "images-outline",
      count:
        availableDeleteStorageItems.media.length,
    },
    {
      key: "documents",
      label: "Documents",
      description:
        "Remove shared files and documents.",
      icon: "document-text-outline",
      count:
        availableDeleteStorageItems.documents
          .length,
    },
    {
      key: "audio",
      label: "Audio",
      description:
        "Remove voice notes and shared audio.",
      icon: "mic-outline",
      count:
        availableDeleteStorageItems.audio.length,
    },
    {
      key: "links",
      label: "Links",
      description:
        "Remove links from your media storage.",
      icon: "link-outline",
      count:
        availableDeleteStorageItems.links.length,
    },
    {
      key: "text",
      label: "Text messages",
      description:
        "Clear the message history from your view.",
      icon: "chatbubble-ellipses-outline",
      count: textMessageCount,
    },
    {
      key: "conversation",
      label: "Entire conversation",
      description:
        "Remove this conversation from your inbox.",
      icon: "close-circle-outline",
      count: 1,
      danger: true,
    },
  ];

  const allDeleteCategoryKeys =
    deleteCategoryRows.map((row) => row.key);

  const allDeleteCategoriesSelected =
    allDeleteCategoryKeys.every((key) =>
      selectedDeleteCategories.has(key)
    );

  function toggleDeleteCategory(
    category: string
  ) {
    if (deleteConversationBusy) return;

    setSelectedDeleteCategories(
      (current) => {
        const next = new Set(current);

        if (next.has(category)) {
          next.delete(category);
        } else {
          next.add(category);
        }

        return next;
      }
    );
  }

  function toggleAllDeleteCategories() {
    if (deleteConversationBusy) return;

    setSelectedDeleteCategories(
      allDeleteCategoriesSelected
        ? new Set()
        : new Set(allDeleteCategoryKeys)
    );
  }

  async function executeSelectedConversationDeletion() {
    if (
      !selectedDeleteCategories.size ||
      deleteConversationBusy
    ) {
      return;
    }

    setDeleteConversationBusy(true);

    try {
      const selectedStorageItems: StorageItem[] =
        [];

      if (
        selectedDeleteCategories.has("media")
      ) {
        selectedStorageItems.push(
          ...availableDeleteStorageItems.media
        );
      }

      if (
        selectedDeleteCategories.has(
          "documents"
        )
      ) {
        selectedStorageItems.push(
          ...availableDeleteStorageItems.documents
        );
      }

      if (
        selectedDeleteCategories.has("audio")
      ) {
        selectedStorageItems.push(
          ...availableDeleteStorageItems.audio
        );
      }

      if (
        selectedDeleteCategories.has("links")
      ) {
        selectedStorageItems.push(
          ...availableDeleteStorageItems.links
        );
      }

      if (selectedStorageItems.length) {
        await deleteStorageItemsForMe(
          selectedStorageItems
        );
      }

      const shouldClearText =
        selectedDeleteCategories.has("text");

      const shouldDeleteConversation =
        selectedDeleteCategories.has(
          "conversation"
        );

      if (shouldClearText) {
        const clearResponse: any =
          await apiPatch(
            "/api/church/room-messages",
            {
              roomId: backendRoomId,
              action:
                "clear_text_for_viewer",
            },
            {
              headers:
                getKristoHeaders() as any,
            }
          );

        if (
          !clearResponse ||
          clearResponse.ok === false
        ) {
          throw new Error(
            String(
              clearResponse?.error ||
                "Text messages could not be cleared."
            )
          );
        }

        clearThreadTextMessages(threadId);
      }

      if (shouldDeleteConversation) {
        await updateDirectMessageConversationSetting(
          {
            roomId: backendRoomId,
            churchId,
            action: "delete",
          }
        );

        clearThreadMessages(threadId);

        console.log(
          "KRISTO_DM_CONVERSATION_DATA_DELETED",
          {
            threadId,
            roomId: backendRoomId,
            categories: Array.from(
              selectedDeleteCategories
            ),
            storageItemCount:
              selectedStorageItems.length,
            removedFromInbox: true,
          }
        );

        router.replace(
          "/(tabs)/more/my-church-room/messages" as any
        );

        return;
      }

      console.log(
        "KRISTO_DM_CONVERSATION_DATA_DELETED",
        {
          threadId,
          roomId: backendRoomId,
          categories: Array.from(
            selectedDeleteCategories
          ),
          storageItemCount:
            selectedStorageItems.length,
          removedFromInbox: false,
        }
      );

      Alert.alert(
        "Conversation data deleted",
        "The selected items were removed from your view.",
        [
          {
            text: "Done",
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        "Could not delete conversation data",
        String(
          error?.message || "Please try again."
        )
      );
    } finally {
      setDeleteConversationBusy(false);
    }
  }

  function confirmSelectedConversationDeletion() {
    if (!selectedDeleteCategories.size) {
      Alert.alert(
        "Choose what to delete",
        "Select at least one category."
      );
      return;
    }

    const includesConversation =
      selectedDeleteCategories.has(
        "conversation"
      );

    Alert.alert(
      includesConversation
        ? "Delete selected data and conversation?"
        : "Delete selected data?",
      includesConversation
        ? "The selected data will be removed from your view and this conversation will be removed from your inbox. The other person will keep their copy."
        : "The selected data will be removed from your view only. The other person will keep their copy.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void executeSelectedConversationDeletion();
          },
        },
      ]
    );
  }

  if (deleteConversationMode) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen
          options={{ headerShown: false }}
        />

        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            disabled={deleteConversationBusy}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="chevron-back"
              size={23}
              color={TEXT}
            />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>
              Delete conversation data
            </Text>

            <Text
              style={styles.headerSubtitle}
              numberOfLines={1}
            >
              {conversationTitle}
            </Text>
          </View>

          <View style={{ width: 42 }} />
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 14,
            paddingBottom: 150,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              padding: 16,
              marginBottom: 14,
              borderRadius: 20,
              borderWidth: 1,
              borderColor:
                "rgba(217,179,95,0.24)",
              backgroundColor:
                "rgba(217,179,95,0.07)",
            }}
          >
            <Text
              style={{
                color: TEXT,
                fontSize: 16,
                fontWeight: "900",
              }}
            >
              Select what you want to remove
            </Text>

            <Text
              style={{
                marginTop: 6,
                color: SUB,
                fontSize: 12,
                lineHeight: 18,
                fontWeight: "600",
              }}
            >
              These changes apply only to your
              account. The other person will keep
              their messages and files.
            </Text>
          </View>

          <View
            style={{
              overflow: "hidden",
              borderRadius: 22,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: CARD,
            }}
          >
            {deleteCategoryRows.map(
              (row, rowIndex) => {
                const selected =
                  selectedDeleteCategories.has(
                    row.key
                  );

                return (
                  <Pressable
                    key={row.key}
                    disabled={
                      deleteConversationBusy
                    }
                    onPress={() =>
                      toggleDeleteCategory(
                        row.key
                      )
                    }
                    style={({ pressed }) => ({
                      minHeight: 82,
                      paddingHorizontal: 15,
                      paddingVertical: 13,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 13,
                      borderTopWidth:
                        rowIndex === 0 ? 0 : 1,
                      borderTopColor:
                        "rgba(255,255,255,0.07)",
                      backgroundColor: selected
                        ? row.danger
                          ? "rgba(255,82,110,0.09)"
                          : "rgba(217,179,95,0.08)"
                        : pressed
                          ? "rgba(255,255,255,0.04)"
                          : "transparent",
                    })}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 15,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: row.danger
                          ? "rgba(255,82,110,0.10)"
                          : "rgba(217,179,95,0.10)",
                      }}
                    >
                      <Ionicons
                        name={row.icon as any}
                        size={21}
                        color={
                          row.danger
                            ? "#FF7285"
                            : GOLD
                        }
                      />
                    </View>

                    <View
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <Text
                        style={{
                          color: row.danger
                            ? "#FF8092"
                            : TEXT,
                          fontSize: 14,
                          fontWeight: "900",
                        }}
                      >
                        {row.label}
                      </Text>

                      <Text
                        style={{
                          marginTop: 4,
                          color: SUB,
                          fontSize: 11,
                          lineHeight: 16,
                          fontWeight: "600",
                        }}
                      >
                        {row.description}
                      </Text>
                    </View>

                    <View
                      style={{
                        alignItems: "flex-end",
                        gap: 8,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            "rgba(255,255,255,0.42)",
                          fontSize: 11,
                          fontWeight: "800",
                        }}
                      >
                        {row.count}
                      </Text>

                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          alignItems: "center",
                          justifyContent:
                            "center",
                          borderWidth: 1,
                          borderColor: selected
                            ? row.danger
                              ? "#FF7285"
                              : GOLD
                            : "rgba(255,255,255,0.22)",
                          backgroundColor: selected
                            ? row.danger
                              ? "rgba(255,82,110,0.18)"
                              : "rgba(217,179,95,0.18)"
                            : "transparent",
                        }}
                      >
                        {selected ? (
                          <Ionicons
                            name="checkmark"
                            size={16}
                            color={
                              row.danger
                                ? "#FF8092"
                                : GOLD
                            }
                          />
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              }
            )}
          </View>

          <Pressable
            disabled={deleteConversationBusy}
            onPress={toggleAllDeleteCategories}
            style={({ pressed }) => ({
              marginTop: 14,
              minHeight: 58,
              paddingHorizontal: 15,
              borderRadius: 18,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              borderWidth: 1,
              borderColor:
                allDeleteCategoriesSelected
                  ? "rgba(217,179,95,0.54)"
                  : BORDER,
              backgroundColor:
                allDeleteCategoriesSelected
                  ? "rgba(217,179,95,0.11)"
                  : CARD,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <Ionicons
              name={
                allDeleteCategoriesSelected
                  ? "checkbox"
                  : "square-outline"
              }
              size={24}
              color={GOLD}
            />

            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: TEXT,
                  fontSize: 14,
                  fontWeight: "900",
                }}
              >
                Select everything
              </Text>

              <Text
                style={{
                  marginTop: 3,
                  color: SUB,
                  fontSize: 11,
                  fontWeight: "600",
                }}
              >
                Select all media, messages and the
                conversation.
              </Text>
            </View>
          </Pressable>
        </ScrollView>

        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 18,
            borderTopWidth: 1,
            borderTopColor:
              "rgba(255,255,255,0.08)",
            backgroundColor:
              "rgba(11,15,23,0.97)",
          }}
        >
          <Pressable
            disabled={
              deleteConversationBusy ||
              selectedDeleteCategories.size === 0
            }
            onPress={
              confirmSelectedConversationDeletion
            }
            style={({ pressed }) => ({
              minHeight: 54,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                selectedDeleteCategories.size > 0
                  ? "#D9485F"
                  : "rgba(255,255,255,0.08)",
              opacity:
                deleteConversationBusy
                  ? 0.58
                  : pressed
                    ? 0.82
                    : 1,
            })}
          >
            <Text
              style={{
                color:
                  selectedDeleteCategories.size > 0
                    ? "#FFFFFF"
                    : "rgba(255,255,255,0.34)",
                fontSize: 15,
                fontWeight: "900",
              }}
            >
              {deleteConversationBusy
                ? "Deleting..."
                : selectedDeleteCategories.size > 0
                  ? `Delete selected (${selectedDeleteCategories.size})`
                  : "Select items to delete"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const emptyIcon =
    tab === "media"
      ? "images-outline"
      : tab === "documents"
        ? "document-text-outline"
        : tab === "audio"
          ? "mic-outline"
          : "link-outline";

  const emptyTitle =
    query.trim().length > 0
      ? "No matching items"
      : tab === "media"
        ? "No shared media"
        : tab === "documents"
          ? "No shared documents"
          : tab === "audio"
            ? "No shared audio"
            : "No shared links";

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen
        options={{ headerShown: false }}
      />

      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={23}
            color={TEXT}
          />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>
            Media storage
          </Text>
          <Text
            style={styles.headerSubtitle}
            numberOfLines={1}
          >
            {conversationTitle}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open storage cleanup"
            onPress={() => {
              clearCleanupSelection();
              setCleanupFilter("largest");
              setCleanupOpen(true);
            }}
            style={({ pressed }) => [
              styles.headerButton,
              cleanupOpen
                ? styles.headerButtonDangerActive
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons
              name="trash-bin-outline"
              size={20}
              color={
                cleanupOpen
                  ? "#FF7285"
                  : GOLD
              }
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              storageSummaryOpen
                ? "Hide storage capacity"
                : "Show storage capacity"
            }
            onPress={() =>
              setStorageSummaryOpen(
                (current) => !current
              )
            }
            style={({ pressed }) => [
              styles.headerButton,
              storageSummaryOpen
                ? styles.headerButtonActive
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Ionicons
              name={
                storageSummaryOpen
                  ? "pie-chart"
                  : "pie-chart-outline"
              }
              size={21}
              color={GOLD}
            />
          </Pressable>
        </View>
      </View>

      {storageSummaryOpen ? (
        <View style={styles.storageSummary}>
          <View style={styles.storageSummaryTop}>
          <View>
            <Text style={styles.storageSummaryTitle}>
              Conversation storage
            </Text>
            <Text style={styles.storageSummaryUsed}>
              {formatStorageBytes(
                storageUsage.totalBytes
              )}{" "}
              used
            </Text>
          </View>

          <Text style={styles.storageSummaryLimit}>
            {storageUsage.percent.toFixed(1)}%
          </Text>
        </View>

        <View style={styles.storageTrack}>
          <View
            style={[
              styles.storageFill,
              {
                width: `${
                  storageUsage.percent
                }%`,
              },
            ]}
          />
        </View>

        <Text style={styles.storageLimitText}>
          {formatStorageBytes(
            storageUsage.totalBytes
          )}{" "}
          of{" "}
          {formatStorageBytes(
            CONVERSATION_STORAGE_LIMIT_BYTES
          )}
        </Text>

        <View style={styles.storageBreakdown}>
          <View style={styles.storageBreakdownItem}>
            <Text style={styles.storageBreakdownLabel}>
              Media
            </Text>
            <Text style={styles.storageBreakdownValue}>
              {formatStorageBytes(
                storageUsage.mediaBytes
              )}
            </Text>
          </View>

          <View style={styles.storageBreakdownItem}>
            <Text style={styles.storageBreakdownLabel}>
              Documents
            </Text>
            <Text style={styles.storageBreakdownValue}>
              {formatStorageBytes(
                storageUsage.documentBytes
              )}
            </Text>
          </View>

          <View style={styles.storageBreakdownItem}>
            <Text style={styles.storageBreakdownLabel}>
              Audio
            </Text>
            <Text style={styles.storageBreakdownValue}>
              {formatStorageBytes(
                storageUsage.audioBytes
              )}
            </Text>
          </View>
        </View>

          <Text style={styles.storageDeleteHint}>
            Press and hold an item to select it.
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.searchWrap,
          !storageSummaryOpen
            ? styles.searchWrapCollapsed
            : null,
        ]}
      >
        <Ionicons
          name="search-outline"
          size={18}
          color={SUB}
        />

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search media, files or links"
          placeholderTextColor="rgba(255,255,255,0.34)"
          style={styles.searchInput}
          autoCorrect={false}
        />

        {query ? (
          <Pressable
            onPress={() => setQuery("")}
          >
            <Ionicons
              name="close-circle"
              size={19}
              color={SUB}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabs}>
        {tabs.map((item) => {
          const active = tab === item.key;

          return (
            <Pressable
              key={item.key}
              onPress={() =>
                setTab(item.key)
              }
              style={[
                styles.tab,
                active && styles.tabActive,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={
                  active ? GOLD : SUB
                }
              />

              <Text
                style={[
                  styles.tabLabel,
                  active &&
                    styles.tabLabelActive,
                ]}
                numberOfLines={1}
              >
                {item.label}
              </Text>

              <View
                style={[
                  styles.countBadge,
                  active &&
                    styles.countBadgeActive,
                ]}
              >
                <Text
                  style={[
                    styles.countText,
                    active &&
                      styles.countTextActive,
                  ]}
                >
                  {item.count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        key={
          tab === "media"
            ? "media-grid"
            : "storage-list"
        }
        data={activeItems}
        keyExtractor={(item) => item.id}
        numColumns={
          tab === "media" ? 3 : 1
        }
        renderItem={
          tab === "media"
            ? renderGridItem
            : renderListItem
        }
        columnWrapperStyle={
          tab === "media"
            ? styles.mediaRow
            : undefined
        }
        contentContainerStyle={[
          styles.content,
          activeItems.length === 0 &&
            styles.emptyContent,
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={emptyIcon}
                size={32}
                color={GOLD}
              />
            </View>

            <Text style={styles.emptyTitle}>
              {emptyTitle}
            </Text>

            <Text style={styles.emptySubtitle}>
              Shared items from this conversation
              will appear here.
            </Text>
          </View>
        }
      />

      <Modal
        visible={cleanupOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          clearCleanupSelection();
          setCleanupOpen(false);
        }}
      >
        <View style={styles.cleanupOverlay}>
          <Pressable
            style={styles.cleanupBackdrop}
            onPress={() => {
              clearCleanupSelection();
              setCleanupOpen(false);
            }}
          />

          <View style={styles.cleanupSheet}>
            <View style={styles.cleanupHandle} />

            <View style={styles.cleanupHeader}>
              <View style={styles.cleanupHeaderIcon}>
                <Ionicons
                  name="trash-bin-outline"
                  size={22}
                  color="#FF7285"
                />
              </View>

              <View style={styles.cleanupHeaderText}>
                <Text style={styles.cleanupTitle}>
                  Storage cleanup
                </Text>
                <Text style={styles.cleanupSubtitle}>
                  Find large or duplicate files quickly
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  clearCleanupSelection();
                  setCleanupOpen(false);
                }}
                style={styles.cleanupClose}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={TEXT}
                />
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.cleanupFilterScroll}
              contentContainerStyle={
                styles.cleanupFilters
              }
            >
              {[
                {
                  key: "largest",
                  label: "Largest",
                  icon: "resize-outline",
                },
                {
                  key: "all",
                  label: "All",
                  icon: "albums-outline",
                },
                {
                  key: "videos",
                  label: "Videos",
                  icon: "videocam-outline",
                },
                {
                  key: "audio",
                  label: "Audio",
                  icon: "mic-outline",
                },
                {
                  key: "documents",
                  label: "Documents",
                  icon: "document-text-outline",
                },
                {
                  key: "duplicates",
                  label: "Duplicates",
                  icon: "copy-outline",
                },
              ].map((filter) => {
                const active =
                  cleanupFilter === filter.key;

                return (
                  <Pressable
                    key={filter.key}
                    onPress={() => {
                      clearCleanupSelection();
                      setCleanupFilter(
                        filter.key as CleanupFilter
                      );
                    }}
                    style={[
                      styles.cleanupFilter,
                      active
                        ? styles.cleanupFilterActive
                        : null,
                    ]}
                  >
                    <Ionicons
                      name={filter.icon as any}
                      size={16}
                      color={
                        active ? GOLD : SUB
                      }
                    />

                    <Text
                      style={[
                        styles.cleanupFilterText,
                        active
                          ? styles.cleanupFilterTextActive
                          : null,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.cleanupSummary}>
              <View style={styles.cleanupSummaryText}>
                <Text style={styles.cleanupSummaryCount}>
                  {cleanupSelectionActive
                    ? `${selectedCleanupItemIds.size} selected`
                    : `${cleanupItems.length} ${
                        cleanupItems.length === 1
                          ? "item"
                          : "items"
                      }`}
                </Text>

                <Text style={styles.cleanupSummaryBytes}>
                  {formatStorageBytes(
                    cleanupSelectionActive
                      ? selectedCleanupBytes
                      : cleanupShownBytes
                  )}{" "}
                  {cleanupSelectionActive
                    ? "selected"
                    : "shown"}
                </Text>
              </View>

              {cleanupItems.length > 0 ? (
                <View style={styles.cleanupSelectionActions}>
                  <Pressable
                    onPress={
                      cleanupSelectionActive &&
                      selectedCleanupItemIds.size ===
                        cleanupItems.length
                        ? clearCleanupSelection
                        : selectAllCleanupItems
                    }
                    style={({ pressed }) => [
                      styles.cleanupSelectAll,
                      pressed
                        ? styles.pressed
                        : null,
                    ]}
                  >
                    <Ionicons
                      name={
                        cleanupSelectionActive &&
                        selectedCleanupItemIds.size ===
                          cleanupItems.length
                          ? "close-circle-outline"
                          : "checkmark-circle-outline"
                      }
                      size={15}
                      color={GOLD}
                    />

                    <Text
                      style={
                        styles.cleanupSelectAllText
                      }
                    >
                      {cleanupSelectionActive &&
                      selectedCleanupItemIds.size ===
                        cleanupItems.length
                        ? "Clear"
                        : "Select all"}
                    </Text>
                  </Pressable>

                  {cleanupSelectionActive ? (
                    <Pressable
                      onPress={
                        deleteSelectedCleanupItems
                      }
                      style={({ pressed }) => [
                        styles.cleanupRemoveAll,
                        pressed
                          ? styles.pressed
                          : null,
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={15}
                        color="#FF8A98"
                      />

                      <Text
                        style={
                          styles.cleanupRemoveAllText
                        }
                      >
                        Delete
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <FlatList
              data={cleanupItems}
              keyExtractor={(item) =>
                `cleanup:${item.id}`
              }
              style={styles.cleanupList}
              contentContainerStyle={
                cleanupItems.length
                  ? styles.cleanupListContent
                  : styles.cleanupListEmptyContent
              }
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const bytes = Math.max(
                  0,
                  Number(
                    item.size ||
                      resolvedSizes[item.id] ||
                      0
                  )
                );

                const icon =
                  item.type === "audio"
                    ? "musical-note-outline"
                    : item.type === "documents"
                      ? "document-text-outline"
                      : item.isVideo
                        ? "videocam-outline"
                        : "image-outline";

                return (
                  <Pressable
                    onLongPress={() =>
                      toggleCleanupSelection(item)
                    }
                    delayLongPress={220}
                    onPress={() => {
                      if (cleanupSelectionActive) {
                        toggleCleanupSelection(item);
                        return;
                      }

                      void openItem(item);
                    }}
                    style={({ pressed }) => [
                      styles.cleanupRow,
                      selectedCleanupItemIds.has(
                        item.id
                      )
                        ? styles.cleanupRowSelected
                        : null,
                      pressed
                        ? styles.pressed
                        : null,
                    ]}
                  >
                    <View
                      style={
                        styles.cleanupRowIcon
                      }
                    >
                      <Ionicons
                        name={icon}
                        size={21}
                        color={GOLD}
                      />
                    </View>

                    <View
                      style={
                        styles.cleanupRowText
                      }
                    >
                      <Text
                        style={
                          styles.cleanupRowTitle
                        }
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>

                      <Text
                        style={
                          styles.cleanupRowSubtitle
                        }
                        numberOfLines={1}
                      >
                        {item.type === "media"
                          ? item.isVideo
                            ? "Video"
                            : "Image"
                          : item.type === "audio"
                            ? "Audio"
                            : "Document"}
                        {" • "}
                        {formatDate(
                          item.createdAt
                        )}
                      </Text>
                    </View>

                    <View
                      style={
                        styles.cleanupRowRight
                      }
                    >
                      <Text
                        style={
                          styles.cleanupRowSize
                        }
                      >
                        {formatStorageBytes(
                          bytes
                        )}
                      </Text>

                      {cleanupSelectionActive ? (
                        <View
                          style={[
                            styles.cleanupCheck,
                            selectedCleanupItemIds.has(
                              item.id
                            )
                              ? styles.cleanupCheckSelected
                              : null,
                          ]}
                        >
                          {selectedCleanupItemIds.has(
                            item.id
                          ) ? (
                            <Ionicons
                              name="checkmark"
                              size={14}
                              color="#0B0F17"
                            />
                          ) : null}
                        </View>
                      ) : (
                        <Ionicons
                          name="chevron-forward"
                          size={17}
                          color="rgba(255,255,255,0.30)"
                        />
                      )}
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.cleanupEmpty}>
                  <View
                    style={
                      styles.cleanupEmptyIcon
                    }
                  >
                    <Ionicons
                      name={
                        cleanupFilter ===
                        "duplicates"
                          ? "copy-outline"
                          : "checkmark-circle-outline"
                      }
                      size={30}
                      color={GOLD}
                    />
                  </View>

                  <Text
                    style={
                      styles.cleanupEmptyTitle
                    }
                  >
                    {cleanupFilter ===
                    "duplicates"
                      ? "No duplicates found"
                      : "Nothing to clean"}
                  </Text>

                  <Text
                    style={
                      styles.cleanupEmptySubtitle
                    }
                  >
                    Try another storage filter.
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    minHeight: 66,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor:
      "rgba(255,255,255,0.07)",
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerButtonActive: {
    backgroundColor:
      "rgba(217,179,95,0.14)",
    borderColor:
      "rgba(217,179,95,0.48)",
  },
  headerButtonDangerActive: {
    backgroundColor:
      "rgba(255,82,110,0.12)",
    borderColor:
      "rgba(255,82,110,0.42)",
  },
  headerText: {
    flex: 1,
    paddingHorizontal: 12,
  },
  headerTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 2,
    color: SUB,
    fontSize: 12,
    fontWeight: "600",
  },
  storageSummary: {
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor:
      "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.22)",
  },
  storageSummaryTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  storageSummaryTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },
  storageSummaryUsed: {
    marginTop: 4,
    color: SUB,
    fontSize: 12,
    fontWeight: "700",
  },
  storageSummaryLimit: {
    color: GOLD,
    fontSize: 14,
    fontWeight: "900",
  },
  storageTrack: {
    height: 8,
    marginTop: 14,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor:
      "rgba(255,255,255,0.08)",
  },
  storageFill: {
    height: "100%",
    minWidth: 2,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  storageLimitText: {
    marginTop: 7,
    color: "rgba(255,255,255,0.42)",
    fontSize: 10,
    fontWeight: "700",
  },
  storageBreakdown: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  storageBreakdownItem: {
    flex: 1,
    minWidth: 0,
    padding: 10,
    borderRadius: 13,
    backgroundColor:
      "rgba(255,255,255,0.04)",
  },
  storageBreakdownLabel: {
    color: SUB,
    fontSize: 9,
    fontWeight: "800",
  },
  storageBreakdownValue: {
    marginTop: 4,
    color: TEXT,
    fontSize: 11,
    fontWeight: "900",
  },
  storageDeleteHint: {
    marginTop: 12,
    color: "rgba(217,179,95,0.70)",
    fontSize: 10,
    fontWeight: "700",
  },
  searchWrap: {
    height: 48,
    marginHorizontal: 14,
    marginTop: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor:
      "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  searchWrapCollapsed: {
    marginTop: 14,
  },
  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 14,
    fontWeight: "600",
  },
  tabs: {
    marginTop: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 7,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    paddingHorizontal: 5,
    paddingVertical: 8,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  tabActive: {
    backgroundColor:
      "rgba(217,179,95,0.13)",
    borderColor:
      "rgba(217,179,95,0.55)",
  },
  tabLabel: {
    maxWidth: "100%",
    color: SUB,
    fontSize: 10,
    fontWeight: "800",
  },
  tabLabelActive: {
    color: GOLD,
  },
  countBadge: {
    minWidth: 20,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.07)",
  },
  countBadgeActive: {
    backgroundColor:
      "rgba(217,179,95,0.20)",
  },
  countText: {
    color: SUB,
    fontSize: 10,
    fontWeight: "900",
  },
  countTextActive: {
    color: GOLD,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 40,
  },
  emptyContent: {
    flexGrow: 1,
  },
  mediaRow: {
    gap: 8,
    marginBottom: 8,
  },
  mediaTile: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: "32%",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  mediaImage: {
    width: "100%",
    height: "100%",
    backgroundColor:
      "rgba(255,255,255,0.04)",
  },
  videoPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(139,92,246,0.13)",
  },
  playCircle: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  mediaOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor:
      "rgba(0,0,0,0.62)",
  },
  mediaName: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  listCard: {
    minHeight: 76,
    marginBottom: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  itemIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.11)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.25)",
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },
  itemSubtitle: {
    marginTop: 4,
    color: SUB,
    fontSize: 11,
    lineHeight: 15,
  },
  itemDate: {
    marginTop: 4,
    color:
      "rgba(255,255,255,0.34)",
    fontSize: 10,
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    minHeight: 330,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.24)",
  },
  emptyTitle: {
    marginTop: 16,
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  emptySubtitle: {
    marginTop: 7,
    color: SUB,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  cleanupOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor:
      "rgba(0,0,0,0.42)",
  },
  cleanupBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  cleanupSheet: {
    height: "78%",
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 18,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "#111720",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
  },
  cleanupHandle: {
    width: 44,
    height: 5,
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor:
      "rgba(255,255,255,0.18)",
  },
  cleanupHeader: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  cleanupHeaderIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,82,110,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(255,82,110,0.28)",
  },
  cleanupHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cleanupTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  cleanupSubtitle: {
    marginTop: 3,
    color: SUB,
    fontSize: 11,
    fontWeight: "600",
  },
  cleanupClose: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  cleanupFilterScroll: {
    flexGrow: 0,
    flexShrink: 0,
    height: 68,
    maxHeight: 68,
  },
  cleanupFilters: {
    gap: 8,
    paddingTop: 15,
    paddingBottom: 15,
    paddingRight: 16,
    alignItems: "center",
  },
  cleanupFilter: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor:
      "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  cleanupFilterActive: {
    backgroundColor:
      "rgba(217,179,95,0.13)",
    borderColor:
      "rgba(217,179,95,0.50)",
  },
  cleanupFilterText: {
    color: SUB,
    fontSize: 11,
    fontWeight: "800",
  },
  cleanupFilterTextActive: {
    color: GOLD,
  },
  cleanupSummary: {
    minHeight: 58,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor:
      "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  cleanupSummaryText: {
    flex: 1,
    minWidth: 0,
  },
  cleanupSelectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  cleanupSummaryCount: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  cleanupSummaryBytes: {
    marginTop: 3,
    color: SUB,
    fontSize: 10,
    fontWeight: "700",
  },
  cleanupSelectAll: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor:
      "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.28)",
  },
  cleanupSelectAllText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
  },
  cleanupRemoveAll: {
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor:
      "rgba(255,82,110,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(255,82,110,0.28)",
  },
  cleanupRemoveAllText: {
    color: "#FF8A98",
    fontSize: 10,
    fontWeight: "900",
  },
  cleanupList: {
    flex: 1,
    marginTop: 11,
  },
  cleanupListContent: {
    paddingBottom: 24,
  },
  cleanupListEmptyContent: {
    flexGrow: 1,
  },
  cleanupRow: {
    minHeight: 72,
    marginBottom: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor:
      "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  cleanupRowSelected: {
    backgroundColor:
      "rgba(217,179,95,0.11)",
    borderColor:
      "rgba(217,179,95,0.58)",
  },
  cleanupRowIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.23)",
  },
  cleanupRowText: {
    flex: 1,
    minWidth: 0,
  },
  cleanupRowTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  cleanupRowSubtitle: {
    marginTop: 4,
    color: SUB,
    fontSize: 10,
    fontWeight: "600",
  },
  cleanupRowRight: {
    alignItems: "flex-end",
    gap: 5,
  },
  cleanupRowSize: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
  },
  cleanupCheck: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.30)",
    backgroundColor:
      "rgba(255,255,255,0.03)",
  },
  cleanupCheckSelected: {
    borderColor: GOLD,
    backgroundColor: GOLD,
  },
  cleanupEmpty: {
    flex: 1,
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  cleanupEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(217,179,95,0.24)",
  },
  cleanupEmptyTitle: {
    marginTop: 15,
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },
  cleanupEmptySubtitle: {
    marginTop: 6,
    color: SUB,
    fontSize: 12,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
});
