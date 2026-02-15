import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlatList } from "react-native-gesture-handler";
import { VipZoomImage } from "@/src/ui/VipZoomImage";

type Props = {
  open: boolean;
  uris: string[];
  startIndex?: number;
  onClose: () => void;
};

const { width: W, height: H } = Dimensions.get("window");

export function VipMediaViewerModal({ open, uris, startIndex = 0, onClose }: Props) {
  const listRef = useRef<FlatList<string>>(null);
  const [uiOn, setUiOn] = useState(true);

  const data = useMemo(() => (uris || []).filter(Boolean), [uris]);

  useEffect(() => {
    if (!open) return;
    setUiOn(true);

    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: Math.max(0, startIndex), animated: false });
      } catch {}
    }, 40);

    return () => clearTimeout(t);
  }, [open, startIndex]);

  if (!open) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.root}>
        {/* Backdrop tap = close */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Pager */}
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(u, i) => u + "_" + i}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialNumToRender={1}
          windowSize={3}
          getItemLayout={(_, index) => ({ length: W, offset: W * index, index })}
          renderItem={({ item }) => (
            <View style={s.page}>
              <VipZoomImage uri={item} onTap={() => setUiOn((v) => !v)} />
            </View>
          )}
        />

        {/* Top bar */}
        {uiOn ? (
          <View style={s.topBar} pointerEvents="box-none">
            <Pressable onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={22} color="white" />
            </Pressable>

            <View style={s.hintPill}>
              <Text style={s.hintText}>Pinch to zoom • Drag • Double tap</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
  },
  page: {
    width: W,
    height: H,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  hintPill: {
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  hintText: {
    color: "rgba(255,255,255,0.85)",
    fontWeight: "800",
  },
});
