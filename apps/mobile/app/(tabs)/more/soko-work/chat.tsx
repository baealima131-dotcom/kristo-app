import {
  Ionicons,
} from "@expo/vector-icons";

import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  SafeAreaView,
} from "react-native-safe-area-context";

import {
  fetchSokoWorkChatMessages,
  sendSokoWorkChatMessage,
  type SokoWorkChatMessage,
} from "@/src/lib/sokoWorkChatApi";

const GOLD =
  "#FFD66B";

const BLUE =
  "#75C1FF";

const GREEN =
  "#5DEBA5";

export default function
SokoWorkChatScreen() {
  const router =
    useRouter();

  const params =
    useLocalSearchParams<{
      sellerUserId?: string;
      sellerName?: string;
      storeName?: string;
    }>();

  const sellerUserId =
    String(
      params.sellerUserId ||
        ""
    ).trim();

  const sellerName =
    String(
      params.sellerName ||
        "Store Owner"
    ).trim();

  const storeName =
    String(
      params.storeName ||
        "SOKO Store"
    ).trim();

  const [
    messages,
    setMessages,
  ] = useState<
    SokoWorkChatMessage[]
  >([]);

  const [
    draft,
    setDraft,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    sending,
    setSending,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const listRef =
    useRef<
      FlatList<SokoWorkChatMessage>
    >(null);

  const load =
    useCallback(
      async (
        silent = false
      ) => {
        if (
          !sellerUserId
        ) {
          if (!silent) {
            setError(
              "Store identity is missing."
            );

            setLoading(
              false
            );
          }

          return;
        }

        if (!silent) {
          setLoading(
            true
          );
        }

        try {
          const result =
            await fetchSokoWorkChatMessages(
              {
                sellerUserId,
              }
            );

          setMessages(
            result.messages
          );

          setError("");
        } catch (
          e: any
        ) {
          if (!silent) {
            setError(
              String(
                e?.message ||
                  e ||
                  "Could not load chat."
              )
            );
          }
        } finally {
          if (!silent) {
            setLoading(
              false
            );
          }
        }
      },
      [
        sellerUserId,
      ]
    );

  useEffect(
    () => {
      void load(
        false
      );

      const timer =
        setInterval(
          () => {
            void load(
              true
            );
          },
          4000
        );

      return () => {
        clearInterval(
          timer
        );
      };
    },
    [
      load,
    ]
  );

  async function send() {
    const text =
      draft.trim();

    if (
      !text ||
      !sellerUserId ||
      sending
    ) {
      return;
    }

    try {
      setSending(
        true
      );

      setError("");

      const message =
        await sendSokoWorkChatMessage(
          {
            sellerUserId,
            text,
          }
        );

      setMessages(
        (current) => {
          const exists =
            current.some(
              (row) =>
                row.id ===
                message.id
            );

          if (exists) {
            return current;
          }

          return [
            ...current,
            message,
          ];
        }
      );

      setDraft("");

      requestAnimationFrame(
        () => {
          listRef.current
            ?.scrollToEnd({
              animated: true,
            });
        }
      );
    } catch (
      e: any
    ) {
      setError(
        String(
          e?.message ||
            e ||
            "Could not send message."
        )
      );
    } finally {
      setSending(
        false
      );
    }
  }

  return (
    <SafeAreaView
      style={s.screen}
    >
      <KeyboardAvoidingView
        style={s.screen}
        behavior={
          Platform.OS ===
          "ios"
            ? "padding"
            : undefined
        }
      >
        <View
          style={s.header}
        >
          <Pressable
            onPress={() =>
              router.back()
            }
            style={s.back}
          >
            <Ionicons
              name="chevron-back"
              size={25}
              color="#FFFFFF"
            />
          </Pressable>

          <View
            style={{
              flex: 1,
            }}
          >
            <Text
              style={s.title}
            >
              Chat with Owner
            </Text>

            <Text
              style={s.subtitle}
              numberOfLines={1}
            >
              {sellerName}
              {" · "}
              {storeName}
            </Text>
          </View>

          <View
            style={
              s.workBadge
            }
          >
            <View
              style={
                s.onlineDot
              }
            />

            <Text
              style={
                s.workBadgeText
              }
            >
              WORK
            </Text>
          </View>
        </View>

        {loading ? (
          <View
            style={s.center}
          >
            <ActivityIndicator
              color={GOLD}
            />

            <Text
              style={
                s.loadingText
              }
            >
              Loading work chat...
            </Text>
          </View>
        ) : (
          <>
            {error ? (
              <View
                style={s.errorBox}
              >
                <Text
                  style={
                    s.errorText
                  }
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(
                item
              ) => item.id}
              showsVerticalScrollIndicator={
                false
              }
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={
                s.messageList
              }
              onContentSizeChange={() => {
                listRef.current
                  ?.scrollToEnd({
                    animated: false,
                  });
              }}
              ListEmptyComponent={
                <View
                  style={s.empty}
                >
                  <View
                    style={
                      s.emptyIcon
                    }
                  >
                    <Ionicons
                      name="chatbubbles-outline"
                      size={29}
                      color={BLUE}
                    />
                  </View>

                  <Text
                    style={
                      s.emptyTitle
                    }
                  >
                    Work conversation
                  </Text>

                  <Text
                    style={
                      s.emptyCopy
                    }
                  >
                    Talk directly with
                    the store owner
                    about suppliers,
                    products, costs,
                    purchases and your
                    Level 01 work.
                  </Text>
                </View>
              }
              renderItem={({
                item,
              }) => (
                <View
                  style={[
                    s.messageRow,

                    item.mine
                      ? s.mineRow
                      : s.theirRow,
                  ]}
                >
                  <View
                    style={[
                      s.bubble,

                      item.mine
                        ? s.mineBubble
                        : s.theirBubble,
                    ]}
                  >
                    <Text
                      style={
                        s.sender
                      }
                    >
                      {item.mine
                        ? "YOU"

                        : item.senderRole ===
                          "seller_owner"
                          ? "OWNER"

                          : "LEVEL 01"}
                    </Text>

                    <Text
                      style={
                        s.messageText
                      }
                    >
                      {item.text}
                    </Text>

                    <Text
                      style={s.time}
                    >
                      {item.createdAt
                        ? new Date(
                            item.createdAt
                          ).toLocaleTimeString(
                            [],
                            {
                              hour:
                                "numeric",

                              minute:
                                "2-digit",
                            }
                          )

                        : ""}
                    </Text>
                  </View>
                </View>
              )}
            />

            <View
              style={s.composer}
            >
              <Pressable
                onPress={() => {
                  setError(
                    "Work Documents will connect here next."
                  );
                }}
                style={
                  s.attachButton
                }
              >
                <Ionicons
                  name="add"
                  size={24}
                  color={BLUE}
                />
              </Pressable>

              <TextInput
                value={draft}
                onChangeText={
                  setDraft
                }
                placeholder="Message the owner..."
                placeholderTextColor="rgba(255,255,255,0.30)"
                multiline
                maxLength={4000}
                style={s.input}
              />

              <Pressable
                disabled={
                  sending ||
                  !draft.trim()
                }
                onPress={() =>
                  void send()
                }
                style={[
                  s.sendButton,

                  (
                    sending ||
                    !draft.trim()
                  ) &&
                    s.sendButtonDisabled,
                ]}
              >
                {sending ? (
                  <ActivityIndicator
                    size="small"
                    color="#211C10"
                  />
                ) : (
                  <Ionicons
                    name="arrow-up"
                    size={21}
                    color="#211C10"
                  />
                )}
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s =
  StyleSheet.create({
    screen: {
      flex: 1,

      backgroundColor:
        "#080D17",
    },

    header: {
      minHeight: 72,

      paddingHorizontal: 14,

      flexDirection: "row",

      alignItems: "center",

      borderBottomWidth: 1,

      borderBottomColor:
        "rgba(255,255,255,0.07)",
    },

    back: {
      width: 44,
      height: 44,

      borderRadius: 16,

      alignItems: "center",
      justifyContent: "center",

      marginRight: 11,

      backgroundColor:
        "rgba(255,255,255,0.05)",
    },

    title: {
      color: "#FFFFFF",

      fontSize: 18,

      fontWeight: "900",
    },

    subtitle: {
      color:
        "rgba(255,255,255,0.44)",

      fontSize: 9,

      marginTop: 3,
    },

    workBadge: {
      flexDirection: "row",

      alignItems: "center",

      paddingHorizontal: 9,

      paddingVertical: 6,

      borderRadius: 99,

      backgroundColor:
        "rgba(93,235,165,0.07)",
    },

    onlineDot: {
      width: 7,
      height: 7,

      borderRadius: 99,

      marginRight: 5,

      backgroundColor:
        GREEN,
    },

    workBadgeText: {
      color: GREEN,

      fontSize: 7,

      fontWeight: "900",
    },

    center: {
      flex: 1,

      alignItems: "center",

      justifyContent:
        "center",
    },

    loadingText: {
      color:
        "rgba(255,255,255,0.46)",

      fontSize: 10,

      marginTop: 10,
    },

    errorBox: {
      marginHorizontal: 14,

      marginTop: 10,

      padding: 10,

      borderRadius: 13,

      backgroundColor:
        "rgba(255,100,110,0.08)",

      borderWidth: 1,

      borderColor:
        "rgba(255,100,110,0.18)",
    },

    errorText: {
      color: "#FF9AA2",

      fontSize: 10,

      lineHeight: 15,
    },

    messageList: {
      flexGrow: 1,

      padding: 14,

      paddingBottom: 20,
    },

    empty: {
      flex: 1,

      minHeight: 350,

      alignItems: "center",

      justifyContent:
        "center",

      paddingHorizontal: 34,
    },

    emptyIcon: {
      width: 58,
      height: 58,

      borderRadius: 20,

      alignItems: "center",

      justifyContent:
        "center",

      marginBottom: 12,

      backgroundColor:
        "rgba(117,193,255,0.08)",
    },

    emptyTitle: {
      color: "#FFFFFF",

      fontSize: 15,

      fontWeight: "900",
    },

    emptyCopy: {
      color:
        "rgba(255,255,255,0.42)",

      fontSize: 10,

      lineHeight: 16,

      textAlign: "center",

      marginTop: 7,
    },

    messageRow: {
      width: "100%",

      marginBottom: 9,
    },

    mineRow: {
      alignItems:
        "flex-end",
    },

    theirRow: {
      alignItems:
        "flex-start",
    },

    bubble: {
      maxWidth: "82%",

      paddingHorizontal: 13,

      paddingTop: 10,

      paddingBottom: 8,

      borderRadius: 18,

      borderWidth: 1,
    },

    mineBubble: {
      backgroundColor:
        "rgba(255,214,107,0.13)",

      borderColor:
        "rgba(255,214,107,0.24)",

      borderBottomRightRadius:
        5,
    },

    theirBubble: {
      backgroundColor:
        "#101923",

      borderColor:
        "rgba(255,255,255,0.08)",

      borderBottomLeftRadius:
        5,
    },

    sender: {
      color: GOLD,

      fontSize: 7,

      fontWeight: "900",

      letterSpacing: 0.8,

      marginBottom: 4,
    },

    messageText: {
      color: "#FFFFFF",

      fontSize: 13,

      lineHeight: 19,
    },

    time: {
      color:
        "rgba(255,255,255,0.30)",

      fontSize: 7,

      marginTop: 5,

      alignSelf:
        "flex-end",
    },

    composer: {
      flexDirection: "row",

      alignItems: "flex-end",

      gap: 8,

      paddingHorizontal: 12,

      paddingTop: 9,

      paddingBottom: 10,

      borderTopWidth: 1,

      borderTopColor:
        "rgba(255,255,255,0.07)",

      backgroundColor:
        "#080D17",
    },

    attachButton: {
      width: 43,
      height: 43,

      borderRadius: 15,

      alignItems: "center",

      justifyContent:
        "center",

      backgroundColor:
        "rgba(117,193,255,0.07)",
    },

    input: {
      flex: 1,

      minHeight: 43,

      maxHeight: 120,

      borderRadius: 17,

      paddingHorizontal: 13,

      paddingVertical: 11,

      color: "#FFFFFF",

      fontSize: 12,

      backgroundColor:
        "#101923",

      borderWidth: 1,

      borderColor:
        "rgba(255,255,255,0.08)",
    },

    sendButton: {
      width: 43,
      height: 43,

      borderRadius: 15,

      alignItems: "center",

      justifyContent:
        "center",

      backgroundColor:
        GOLD,
    },

    sendButtonDisabled: {
      opacity: 0.36,
    },
  });
