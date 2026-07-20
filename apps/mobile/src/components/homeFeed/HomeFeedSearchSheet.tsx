import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  feedRenderKey,
  filterHomeFeedRowsBySearchQuery,
  formatFeedTimestamp,
  normalizeHomeFeedSearchQuery,
  resolveChurchName,
  resolveFeedPostTypeTitle,
  resolveMediaName,
  resolvePostTitle,
} from "./homeFeedUtils";
import {
  fetchHomeFeedVideoSearchPage,
  HOME_FEED_SEARCH_DEBOUNCE_MS,
  HOME_FEED_SEARCH_PAGE_SIZE,
  type HomeFeedSearchDisposition,
} from "./homeFeedSearchApi";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  /** Local rows used only as optional preview while backend search is pending. */
  rows: any[];
  onClose: () => void;
  onSelectRow: (row: any) => void;
};

type SearchPhase = "idle" | "preview" | "loading" | "ready" | "error";

export const HomeFeedSearchSheet = memo(function HomeFeedSearchSheet({
  visible,
  rows,
  onClose,
  onSelectRow,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [authoritativeRows, setAuthoritativeRows] = useState<any[]>([]);
  const [disposition, setDisposition] = useState<HomeFeedSearchDisposition | null>(null);

  const generationRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const resetSearchState = useCallback(() => {
    clearDebounce();
    generationRef.current += 1;
    setQuery("");
    setPhase("idle");
    setAuthoritativeRows([]);
    setDisposition(null);
  }, [clearDebounce]);

  useEffect(() => {
    if (!visible) {
      resetSearchState();
    }
  }, [visible, resetSearchState]);

  useEffect(() => {
    return () => {
      clearDebounce();
      generationRef.current += 1;
    };
  }, [clearDebounce]);

  const normalizedLen = normalizeHomeFeedSearchQuery(query).length;

  const previewRows = useMemo(() => {
    const q = normalizeHomeFeedSearchQuery(query);
    if (!q) return [];
    return filterHomeFeedRowsBySearchQuery(rows, q).slice(0, HOME_FEED_SEARCH_PAGE_SIZE);
  }, [rows, query]);

  const results = useMemo(() => {
    if (!normalizedLen) return [];
    if (phase === "ready" || phase === "error") return authoritativeRows;
    // Preview only while pending; never keep preview after authoritative settle.
    if (phase === "preview" || phase === "loading") return previewRows;
    return [];
  }, [normalizedLen, phase, authoritativeRows, previewRows]);

  const runBackendSearch = useCallback(
    async (typedText: string, generation: number) => {
      const normalized = normalizeHomeFeedSearchQuery(typedText);
      if (!normalized) {
        setPhase("idle");
        setAuthoritativeRows([]);
        setDisposition("empty-query");
        return;
      }

      setPhase("loading");
      console.log("KRISTO_HOME_FEED_SEARCH_INPUT", {
        normalizedQueryLength: normalized.length,
        generation,
        trigger: "debounce",
        requestStarted: true,
        reason: "scheduled",
      });

      const result = await fetchHomeFeedVideoSearchPage({
        query: normalized,
        cursor: "0",
        limit: HOME_FEED_SEARCH_PAGE_SIZE,
        generation,
        isCurrentGeneration: (g) => g === generationRef.current,
      });

      if (result.staleIgnored || generation !== generationRef.current) {
        console.log("KRISTO_HOME_FEED_SEARCH_DECISION", {
          normalizedQueryLength: result.normalizedQueryLength,
          generation,
          disposition: "stale-cancelled",
          staleIgnored: true,
          reason: result.reason,
          rawCount: 0,
          mappedCount: 0,
          total: null,
          hasMore: false,
        });
        return;
      }

      setDisposition(result.disposition);
      if (result.disposition === "network") {
        setAuthoritativeRows(result.rows);
        setPhase("ready");
        return;
      }

      // Failed/malformed: clear preview; show safe empty/error state (No matches).
      setAuthoritativeRows([]);
      setPhase("error");
      console.log("KRISTO_HOME_FEED_SEARCH_DECISION", {
        normalizedQueryLength: result.normalizedQueryLength,
        generation,
        disposition: result.disposition,
        staleIgnored: false,
        reason: result.reason,
        rawCount: result.rawCount,
        mappedCount: 0,
        total: result.total,
        hasMore: false,
      });
    },
    []
  );

  const onChangeText = useCallback(
    (next: string) => {
      setQuery(next);
      const normalized = normalizeHomeFeedSearchQuery(next);
      const generation = ++generationRef.current;
      clearDebounce();

      if (!normalized) {
        setPhase("idle");
        setAuthoritativeRows([]);
        setDisposition("empty-query");
        console.log("KRISTO_HOME_FEED_SEARCH_INPUT", {
          normalizedQueryLength: 0,
          generation,
          trigger: "clear",
          requestStarted: false,
          reason: "empty-query",
        });
        console.log("KRISTO_HOME_FEED_SEARCH_DECISION", {
          normalizedQueryLength: 0,
          generation,
          disposition: "empty-query",
          staleIgnored: false,
          reason: "clear-local",
          rawCount: 0,
          mappedCount: 0,
          total: null,
          hasMore: false,
        });
        return;
      }

      // Instant local preview while debounce waits; backend replaces it.
      setPhase("preview");
      setAuthoritativeRows([]);
      console.log("KRISTO_HOME_FEED_SEARCH_INPUT", {
        normalizedQueryLength: normalized.length,
        generation,
        trigger: "change",
        requestStarted: false,
        reason: "preview",
      });

      debounceTimerRef.current = setTimeout(() => {
        void runBackendSearch(next, generation);
      }, HOME_FEED_SEARCH_DEBOUNCE_MS);
    },
    [clearDebounce, runBackendSearch]
  );

  const handleClose = useCallback(() => {
    resetSearchState();
    onClose();
  }, [onClose, resetSearchState]);

  const handleSelect = useCallback(
    (row: any) => {
      resetSearchState();
      onSelectRow(row);
    },
    [onSelectRow, resetSearchState]
  );

  const emptyTitle = !normalizedLen
    ? "Search your Home Feed"
    : phase === "loading" || phase === "preview"
      ? "Searching…"
      : "No matches";
  const emptyBody = !normalizedLen
    ? "Find videos by title, church, media, or caption."
    : phase === "loading" || phase === "preview"
      ? "Looking across the full Home Feed."
      : disposition === "failed" || disposition === "malformed"
        ? "Search is unavailable right now. Try again."
        : "Try a different title, church, or caption.";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={[styles.sheet, { paddingTop: insets.top + 8 }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Search</Text>
          <Pressable onPress={handleClose} hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.searchFieldWrap}>
          <Ionicons name="search" size={18} color={HOME_FEED_MUTED} />
          <TextInput
            value={query}
            onChangeText={onChangeText}
            placeholder="Search posts, churches, media..."
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.searchField}
            autoFocus
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {phase === "loading" ? (
            <ActivityIndicator size="small" color={HOME_FEED_GOLD_SOFT} />
          ) : null}
        </View>

        <FlatList
          data={results}
          keyExtractor={(item, index) => feedRenderKey(item) || String(item?.id || index)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 14 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptyBody}>{emptyBody}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SearchResultRow item={item} onPress={() => handleSelect(item)} />
          )}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
});

function SearchResultRow({ item, onPress }: { item: any; onPress: () => void }) {
  const title = resolvePostTitle(item) || resolveFeedPostTypeTitle(item) || "Post";
  const church = resolveMediaName(item) || resolveChurchName(item);
  const when = formatFeedTimestamp(item?.createdAt);

  return (
    <Pressable style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]} onPress={onPress}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.resultMeta} numberOfLines={1}>
          {[church, when].filter(Boolean).join(" • ")}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.45)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: HOME_FEED_BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  closeText: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 15,
    fontWeight: "700",
  },
  searchFieldWrap: {
    marginHorizontal: 14,
    marginBottom: 10,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  searchField: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    paddingVertical: 10,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  resultTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  resultMeta: {
    color: HOME_FEED_MUTED,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  emptyWrap: {
    paddingTop: 48,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.88,
  },
});
