import React, { memo, useCallback, useMemo, useState } from "react";
import {
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
  resolveChurchName,
  resolveFeedPostTypeTitle,
  resolveMediaName,
  resolvePostTitle,
} from "./homeFeedUtils";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  rows: any[];
  onClose: () => void;
  onSelectRow: (row: any) => void;
};

export const HomeFeedSearchSheet = memo(function HomeFeedSearchSheet({
  visible,
  rows,
  onClose,
  onSelectRow,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return filterHomeFeedRowsBySearchQuery(rows, q).slice(0, 40);
  }, [rows, query]);

  const handleClose = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const handleSelect = useCallback(
    (row: any) => {
      setQuery("");
      onSelectRow(row);
    },
    [onSelectRow]
  );

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
            onChangeText={setQuery}
            placeholder="Search posts, churches, media..."
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.searchField}
            autoFocus
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <FlatList
          data={results}
          keyExtractor={(item, index) => feedRenderKey(item) || String(item?.id || index)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 14 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>
                {query.trim() ? "No matches" : "Search your Home Feed"}
              </Text>
              <Text style={styles.emptyBody}>
                {query.trim()
                  ? "Try a different title, church, or caption."
                  : "Find videos, testimonies, announcements, and more."}
              </Text>
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
