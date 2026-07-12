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
  deleteMessage,
  useThread,
  type MsgAttachment,
  type MsgItem,
} from "@/src/lib/messagesStore";
import { apiPatch } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  formatAttachmentMimeLabel,
  formatAttachmentSize,
  normalizeMsgAttachment,
  resolveMessageAttachmentUrl,
} from "@/src/lib/messageAttachmentUpload";

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
      message.text || ""
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
  }>();

  const threadId = singleParam(
    params.threadId
  );

  const conversationTitle =
    singleParam(params.title) ||
    "Conversation";

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
  const [deleteBusyId, setDeleteBusyId] =
    useState("");

  useEffect(() => {
    let alive = true;

    void AsyncStorage.getItem(
      storageHiddenKey(threadId)
    )
      .then((raw) => {
        if (!alive || !raw) return;

        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          setHiddenItemIds(
            new Set(parsed.map(String))
          );
        }
      })
      .catch(() => {});

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

  const hideStorageItem = useCallback(
    async (item: StorageItem) => {
      const next = new Set(hiddenItemIds);
      next.add(item.id);

      setHiddenItemIds(next);

      await AsyncStorage.setItem(
        storageHiddenKey(threadId),
        JSON.stringify([...next])
      ).catch(() => {});

      console.log(
        "KRISTO_MEDIA_STORAGE_ITEM_HIDDEN",
        {
          threadId,
          itemId: item.id,
          messageId: item.messageId,
          sourceKind: item.sourceKind,
        }
      );
    },
    [hiddenItemIds, threadId]
  );

  const deleteMessageForEveryone =
    useCallback(
      async (item: StorageItem) => {
        if (
          !item.messageId ||
          item.sender !== "me" ||
          deleteBusyId
        ) {
          return;
        }

        try {
          setDeleteBusyId(item.id);

          const result: any = await apiPatch(
            "/api/church/room-messages",
            {
              roomId:
                singleParam(params.roomId) ||
                threadId,
              messageId: item.messageId,
              action: "delete",
              scope: "everyone",
            },
            {
              headers:
                getKristoHeaders() as Record<
                  string,
                  string
                >,
            }
          );

          if (!result || result.ok === false) {
            throw new Error(
              String(
                result?.error ||
                  "Delete was not completed."
              )
            );
          }

          deleteMessage(
            threadId,
            item.messageId
          );

          console.log(
            "KRISTO_MEDIA_STORAGE_DELETE_EVERYONE",
            {
              threadId,
              itemId: item.id,
              messageId: item.messageId,
              sourceKind: item.sourceKind,
            }
          );
        } catch (error: any) {
          Alert.alert(
            "Could not delete",
            String(
              error?.message ||
                "Please try again."
            )
          );
        } finally {
          setDeleteBusyId("");
        }
      },
      [
        deleteBusyId,
        params.roomId,
        threadId,
      ]
    );

  const showItemActions = useCallback(
    (item: StorageItem) => {
      const actions: Array<{
        text: string;
        style?: "default" | "cancel" | "destructive";
        onPress?: () => void;
      }> = [
        {
          text: "Delete from my storage",
          style: "destructive",
          onPress: () => {
            void hideStorageItem(item);
          },
        },
      ];

      if (
        item.sender === "me" &&
        item.messageId
      ) {
        actions.push({
          text:
            item.sourceKind ===
            "appointment-audio"
              ? "Delete appointment message for everyone"
              : "Delete message for everyone",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Delete for everyone?",
              item.sourceKind ===
              "appointment-audio"
                ? "This will remove the appointment message containing this recording for everyone."
                : "This will remove the message containing this item for everyone.",
              [
                {
                  text: "Cancel",
                  style: "cancel",
                },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    void deleteMessageForEveryone(
                      item
                    );
                  },
                },
              ]
            );
          },
        });
      }

      actions.push({
        text: "Cancel",
        style: "cancel",
      });

      Alert.alert(
        item.title || "Storage item",
        "Choose an action.",
        actions
      );
    },
    [
      deleteMessageForEveryone,
      hideStorageItem,
    ]
  );

  const hideAllCleanupItems = useCallback(
    () => {
      if (!cleanupItems.length) return;

      Alert.alert(
        "Remove shown items?",
        `Remove ${cleanupItems.length} item${
          cleanupItems.length === 1
            ? ""
            : "s"
        } from your Media Storage view? This will not delete the original messages from the conversation.`,
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const next = new Set(
                  hiddenItemIds
                );

                for (const item of cleanupItems) {
                  next.add(item.id);
                }

                setHiddenItemIds(next);

                await AsyncStorage.setItem(
                  storageHiddenKey(threadId),
                  JSON.stringify([...next])
                ).catch(() => {});

                setCleanupOpen(false);

                console.log(
                  "KRISTO_MEDIA_STORAGE_BULK_HIDDEN",
                  {
                    threadId,
                    count: cleanupItems.length,
                    bytes: cleanupShownBytes,
                    filter: cleanupFilter,
                  }
                );
              })();
            },
          },
        ]
      );
    },
    [
      cleanupFilter,
      cleanupItems,
      cleanupShownBytes,
      hiddenItemIds,
      threadId,
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
      onLongPress={() => showItemActions(item)}
      delayLongPress={280}
      disabled={deleteBusyId === item.id}
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
          showItemActions(item)
        }
        delayLongPress={280}
        disabled={deleteBusyId === item.id}
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
            Press and hold an item to delete it.
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
        onRequestClose={() =>
          setCleanupOpen(false)
        }
      >
        <View style={styles.cleanupOverlay}>
          <Pressable
            style={styles.cleanupBackdrop}
            onPress={() =>
              setCleanupOpen(false)
            }
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
                onPress={() =>
                  setCleanupOpen(false)
                }
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
                    onPress={() =>
                      setCleanupFilter(
                        filter.key as CleanupFilter
                      )
                    }
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
              <View>
                <Text style={styles.cleanupSummaryCount}>
                  {cleanupItems.length} item
                  {cleanupItems.length === 1
                    ? ""
                    : "s"}
                </Text>

                <Text style={styles.cleanupSummaryBytes}>
                  {formatStorageBytes(
                    cleanupShownBytes
                  )}{" "}
                  shown
                </Text>
              </View>

              {cleanupItems.length > 0 ? (
                <Pressable
                  onPress={hideAllCleanupItems}
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
                    Remove shown
                  </Text>
                </Pressable>
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
                    onPress={() =>
                      showItemActions(item)
                    }
                    style={({ pressed }) => [
                      styles.cleanupRow,
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

                      <Ionicons
                        name="chevron-forward"
                        size={17}
                        color="rgba(255,255,255,0.30)"
                      />
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
