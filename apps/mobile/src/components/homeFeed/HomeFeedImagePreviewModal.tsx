import React, { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PagerView from "@/components/PagerView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HOME_FEED_GOLD_SOFT } from "./theme";

type PreviewSession = {
  visible: boolean;
  uris: string[];
  initialIndex: number;
};

const CLOSED_SESSION: PreviewSession = {
  visible: false,
  uris: [],
  initialIndex: 0,
};

let previewSession: PreviewSession = CLOSED_SESSION;
const previewListeners = new Set<() => void>();

function emitPreviewSession() {
  for (const listener of previewListeners) {
    listener();
  }
}

function subscribePreviewSession(listener: () => void) {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

function getPreviewSessionSnapshot(): PreviewSession {
  return previewSession;
}

export function isHomeFeedImagePreviewOpen(): boolean {
  return previewSession.visible;
}

export function openHomeFeedImagePreview(uris: string[], initialIndex = 0) {
  const nextUris = (Array.isArray(uris) ? uris : [])
    .map((uri) => String(uri || "").trim())
    .filter(Boolean);
  if (!nextUris.length) return;

  const start = Math.max(0, Math.min(initialIndex, nextUris.length - 1));
  previewSession = {
    visible: true,
    uris: nextUris,
    initialIndex: start,
  };
  emitPreviewSession();
}

export function closeHomeFeedImagePreview() {
  if (!previewSession.visible) return;
  previewSession = CLOSED_SESSION;
  emitPreviewSession();
}

let previewHostClaim = 0;
let previewHostOwner = 0;
const previewHostListeners = new Set<() => void>();

function notifyPreviewHostListeners() {
  for (const listener of previewHostListeners) {
    listener();
  }
}

export function useHomeFeedImagePreviewHost(): boolean {
  const ownerIdRef = useRef(0);
  if (!ownerIdRef.current) {
    previewHostClaim += 1;
    ownerIdRef.current = previewHostClaim;
  }

  const [isHost, setIsHost] = useState(() => {
    if (!previewHostOwner) {
      previewHostOwner = ownerIdRef.current;
    }
    return previewHostOwner === ownerIdRef.current;
  });

  useEffect(() => {
    const reconcile = () => {
      if (!previewHostOwner) {
        previewHostOwner = ownerIdRef.current;
      }
      setIsHost(previewHostOwner === ownerIdRef.current);
    };

    reconcile();
    previewHostListeners.add(reconcile);
    return () => {
      previewHostListeners.delete(reconcile);
      if (previewHostOwner === ownerIdRef.current) {
        previewHostOwner = 0;
        notifyPreviewHostListeners();
      }
    };
  }, []);

  return isHost;
}

export function HomeFeedImagePreviewRoot() {
  const session = useSyncExternalStore(
    subscribePreviewSession,
    getPreviewSessionSnapshot,
    getPreviewSessionSnapshot
  );

  return (
    <HomeFeedImagePreviewModal
      visible={session.visible}
      uris={session.uris}
      initialIndex={session.initialIndex}
      onClose={closeHomeFeedImagePreview}
    />
  );
}

type Props = {
  visible: boolean;
  uris: string[];
  initialIndex: number;
  onClose: () => void;
};

const HomeFeedImagePreviewModal = memo(function HomeFeedImagePreviewModal({
  visible,
  uris,
  initialIndex,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<any>(null);
  const wasVisibleRef = useRef(false);
  const [sessionUris, setSessionUris] = useState<string[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [pagerKey, setPagerKey] = useState(0);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const nextUris = (Array.isArray(uris) ? uris : [])
        .map((uri) => String(uri || "").trim())
        .filter(Boolean);
      const start = Math.max(0, Math.min(initialIndex, Math.max(0, nextUris.length - 1)));
      setSessionUris(nextUris);
      setSessionIndex(start);
      setPagerKey((key) => key + 1);
      requestAnimationFrame(() => {
        try {
          pagerRef.current?.setPageWithoutAnimation?.(start);
        } catch {}
      });
    }
    wasVisibleRef.current = visible;
  }, [visible, uris, initialIndex]);

  const imageCount = sessionUris.length;
  const showModal = visible && imageCount > 0;

  const handlePageSelected = useCallback((event: any) => {
    const index = Number(event?.nativeEvent?.position ?? 0);
    setSessionIndex(index);
  }, []);

  if (!showModal) {
    return null;
  }

  return (
    <Modal
      visible={showModal}
      transparent={false}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={() => {}}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <PagerView
          key={pagerKey}
          ref={pagerRef}
          style={styles.pager}
          initialPage={sessionIndex}
          scrollEnabled={imageCount > 1}
          onPageSelected={handlePageSelected}
        >
          {sessionUris.map((uri, index) => (
            <View key={`${uri}:${index}`} style={styles.page} collapsable={false}>
              <Image source={{ uri }} style={styles.image} resizeMode="contain" />
            </View>
          ))}
        </PagerView>

        <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
            hitSlop={10}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {imageCount > 1 ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]} pointerEvents="none">
            <View style={styles.counterPill}>
              <Text style={styles.counterText}>
                {sessionIndex + 1}/{imageCount}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
});

export { HomeFeedImagePreviewModal };

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#03050C",
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    alignItems: "flex-end",
    zIndex: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,5,12,0.72)",
    borderWidth: 1,
    borderColor: "rgba(201,169,98,0.35)",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    zIndex: 2,
  },
  counterPill: {
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(3,5,12,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  counterText: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
