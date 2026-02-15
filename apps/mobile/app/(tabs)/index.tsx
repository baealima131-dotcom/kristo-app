import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, FlatList, StyleSheet, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { FeedCard } from "@/src/ui/FeedCard";
import { VIP } from "@/src/ui/vipTheme";
import { feedGetAll, feedSubscribe, type FeedItem } from "@/src/store/feedStore";

export default function FeedScreen() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
  const unsub = feedSubscribe(() => setTick((x) => x + 1));
  return () => { try { (unsub as any)?.(); } catch {} };
}, []);

  const data = useMemo(() => feedGetAll(), [tick]);
  const [activeId, setActiveId] = useState<string | null>(data[0]?.id ?? null);

  const insets = useSafeAreaInsets();
  const tabH = useBottomTabBarHeight();
  const winH = Dimensions.get("window").height;
  const itemH = Math.max(200, Math.floor(winH - tabH));

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const top = viewableItems?.[0]?.item as FeedItem | undefined;
    if (top?.id) setActiveId(top.id);
  }).current;

  return (
    <View style={[s.wrap, { paddingBottom: insets.bottom }]}>
      <FlatList
        data={data}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <FeedCard item={item} isActive={item.id === activeId} height={itemH} bottomInset={insets.bottom} />
        )}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        bounces={false}
        getItemLayout={(_, index) => ({ length: itemH, offset: itemH * index, index })}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
      />
    </View>
  );
}

const s = StyleSheet.create<any>({
  wrap: { flex: 1, backgroundColor: VIP.colors.bg },
});
